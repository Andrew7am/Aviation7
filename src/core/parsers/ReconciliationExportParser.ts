import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk, pnrClean } from './shared';
import { resolveReq } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { extractRoute } from '../helpers/extractRoute';
import { toCabin } from '../helpers/cabinClass';

/**
 * Re-import of a sheet THIS system exported.
 *
 * The documented workflow is: export the Missing REQ list, type the req
 * numbers into the Req Num column, upload it back. That round trip was
 * broken — no parser recognised our own export, so the file came back as
 * "unknown vendor" and the req numbers could not be applied.
 *
 * Two things make this format different from a vendor report:
 *
 * 1. It can span MANY vendors at once (missing reqs are listed across every
 *    vendor), and each row names its own vendor in a Source column. So each
 *    row carries its own `source` rather than the whole file taking the one
 *    vendor picked in the UI — otherwise every ticket would be relabelled to
 *    a single vendor and charged against the wrong credit.
 *
 * 2. The full export ends with a TOTALS BY CURRENCY block. Those summary
 *    lines look like data to a naive parser, so anything without a real
 *    ticket reference is skipped rather than imported as a phantom ticket.
 *
 * Amounts are taken exactly as exported (already signed) — this is our own
 * data coming home, so it must not be re-derived and risk drifting.
 */
export const ReconciliationExportParser: VendorParser = {
  id: 'RECON_EXPORT',
  name: 'Reconciliation Export (re-import)',

  detect: (headers) => {
    const hj = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
    // "Net Amount" + "Req Num" + "Source" together only occur in our own
    // export; no vendor ships that combination.
    return hj.includes('netamount') && hj.includes('reqnum') && hj.includes('source') &&
           (hj.includes('ticketno') || hj.includes('ticketnumber'));
  },

  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result = [];

    const iTicket = col(headers, 'Ticket No.', 'Ticket No', 'Ticket Number');
    const iSource = col(headers, 'Source');
    const iReq    = col(headers, 'Req Num', 'Req Number');
    const iAmount = col(headers, 'Net Amount', 'NetAmount');
    const iStatus = col(headers, 'Status');
    const iDate   = col(headers, 'Date');
    const iPNR    = col(headers, 'PNR');
    const iPax    = col(headers, 'Passenger');
    const iRoute  = col(headers, 'Route');
    const iAL     = col(headers, 'A/L');
    const iCur    = col(headers, 'Currency');
    const iTotal  = col(headers, 'Total Doc', 'TotalDoc');
    const iComm   = col(headers, 'Commission');
    const iSerial = col(headers, 'Serial');
    const iClosed = col(headers, 'Closed');
    // "Cabin Class (Automated)" in the agency's own export; the plain names
    // are accepted too so a hand-made sheet works without renaming a column.
    const iCabin  = col(headers, 'Cabin Class', 'Cabin', 'Class');
    const cabinRaw = (row: string[]) => iCabin !== -1 ? cell(row, iCabin).trim() : '';

    let skippedSummary = 0;

    /** Footer labels that mark the end of the ticket rows. */
    const isFooterMarker = (row: string[]) => {
      const first = (row[0] ?? '').toString().trim().toUpperCase();
      return first === 'TOTALS BY CURRENCY' || first === 'TOTAL TICKETS' ||
             first === 'REPORT FILTER' || first === 'GENERATED';
    };

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      if (!row.some(c => c?.trim())) continue;

      // Everything from the totals block onward is summary, not data. Stop
      // outright rather than filtering row by row: those rows put numbers in
      // whichever column happens to line up with Ticket No. (a currency
      // subtotal of 1000 was being imported as ticket "1000"), so a
      // per-field emptiness test is not enough to keep them out.
      if (isFooterMarker(row)) {
        skippedSummary += rows.length - idx;
        break;
      }

      const rawTk = cell(row, iTicket).replace(/\s+/g, '');
      const pnr   = pnrClean(cell(row, iPNR));

      if (!rawTk && !pnr) { skippedSummary++; continue; }

      // Second guard: a ticket reference is a long digit run, and a PNR is a
      // 5-8 char alphanumeric. Anything else on this row is stray text.
      const looksLikeTicket = /^\d{6,}$/.test(rawTk.replace(/[^0-9]/g, '')) && rawTk.replace(/[^0-9]/g, '').length >= 6;
      const looksLikePnr    = /^[A-Z0-9]{5,8}$/.test(pnr);
      if (!looksLikeTicket && !looksLikePnr) { skippedSummary++; continue; }

      const source = cell(row, iSource).trim();
      if (!source) {
        // Skip this row only — a bare `return` here would abandon the whole
        // file at the first bad line and silently drop everything after it.
        errors.push(`Row ${idx + 2}: re-import row has no Source — cannot tell which vendor it belongs to.`);
        continue;
      }

      const rawStatus = cell(row, iStatus).toUpperCase().trim();
      const status = rawStatus || 'ISSUE';
      const exported = num(cell(row, iAmount));

      // Keep the exported sign; only re-assert the invariants that must hold
      // regardless, so a hand-edited sign can't flip a refund into a sale.
      const amount = status === 'VOID' || status === 'HOLD' ? 0
                   : status === 'REFUND' ? -Math.abs(exported)
                   : exported;

      const alCol    = iAL !== -1 ? cell(row, iAL) : '';
      const ticketNo = rawTk ? cleanTk(rawTk, alCol) : pnr;
      const req = resolveReq(cell(row, iReq));
      if (!req) warnings.push(`Ticket ${ticketNo}: still has no Req Num — row will not update anything.`);

      const serialRaw = iSerial !== -1 ? cell(row, iSerial).replace(/[^0-9]/g, '') : '';
      const cur = (iCur !== -1 ? cell(row, iCur) : '').toUpperCase();

      result.push({
        ticketNo,
        pnr,
        passengerName: iPax !== -1 ? cleanPax(cell(row, iPax)) : '',
        airlineCode:   airlineCode(rawTk, alCol),
        route:         iRoute !== -1 ? extractRoute(cell(row, iRoute)) : '',
        date:          parseDate(cell(row, iDate)),
        amount,
        totalDoc:      iTotal !== -1 ? Math.abs(num(cell(row, iTotal))) || Math.abs(amount) : Math.abs(amount),
        commission:    iComm !== -1 ? num(cell(row, iComm)) : 0,
        reqNum:        req,
        vendorReference: '',
        status,
        currency: (cur === 'AED' || cur === 'SAR' ? cur : defaultCurrency) as typeof defaultCurrency,
        serial: serialRaw ? parseInt(serialRaw, 10) : undefined,
        closed: iClosed !== -1 ? /^closed$/i.test(cell(row, iClosed).trim()) : undefined,
        // Both together, or neither: the reading is only meaningful beside the
        // text it was read from, and a cabin name nobody has mapped must still
        // arrive so it can be named later rather than silently dropped.
        cabinClass: cabinRaw(row) ? toCabin(cabinRaw(row)) || undefined : undefined,
        cabinRaw:   cabinRaw(row) || undefined,
        source,
      });
    }

    if (skippedSummary > 0) {
      warnings.push(`${skippedSummary} summary/total line(s) at the end of the export were skipped.`);
    }
    if (result.length === 0 && errors.length === 0) {
      errors.push('Re-import file had no rows with a ticket number or PNR.');
    }

    return { rows: result, errors, warnings };
  },
};
