import { VendorParser, ParserResult, ParsedRow } from './types';
import { cleanTk, airlineCode } from './shared';
import { SupportedCurrency } from '../helpers/resolveCurrency';
import { decodeRuns, type PdfRun } from '../helpers/pdfText';

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
 *   Balance Payable = Transaction Amount CA FOP (or 0)
 *                     - Std Comm - Supp Comm +/- Tax on Comm
 *
 * Note "CA FOP (or 0)": only a CASH sale contributes to what settles through
 * BSP. On a credit-card sale the airline collects from the passenger directly,
 * so Balance Payable is 0.00 while the transaction amount is not. That is why
 * commission must be READ from the Std and Supp Commission columns and never
 * derived as fare - payable: on a card row the derivation returns the entire
 * fare as commission.
 *
 * Mapping onto the ledger, which already models all three values:
 *   totalDoc   = Transaction Amount (the fare, gross)
 *   commission = Std Comm + Supp Comm, as printed
 *   amount     = Balance Payable  (what is actually owed — the ledger figure)
 *
 * Each row arrives as two CSV fields (see readFileAsText): the row's text, and
 * its runs with their x positions. The positions are what make the columns
 * readable — a PDF row has no delimiters, and the tax/fee columns vary in
 * count from row to row, so token order identifies nothing.
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

/**
 * Where each money column sits on the page.
 *
 * The invoice prints its own heading row:
 *
 *   AIR TRNC Number Date CPUI Code STAT FOP  Amount  Amount  TAX  F&C  PEN
 *       Amount  Rate  Amt  Rate  Amt  Comm  Payable
 *
 * reading, left to right: Transaction Amount, FARE Amount, the three tax
 * columns, COBL Amount, Standard Commission rate and amount, Supplementary
 * Commission rate and amount, Tax on Commission, and Balance Payable.
 */
interface Columns {
  txn: number; fare: number; cobl: number;
  taxCols: number[];
  stdRate: number; stdAmt: number;
  suppRate: number; suppAmt: number;
  taxOnComm: number; payable: number;
}

/** Locate the columns from the heading row. Returns null when the grid carries
 *  no positions at all, which must fail loudly rather than fall back to
 *  guessing which number is a commission. */
function findColumns(runsPerRow: PdfRun[][]): Columns | null {
  for (const runs of runsPerRow) {
    const at = (label: string) => runs.filter(r => r.text.trim() === label).map(r => r.x).sort((a, b) => a - b);
    const amounts = at('Amount');
    const amts = at('Amt');
    const rates = at('Rate');
    const payable = at('Payable');
    const taxOnComm = at('Comm');
    // The heading row is the one carrying all of these at once.
    if (amounts.length < 3 || amts.length < 2 || rates.length < 2 || !payable.length || !taxOnComm.length) continue;
    const taxCols = [...at('TAX'), ...at('F&C'), ...at('PEN')];
    return {
      txn: amounts[0], fare: amounts[1], cobl: amounts[2], taxCols,
      stdRate: rates[0], stdAmt: amts[0],
      suppRate: rates[1], suppAmt: amts[1],
      taxOnComm: taxOnComm[0], payable: payable[0],
    };
  }
  return null;
}

/**
 * Assign every money token on a row to the column it physically sits under.
 *
 * Each number goes to its NEAREST column, which is what makes the reading
 * robust: the tax and fee columns vary in how many are printed from row to
 * row, so counting tokens tells you nothing, but a number's position tells you
 * exactly which column it belongs to.
 */
function readColumns(runs: PdfRun[], c: Columns): Record<keyof Columns | 'none', number | undefined> {
  const centres: [string, number][] = [
    ['txn', c.txn], ['fare', c.fare], ['cobl', c.cobl],
    ['stdRate', c.stdRate], ['stdAmt', c.stdAmt],
    ['suppRate', c.suppRate], ['suppAmt', c.suppAmt],
    ['taxOnComm', c.taxOnComm], ['payable', c.payable],
    ...c.taxCols.map((x, i) => [`tax${i}`, x] as [string, number]),
  ];
  const out: Record<string, number | undefined> = {};
  const dist: Record<string, number> = {};
  for (const run of runs) {
    const t = run.text.trim();
    if (!MONEY_CELL_RE.test(t)) continue;
    let best = centres[0];
    for (const cand of centres) {
      if (Math.abs(run.x - cand[1]) < Math.abs(run.x - best[1])) best = cand;
    }
    const d = Math.abs(run.x - best[1]);
    // Keep the closest candidate when two numbers land on one column.
    if (out[best[0]] === undefined || d < dist[best[0]]) { out[best[0]] = cents(money(t)); dist[best[0]] = d; }
  }
  return out as Record<keyof Columns | 'none', number | undefined>;
}

/** A whole cell that is a money value — anchored, unlike the scanning MONEY_RE. */
const MONEY_CELL_RE = /^-?\d{1,3}(?:,\d{3})*\.\d{2}$|^-?\d+\.\d{2}$/;

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

    // Cell 0 is the row's text; cell 1 carries its runs with their x positions.
    const lines = rows.map(r => (r[0] ?? '').toString());
    const runsPerRow = rows.map(r => decodeRuns((r[1] ?? '').toString()));

    // Money columns are located from the invoice's own heading row rather than
    // hardcoded, so a shift in the layout moves the columns with it.
    const columns = findColumns(runsPerRow);
    if (!columns) {
      return {
        rows: [], warnings,
        errors: ['This BSP invoice carries no column positions, so Standard and '
               + 'Supplementary Commission cannot be told apart from the tax '
               + 'columns. Import the original PDF rather than a converted copy.'],
      };
    }

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

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
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

      const cols = readColumns(runsPerRow[lineIdx] ?? [], columns);
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

      // Every value is read from its own column.
      //
      // Commission is NOT derived as fare - payable. That derivation is wrong
      // whenever the two are not related by commission alone, and the invoice
      // says so itself in its footnote:
      //
      //   Balance Payable = Transaction Amount CA FOP (or 0)
      //                     - Std Comm - Supp Comm +/- Tax on Comm
      //
      // "CA FOP (or 0)" means only a CASH sale contributes; on a credit-card
      // sale the airline collects directly, so Balance Payable is 0.00 while
      // the transaction amount is not. Deriving there manufactures a
      // commission equal to the entire fare — 341,050.00 of phantom
      // commission across this agent's 18 card rows.
      const fare = cents(cols.txn ?? 0);
      const payable = cents(cols.payable ?? 0);
      const commission = cents((cols.stdAmt ?? 0) + (cols.suppAmt ?? 0));

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

      // Now that commission is read rather than derived, these guards test
      // something real: a commission is a cut of the fare, so it cannot exceed
      // it, and it cannot run against its sign. Either would mean a number was
      // picked up from the wrong column.
      //
      // They apply ONLY where a fare exists to compare against. A memo can
      // legitimately carry no fare and consist purely of a commission
      // adjustment — a real ADMA on this account reads
      //   0.00 ... -104.36 ... 104.36
      // zero transaction amount, commission recalled. Applying "commission
      // cannot exceed the fare" there rejects a correct row, which is how a
      // genuine 104.36 debit memo went missing.
      const hasFare = Math.abs(finalFare) > 0.005;
      if (!isVoid && hasFare && Math.abs(commission) > Math.abs(finalFare) + 0.011) {
        errors.push(
          `${trnc} ${docNo}: commission ${commission.toFixed(2)} exceeds the fare ${finalFare.toFixed(2)} — line misread, skipped.`
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
