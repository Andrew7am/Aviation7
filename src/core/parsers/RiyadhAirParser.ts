import { VendorParser, ParserResult } from './types';
import { num } from './shared';
import { resolveReq } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';

/**
 * Riyadh Air (RX) DSR export.
 *
 * This vendor's file has NO header row — it's pure data from the first row,
 * ~80 unlabelled columns wide. There is therefore nothing to match column
 * names against, so every column is located by the SHAPE of its values
 * (a booking-state enum, an RX record locator, a 13-digit document number,
 * a dd-MMM-yyyy date, an IATA route, a currency code...) measured across all
 * rows at once.
 *
 * Resolving by shape rather than by fixed position is what lets the user add
 * a Req Number column — anywhere, not only at the end — without the mapping
 * silently sliding onto the wrong fields. Only the money columns can't be
 * told apart by shape (they're all just numbers), so those are taken at a
 * known offset from the currency column and then validated; if validation
 * fails the parser reports it instead of importing wrong amounts.
 */

const TXN_TYPES = new Set([
  'PAID_BOOKING', 'UNPAID_BOOKING', 'TICKETING', 'FREE_SEAT', 'PAID_SEAT',
  'REFUND', 'REFUNDED', 'VOID', 'VOIDED', 'CANCELLED', 'CANCELED', 'EXCHANGE',
]);

const CURRENCIES = new Set(['AED', 'SAR', 'USD', 'EUR', 'GBP', 'EGP']);

const RE = {
  ticket:   /^\d{13}$/,
  pnr:      /^RX[A-Z0-9]{6,}$/i,
  route:    /^[A-Z]{3}(?:-[A-Z]{3})+$/,
  date:     /^\d{1,2}-[A-Za-z]{3}-\d{4}$/,
  passenger: /^[A-Z][A-Z0-9 .'\-]*\/[A-Z][A-Z0-9 .'\-]*$/i,
  money:    /^-?\d+(?:\.\d+)?$/,
  /** Flight designator(s), e.g. "RX401" or "RX401/RX402". */
  flight:   /^[A-Z]{2}\d{1,4}(?:\/[A-Z]{2}\d{1,4})*$/i,
};

const val = (row: string[], i: number): string =>
  i >= 0 && i < row.length ? (row[i] ?? '').toString().trim() : '';

/** Index of the column where `test` holds for the most rows. Ties go to the
 *  leftmost column, which matters because this format repeats the PNR and
 *  the route later in the row. */
