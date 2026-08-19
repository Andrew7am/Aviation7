import { VendorParser, ParserResult, ParsedRow } from './types';
import { cleanTk, airlineCode } from './shared';
import { SupportedCurrency } from '../helpers/resolveCurrency';

/**
 * IATA BSP "Agent Billing Details" (FCAGBILLDET) invoice, read straight from
 * the PDF — no spreadsheet conversion.
 *
 * This is the settlement document, and it carries three things the daily TJQ
 * does not:
 *
 *   1. Commission. The TJQ often shows a ticket with no commission at all,
 *      while the invoice charges one. That gap is real money.
 *   2. The WEBSALES-EDIS channel, which never appears in the TJQ.
 *   3. An issue date on every single line.
 *
 * The invoice states its own arithmetic in its notes, and this parser follows
 * it exactly rather than inventing one:
 *
 *   Balance Payable = Transaction Amount - Std Comm - Supp Comm +/- Tax on Comm
 *
 * Mapping onto the ledger, which already models all three values:
 *   totalDoc   = Transaction Amount (the fare, gross)
 *   commission = total commission
 *   amount     = Balance Payable  (what is actually owed — the ledger figure)
 *
 * Rows arrive as ONE free-text field each (see readFileAsText), because a PDF
 * row has no delimiters and the amounts contain thousands separators.
 */

/** Section headers that switch the meaning of the rows beneath them. */
const SECTION_RE = /^\*+\s*(ISSUES|REFUNDS|DEBIT MEMOS|CREDIT MEMOS)\b/i;

/**
 * Document types seen across the agent's full BSP invoice history (32 weekly
 * periods, 1,936 transaction lines):
 *   TKTT 1268 · RFND 319 · CANN 131 · CANX 73 · EMDA 69 · EMDS 60
 *   SPDR 12 · ADMA 2 · ACMA 2
 * plus the rarer codes below that BSP can issue but this agent has not yet.
 */
const KNOWN_TRNC = new Set([
  'TKTT', 'RFND', 'RFNC',           // sales and refunds
  'EMDA', 'EMDS', 'EMDX',           // electronic miscellaneous documents
  'CANX', 'CANN',                   // cancellations / voids
  'ADMA', 'ADNT', 'ACMA', 'ACNT',   // debit and credit memos
  'SPDR', 'SPCR',                   // supplementary debit / credit (agent fees)
]);

/**
 * Deliberately matches ANY 3-5 letter document code, not just the known list.
 * A type BSP introduces later must surface as unsupported rather than vanish
 * from the totals — silently dropping SPDR is exactly how 22.08 per period
 * went missing before.
 */
const TRNC = '[A-Z]{3,5}';

/** Every row on a BSP invoice belongs to the IATA vendor, whichever channel
 *  it settled through. Wallet matching keys on this. */
const IATA_VENDOR = 'IATA BSP';

/**
 * A transaction line, e.g.
 *   077 TKTT 5513059026 09AUG26 FFVV I 4,080.00 2,240.00 ... 7.00 156.80 ... 3,923.20
 * Leading 3-digit airline code, document type, document number, date.
 */
const TXN_RE = new RegExp(`^(\\d{3})\\s+(${TRNC})\\s+([0-9]{8,})\\s+(\\d{2}[A-Z]{3}\\d{2})\\b(.*)$`, 'i');

/** Money token: keeps the sign and the cents. */
const MONEY_RE = /-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}/g;

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** "09AUG26" -> "2026-08-09". Returns '' rather than guessing on anything else. */
function bspDate(raw: string): string {
  const m = raw.toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  if (!m || !MONTHS[m[2]]) return '';
  return `20${m[3]}-${MONTHS[m[2]]}-${m[1]}`;
}

