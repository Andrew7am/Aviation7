import { VendorParser, ParserResult } from './types';
import { num } from './shared';
import { resolveReq } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';

/**
 * Riyadh Air (RX) DSR export.
 *
 * This vendor's file has NO header row — it's pure data from the first row,
 * ~80 unlabelled columns wide. So instead of resolving columns by name, we
 * anchor on the one unmistakable column (the transaction-type enum) and read
 * every other field at a fixed offset from it. That keeps the mapping intact
 * when the user appends a Req Number column at the end, which is the whole
 * point — a plain fixed-index map would also work until the first extra
 * column shifted everything.
 */

const TXN_TYPES = new Set([
  'PAID_BOOKING', 'UNPAID_BOOKING', 'TICKETING', 'FREE_SEAT', 'PAID_SEAT',
  'REFUND', 'REFUNDED', 'VOID', 'VOIDED', 'CANCELLED', 'CANCELED', 'EXCHANGE',
]);

// Offsets relative to the transaction-type column (index 13 in the sample).
const O = {
  ticketNo:   -9,
  airline:    -8,
  docType:    -3,
  product:    -2,
  pnr:        +1,
  bookingRef: +2,
  payStatus:  +8,
  issueDate:  +10,
  flightNos:  +16,
  route:      +17,
  passenger:  +23,
  paxType:    +24,
  baseFare:   +29,
  taxes:      +30,
  total:      +31,
  paidAmount: +33,
  currency:   +42,
  /** Anything past the vendor's own last column is user-added — that's where
   *  a Req Number column lands when appended to the export. */
  reqScanFrom: +67,
};

const at = (row: string[], anchor: number, offset: number): string =>
  (row[anchor + offset] ?? '').toString().trim();

/** Find the column holding the transaction-type enum. Scans every row so a
 *  stray header/blank row can't throw the detection off. */
function findAnchor(rows: string[][]): number {
  const hits = new Map<number, number>();
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const v = (row[i] ?? '').toString().trim().toUpperCase();
      if (TXN_TYPES.has(v)) hits.set(i, (hits.get(i) ?? 0) + 1);
    }
  }
  let best = -1, bestCount = 0;
  for (const [idx, count] of hits) {
    if (count > bestCount || (count === bestCount && best !== -1 && idx < best)) {
      best = idx; bestCount = count;
    }
  }
  return best;
}

/** Stable synthetic id for rows the vendor issues no document for (holds).
 *  Keyed on PNR + passenger so the same hold keeps its identity across
 *  re-exports — a whole-row hash would change whenever a timestamp moved. */