function findCol(rows: string[][], test: (v: string) => boolean): number {
  const hits = new Map<number, number>();
  const width = Math.max(...rows.map(r => r.length), 0);
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const v = val(row, i);
      if (v && test(v)) hits.set(i, (hits.get(i) ?? 0) + 1);
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

/** True when a column holds numbers (or blanks) in essentially every row —
 *  used to confirm an offset-derived money column really is money. */
function looksNumeric(rows: string[][], idx: number): boolean {
  if (idx < 0) return false;
  let filled = 0, numeric = 0;
  for (const row of rows) {
    const v = val(row, idx);
    if (!v) continue;
    filled++;
    if (RE.money.test(v)) numeric++;
  }
  return filled > 0 && numeric / filled >= 0.9;
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
    // `headers` is really the first data row. Riyadh Air is the only vendor
    // whose rows carry these booking-state enums alongside the RX carrier.
    const cells = headers.map(c => (c || '').toString().trim().toUpperCase());
    return cells.some(c => TXN_TYPES.has(c)) && cells.some(c => c === 'RX');
  },
  parse: (rows, _headers, defaultCurrency): ParserResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result = [];

    // ── Locate every column by the shape of its values ───────────────────
    const cTxn      = findCol(rows, v => TXN_TYPES.has(v.toUpperCase()));
    if (cTxn === -1) {
      errors.push('Riyadh Air: no booking-status column found (expected PAID_BOOKING / TICKETING / UNPAID_BOOKING).');
      return { rows: result, errors, warnings };
    }
    const cCurrency = findCol(rows, v => CURRENCIES.has(v.toUpperCase()));
    const cTicket   = findCol(rows, v => RE.ticket.test(v));
    const cPnr      = findCol(rows, v => RE.pnr.test(v));
    const cRoute    = findCol(rows, v => RE.route.test(v));
    const cDate     = findCol(rows, v => RE.date.test(v));
    const cPax      = findCol(rows, v => RE.passenger.test(v));
    const cPay      = findCol(rows, v => /^(PAID|UNPAID)$/i.test(v));

    // Money columns are indistinguishable by shape, so take them at the
    // vendor's fixed offsets from the currency column and verify.
    let cTotal = cCurrency !== -1 ? cCurrency - 11 : -1;
    if (!looksNumeric(rows, cTotal)) {
      // Currency column missing or layout shifted — fall back to the offset
      // from the status column, then give up rather than guess.
      const alt = cTxn + 31;
      cTotal = looksNumeric(rows, alt) ? alt : -1;
    }
    if (cTotal === -1) {
      errors.push('Riyadh Air: could not identify the grand-total column — amounts would be wrong, so nothing was imported.');
      return { rows: result, errors, warnings };
    }

    // Locate the user-added Req Number column STRUCTURALLY rather than by
    // guessing at value shapes. The vendor's own export is a fixed 80-column
    // layout, so comparing where the anchor columns actually landed against
    // where they sit natively reveals exactly where an extra column was
    // inserted. Shape-matching alone is not enough here: the export repeats
    // the record locator, and carries flight numbers ("RX401/RX402") and an
    // agent username — all letter+digit strings that look just like a
    // reference number.
    const NATIVE = [
      [cTicket, 4], [cTxn, 13], [cPnr, 14], [cPay, 21],
      [cDate, 23], [cRoute, 30], [cPax, 36], [cCurrency, 55],
    ].filter(([resolved]) => resolved !== -1) as [number, number][];

    const width = Math.max(...rows.map(r => r.length), 0);
    const extraCols = Math.max(0, width - 80);

    let cReq = -1;
    if (extraCols > 0) {
      // Anchors before the insertion point keep their native index; anchors
      // after it are pushed right by the number of inserted columns.
      let lo = 0, hi = width - 1;
      for (const [resolved, native] of NATIVE) {
        if (resolved === native) lo = Math.max(lo, native + 1);         // insertion is after this column
        else if (resolved > native) hi = Math.min(hi, native);          // insertion is at or before it
      }
      const candidates: number[] = [];
      for (let i = lo; i <= hi && i < width; i++) {
        if (!NATIVE.some(([r]) => r === i) && i !== cTotal) candidates.push(i);
      }
      // Among the columns inside the shifted window, take the one that most
      // consistently holds reference-looking values.
      let bestScore = 0;
      for (const i of candidates) {
        let filled = 0, reqish = 0;
        for (const row of rows) {
          const v = val(row, i);
          if (!v || v === '/') continue;
          filled++;
          // Two of the vendor's own columns are letter+digit strings that
          // read like a reference: the record locator repeated near the end
          // of the row, and the flight numbers ("RX401/RX402"). Rule both
          // out explicitly so they can never be imported as a req number.
          const mimicsReference =
            RE.flight.test(v) ||
            v === val(row, cPnr) ||
            v === val(row, cTicket);
          if (!mimicsReference && v.length <= 24 && /[A-Za-z]/.test(v) && /\d/.test(v) && !RE.money.test(v)) reqish++;
        }
        const score = filled > 0 ? reqish / filled : 0;
        if (score >= 0.8 && score > bestScore) { bestScore = score; cReq = i; }
      }
    }

    // ── Walk the rows ────────────────────────────────────────────────────
    let skippedFreeSeats = 0;

    rows.forEach((row, idx) => {
      const txn = val(row, cTxn).toUpperCase();
      // Not a transaction row (blank filler, or a header row in some future
      // export that does include one) — skip without noise.
      if (!TXN_TYPES.has(txn)) return;

      const payStatus = val(row, cPay).toUpperCase();
      const pnr       = val(row, cPnr).toUpperCase();
      const pax       = riyadhPax(val(row, cPax));
      const route     = val(row, cRoute);
      const rawTicket = val(row, cTicket).replace(/\s/g, '');
      const total     = num(val(row, cTotal));
      const cur       = val(row, cCurrency).toUpperCase();

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

      const req = cReq !== -1 ? resolveReq(val(row, cReq)) : '';
      if (!req && !isHold && !isVoid) warnings.push(`Ticket ${ticketNo}: Missing Req Num`);
      if (isHold) warnings.push(`${pnr} / ${pax}: on hold, not ticketed — excluded from balance`);

      result.push({
        ticketNo,
        pnr,
        passengerName: pax,
        airlineCode: rawTicket.slice(0, 3) || '',
        route,
        date: parseDate(val(row, cDate)),
        amount,
        totalDoc: Math.abs(total),
        commission: 0,
        reqNum: req,
        vendorReference: pnr,
        status,
        currency: (CURRENCIES.has(cur) ? cur : defaultCurrency) as typeof defaultCurrency,
      });
    });

    if (skippedFreeSeats > 0) {
      warnings.push(`${skippedFreeSeats} complimentary seat assignment row(s) skipped — no document, no charge.`);
    }
    if (cReq === -1) {
      warnings.push('No Req Number column detected. Add one anywhere in the sheet and it will be picked up automatically.');
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