const money = (s: string): number => {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Round to cents without floating-point crumbs (0.1+0.2 style drift). */
const cents = (n: number): number => Math.round(n * 100) / 100;

export const BSPInvoiceParser: VendorParser = {
  id: 'BSP_INVOICE',
  name: 'IATA BSP Invoice (PDF)',
  // Rows are free text lines, not a header + data grid.
  headerless: true,

  detect: (headers) => {
    const joined = (headers || []).join(' ').toUpperCase();
    return /FCAGBILLDET/.test(joined) || /AGENT BILLING DETAILS/.test(joined);
  },

  parse: (rows, _headers, defaultCurrency): ParserResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result: ParsedRow[] = [];

    // Each emitted CSV row holds the whole PDF line in its first cell.
    const lines = rows.map(r => (r[0] ?? '').toString());

    // Currency and billing period come from the header block.
    let currency: SupportedCurrency = defaultCurrency;
    let billingPeriod = '';
    for (const line of lines.slice(0, 40)) {
      const cur = line.match(/\bGRAND TOTAL\s*\(([A-Z]{3})\)/);
      if (cur && (cur[1] === 'AED' || cur[1] === 'SAR')) currency = cur[1] as SupportedCurrency;
      const per = line.match(/Billing Period:\s*(\d+)\s*\(([^)]+)\)/i);
      if (per) billingPeriod = per[2].trim();
    }

    let section = '';
    // Channel within the IATA vendor, NOT the vendor itself.
    let channel = 'BSP';
    let seenTxn = 0;
    const unknownTypes = new Map<string, number>();

    for (const line of lines) {
      // Channel changes ONLY on the invoice's own category header, e.g.
      //   "CATEGORY WEBSALES-EDIS"
      // Matching a bare mention of the name is not safe: the page-1 summary
      // block contains the line "WEBSALES-EDIS TOTAL", which would flip the
      // channel before a single transaction is read and leave every BSP row
      // mislabelled — and therefore drawn against the wrong wallet.
      const cat = line.match(/^CATEGORY\s+([A-Z][A-Z0-9\-\s]*?)\s*$/i);
      if (cat) {
        const name = cat[1].trim().toUpperCase();
        channel = name;
        continue;
      }

      const sec = line.match(SECTION_RE);
      if (sec) { section = sec[1].toUpperCase(); continue; }

      const m = line.match(TXN_RE);
      if (!m) continue;

      const [, airline, trncRaw, docNo, dateRaw, rest] = m;
      const trnc = trncRaw.toUpperCase();
      seenTxn++;

      const nums = (rest.match(MONEY_RE) || []).map(money);
      if (nums.length === 0) {
        // A void with no money at all still belongs in the ledger as a record.
        result.push({
          ticketNo: cleanTk(docNo), pnr: '', passengerName: '',
          airlineCode: airline, route: '', date: bspDate(dateRaw),
          amount: 0, totalDoc: 0, commission: 0, reqNum: '',
          vendorReference: billingPeriod, status: 'VOID',
          currency, source: IATA_VENDOR, channel, rawType: trnc,
        });
        continue;
      }

      // The first money token is the Transaction Amount (the fare), the last
      // is the Balance Payable. Everything between is the tax/fee breakdown
      // and the commission columns — which vary in count from line to line,
      // so they are never read positionally.
      const fare = cents(nums[0]);
      const payable = cents(nums[nums.length - 1]);
      // Commission is whatever reconciles the invoice's own formula. Deriving
      // it this way rather than by column index is what makes the parser
      // tolerant of the layout shifting between rows and between issuers.
      const commission = cents(fare - payable);

      const isRefund = trnc === 'RFND' || trnc === 'RFNC' || section === 'REFUNDS';
      const isVoid = trnc === 'CANX' || trnc === 'CANN';
      const isEmd = trnc.startsWith('EMD');

      if (!KNOWN_TRNC.has(trnc)) {
        // Unrecognised type: still imported, with its financial values intact
        // and its raw code preserved, then reported. Never dropped — a type
        // that disappears silently takes its money out of the totals with it.
        unknownTypes.set(trnc, (unknownTypes.get(trnc) ?? 0) + 1);
      }

      let status: string;
      if (isVoid) status = 'VOID';
      else if (isRefund) status = 'REFUND';
      else if (isEmd) status = 'EMDS';
      else if (trnc === 'ADMA' || trnc === 'ADNT' || trnc === 'SPDR') status = 'ADM';
      else if (trnc === 'ACMA' || trnc === 'ACNT' || trnc === 'SPCR') status = 'ACM';
      else status = 'ISSUE';

      // Signs come from the invoice itself — a refund line already carries
      // negative figures, so they are used as-is rather than being re-derived
      // with Math.abs, which would silently turn a refund into a sale.
      const finalPayable = isVoid ? 0 : payable;
      const finalFare = isVoid ? 0 : fare;

      // Sanity-check the derived commission. Note this cannot be a check of
      // "fare - commission == payable": commission IS defined as fare minus
      // payable, so that equation holds by construction and would catch
      // nothing. What can actually be verified is plausibility — commission is
      // a cut of the fare, so it can never exceed it, and it can never run
      // against its sign. Either would mean the money tokens were misread
      // (a stray tax column picked up as the payable, say).
      // These guards apply ONLY where a fare exists to compare against.
      //
      // A memo can legitimately carry no fare and consist purely of a
      // commission adjustment. A real ADMA on this account reads
      //   0.00 ... -104.36 ... 104.36
      // zero transaction amount, commission recalled, so 0 - (-104.36) =
      // 104.36 becomes payable. Applying "commission cannot exceed the fare"
      // there rejects a correct row — which is how a genuine 104.36 debit
      // memo went missing.
      const hasFare = Math.abs(finalFare) > 0.005;
      if (!isVoid && hasFare && Math.abs(commission) > Math.abs(finalFare) + 0.011) {
        errors.push(
          `${trnc} ${docNo}: derived commission ${commission.toFixed(2)} exceeds the fare ${finalFare.toFixed(2)} — line misread, skipped.`
        );
        continue;
      }
      if (!isVoid && hasFare && commission !== 0 && Math.sign(commission) !== Math.sign(finalFare)) {
        errors.push(
          `${trnc} ${docNo}: commission ${commission.toFixed(2)} has the opposite sign to the fare ${finalFare.toFixed(2)} — line misread, skipped.`
        );
        continue;
      }

      result.push({
        ticketNo: cleanTk(docNo),
        pnr: '',
        passengerName: '',
        airlineCode: airline || airlineCode(docNo),
        route: '',
        date: bspDate(dateRaw),
        amount: finalPayable,      // ledger figure: what is actually owed
        totalDoc: Math.abs(finalFare),
        commission,
        reqNum: '',
        vendorReference: billingPeriod,
        status,
        currency,
        // Vendor stays IATA for every channel: WEBSALES-EDIS is a settlement
        // channel, not a vendor, and putting it in source would detach those
        // rows from IATA tracking and from wallet matching.
        source: IATA_VENDOR,
        channel,
        rawType: trnc,
      });
    }

    if (seenTxn === 0) {
      errors.push('No BSP transaction lines found in this PDF.');
    }
    const web = result.filter(r => r.channel === 'WEBSALES-EDIS').length;
    if (web > 0) {
      warnings.push(
        `${web} WEBSALES-EDIS transaction(s) found — recorded under vendor IATA with channel WEBSALES-EDIS.`
      );
    }
    if (unknownTypes.size > 0) {
      const list = [...unknownTypes.entries()].map(([t, n]) => `${t} (${n})`).join(', ');
      warnings.push(`Unsupported IATA document type(s) imported and flagged, not skipped: ${list}. Their amounts are included in the totals.`);
    }
    const withComm = result.filter(r => Math.abs(r.commission ?? 0) > 0.005).length;
    if (withComm > 0) {
      warnings.push(`${withComm} transaction(s) carry commission on this invoice.`);
    }

    return { rows: result, errors, warnings };
  },
};