function holdId(pnr: string, pax: string): string {
  const content = `${pnr}|${pax}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) hash = (hash * 31 + content.charCodeAt(i)) | 0;
  return `RXHOLD_${pnr || 'NOPNR'}_${Math.abs(hash).toString(36)}`;
}

/** Riyadh Air writes names as "GIVEN NAMES/FAMILY NAME" (e.g. "CRISTY REY/DE
 *  LEON"), the reverse of the LAST/FIRST convention cleanPax() assumes — so
 *  normalize here rather than reusing it and getting the order flipped. */
function riyadhPax(raw: string): string {
  return raw.replace(/\//g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

export const RiyadhAirParser: VendorParser = {
  id: 'RIYADHAIR',
  name: 'Riyadh Air',
  headerless: true,
  detect: (headers) => {
    // headers here is really the first data row. Riyadh Air is the only
    // vendor whose rows carry these booking-state enums plus the RX carrier.
    const cells = headers.map(c => (c || '').toString().trim().toUpperCase());
    const hasTxnType = cells.some(c => TXN_TYPES.has(c));
    const hasRX = cells.some(c => c === 'RX');
    return hasTxnType && hasRX;
  },
  parse: (rows, _headers, defaultCurrency): ParserResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result = [];

    const anchor = findAnchor(rows);
    if (anchor === -1) {
      errors.push('Riyadh Air: could not locate the transaction-type column.');
      return { rows: result, errors, warnings };
    }

    // A Req Number column, if the user appended one, sits past the vendor's
    // own columns. Find the first such column that actually holds values.
    let reqCol = -1;
    for (let i = anchor + O.reqScanFrom; i < Math.max(...rows.map(r => r.length)); i++) {
      if (rows.some(r => (r[i] ?? '').toString().trim())) { reqCol = i; break; }
    }

    let skippedFreeSeats = 0;

    rows.forEach((row, idx) => {
      const txn = at(row, anchor, 0).toUpperCase();
      // Not a transaction row (blank filler, or a header row in some future
      // export that does include one) — skip without noise.
      if (!TXN_TYPES.has(txn)) return;

      const payStatus = at(row, anchor, O.payStatus).toUpperCase();
      const pnr       = at(row, anchor, O.pnr).toUpperCase();
      const pax       = riyadhPax(at(row, anchor, O.passenger));
      const route     = at(row, anchor, O.route);
      const rawTicket = at(row, anchor, O.ticketNo).replace(/\s/g, '');
      const total     = num(at(row, anchor, O.total));
      const currency  = (at(row, anchor, O.currency) || defaultCurrency).toUpperCase();

      // Free seat assignments carry no document and no money — they'd only
      // add noise to the ticket list. Counted and reported, never silent.
      if (txn === 'FREE_SEAT') { skippedFreeSeats++; return; }

      const isHold   = txn === 'UNPAID_BOOKING' || payStatus === 'UNPAID';
      const isRefund = txn === 'REFUND' || txn === 'REFUNDED';
      const isVoid   = txn === 'VOID' || txn === 'VOIDED' || txn === 'CANCELLED' || txn === 'CANCELED';
      const isEMD    = txn === 'PAID_SEAT';

      let status: string;
      let amount: number;
      if (isHold)        { status = 'HOLD';   amount = 0; }              // not issued — must not hit the balance
      else if (isVoid)   { status = 'VOID';   amount = 0; }
      else if (isRefund) { status = 'REFUND'; amount = -Math.abs(total); }
      else if (isEMD)    { status = 'EMDS';   amount = Math.abs(total); }
      else               { status = 'ISSUE';  amount = Math.abs(total); }

      // Holds have no ticket number yet (the vendor issues one only on
      // ticketing), so give them a stable synthetic reference instead.
      const ticketNo = rawTicket || (isHold ? holdId(pnr, pax) : '');
      if (!ticketNo) {
        errors.push(`Row ${idx + 1}: Riyadh Air - ${txn} row has no ticket number`);
        return;
      }

      const airline = at(row, anchor, O.airline) || rawTicket.slice(0, 3) || '';
      const req = reqCol !== -1 ? resolveReq(row[reqCol]) : '';
      if (!req && !isHold && !isVoid) warnings.push(`Ticket ${ticketNo}: Missing Req Num`);
      if (isHold) warnings.push(`${pnr} / ${pax}: on hold, not ticketed — excluded from balance`);

      result.push({
        ticketNo,
        pnr,
        passengerName: pax,
        airlineCode: airline,
        route,
        date: parseDate(at(row, anchor, O.issueDate)),
        amount,
        totalDoc: Math.abs(total),
        commission: 0,
        reqNum: req,
        vendorReference: at(row, anchor, O.bookingRef),
        status,
        currency: (currency === 'AED' || currency === 'SAR' ? currency : defaultCurrency) as typeof defaultCurrency,
      });
    });

    if (skippedFreeSeats > 0) {
      warnings.push(`${skippedFreeSeats} complimentary seat assignment row(s) skipped — no document, no charge.`);
    }

    // A hold that has since been ticketed appears in the same export as both
    // an UNPAID_BOOKING row and a real TICKETING row for the same passenger.
    // Keep only the ticket — otherwise the stale hold lingers in the list
    // forever (and reappears on every re-export) as a booking that looks
    // outstanding but isn't.
    const ticketedKeys = new Set(
      result.filter(r => r.status === 'ISSUE').map(r => `${r.pnr}|${r.passengerName}`)
    );
    const superseded = result.filter(r => r.status === 'HOLD' && ticketedKeys.has(`${r.pnr}|${r.passengerName}`));
    if (superseded.length > 0) {
      warnings.push(`${superseded.length} hold(s) already ticketed in this report — superseded by the issued ticket.`);
    }
    const finalRows = result.filter(r => !(r.status === 'HOLD' && ticketedKeys.has(`${r.pnr}|${r.passengerName}`)));

    return { rows: finalRows, errors, warnings };
  },
};
