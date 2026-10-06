import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk } from './shared';
import { resolveReq, findReqColumn, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency, resolveCurrency } from '../helpers/resolveCurrency';
import { extractRoute } from '../helpers/extractRoute';
import { normalizeStatus } from '../helpers/normalizeStatus';

export const RTSParser: VendorParser = {
  id: 'RTS', name: 'RTS',
  // Two RTS exports: the Sales Report (one row per action, in an "Action"
  // column) and the General Ticket Report (one row per ticket, its state in
  // "DisplayStatus", a date for each thing that happened to it).
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('recordlocator') && (hj.includes('action') || hj.includes('displaystatus'));
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const exact = (name: string) => headers.findIndex(c => (c || '').trim().toLowerCase() === name);
    if (exact('action') === -1 && exact('displaystatus') !== -1) return parseGeneral(rows, headers, defaultCurrency);
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iPNR = col(headers,'Record Locator'); const iNo = col(headers,'No');
    const iPax = col(headers,'Passenger');
    // "Date" is the day the document was issued. "PNR creation date" is the
    // day the booking was opened, which can be months earlier: ZWE5AG was
    // opened on 6 June and its tickets issued on the 10th, and a reissue
    // read off the booking's date lands in a month it was never sold in.
    // Matched exactly, because a loose match finds DepDate or the PNR date.
    const iIssued = headers.findIndex(c => (c || '').trim().toLowerCase() === 'date');
    const iBooked = col(headers,'PNR creation date');
    const iAmt = col(headers,'Total'); const iStatus = col(headers,'Action');
    const iComm = col(headers,'Commission','commission');
    // RTS ships a Route column listing the journey a sector at a time
    // ("MCT-RUH;RUH-MCT"). It was never read, so every RTS ticket landed with
    // no itinerary — and no way to tell a domestic trip from an international
    // one, which is decided from exactly this field.
    const iRoute = col(headers,'Route');
    // "Action" says issue, reissue or refund. A reissue at 0 is a ticket at
    // no charge - the fare is on the one it replaced - and is marked so the
    // import files it under that booking rather than as a bare zero.
    // An explicit user-added Req column wins first, then the broad heuristic.
    // Neither one matching used to fall back to position 4, on the strength
    // of one export that happened to carry the request there. But RTS's own
    // export has no Req column at all, and position 4 in it is SignInBooking
    // — the agent's sign-in code. Every ticket then came in filed under
    // "1132SA": a request number nobody raised, indistinguishable in the
    // ledger from a real one, and silent, because a filled column raises no
    // warning. A file that does not say which request a ticket belongs to is
    // a file that does not say. That is what the warning below is for, and a
    // guessed column is not an answer to it.
    const iReq = findExplicitReqColumn(headers);
    // No broad guess: a blank request is filled from the team's Airtable by ticket number.
    rows.forEach((row,idx) => {
      const rawTk = cell(row,iNo);
      if (!rawTk||!rawTk.includes('-')) return;
      // Strip coupon suffix ONLY when the ticket has one: "220-5512605725-42"
      // (3 parts) → "220-5512605725". The common 2-part form "220-5512605725"
      // has NO coupon, so it must be left intact — a blanket /-\d+$/ strip
      // wrongly removed the whole ticket number, collapsing every RTS ticket
      // to just its 3-digit airline prefix.
      const rtsParts = rawTk.split('-');
      const cleanRTS = rtsParts.length >= 3 ? rtsParts.slice(0, -1).join('-') : rawTk;
      const tkClean = cleanTk(cleanRTS); const ac = airlineCode(cleanRTS);
      const amt = num(cell(row,iAmt)); const comm = num(cell(row,iComm));
      const normSt = normalizeStatus(cell(row,iStatus));
      // Zero total with no explicit status = cancelled/void row (RTS sometimes
      // emits these for cancellations without a status marker). Treat as VOID.
      const status = normSt !== 'UNKNOWN' ? normSt : (amt === 0 ? 'VOID' : 'ISSUE');
      const finalAmt = status==='VOID'   ? 0
                     : status==='REFUND' ? -Math.abs(amt)
                     : Math.abs(amt);
      const freeReissue = /reissue/i.test(cell(row, iStatus)) && status === 'ISSUE' && finalAmt === 0;
      const rtsReq = resolveReq(cell(row, iReq));
      if (!rtsReq) warnings.push(`Ticket ${tkClean}: Missing Req Num`);
      result.push({
        ticketNo: tkClean,
        pnr: cell(row,iPNR).replace(/\s+/g,'').toUpperCase(),
        passengerName: cleanPax(cell(row,iPax)),
        airlineCode: ac,
        route: iRoute !== -1 ? extractRoute(cell(row, iRoute)) : '',
        date: parseDate(cell(row, iIssued !== -1 && cell(row, iIssued) ? iIssued : iBooked)),
        amount: finalAmt,
        totalDoc: Math.abs(finalAmt),
        commission: comm,
        reqNum: rtsReq,
        vendorReference: cell(row,iReq),
        status,
        // RTS bills in AED and says so in its own Total currency column. The
        // parser used to take whatever currency the UI happened to default to,
        // so every RTS ticket was stored as SAR unless the operator remembered
        // to change it by hand. The file is the authority; the UI default is
        // only the fallback for a file that states nothing.
        currency: resolveCurrency(row, headers, defaultCurrency),
        ...(freeReissue ? { freeReissue: true } : {}),
      });
    });
    return {rows:result,errors,warnings};
  },
};

/**
 * RTS's General Ticket Report: one row per ticket, what became of it in
 * "DisplayStatus" (issued / refunded / voided / reissued), and a date for
 * each: Ticketing date, Void date, Refund date, Reissue date.
 *
 * Read as the Sales Report's rows would have been: the sale on the day it
 * was ticketed (or reissued); a void as a void on its void date; a refund as
 * the sale plus a refund row for the "Refund" figure on its refund date - the
 * sale is already in the books and is matched there, the refund is the news.
 * The request is never guessed: RTS has no column for it, and a blank one is
 * filled from the team's Airtable by ticket number.
 */
function parseGeneral(rows: string[][], headers: string[], defaultCurrency: SupportedCurrency): ParserResult {
  const errors: string[] = [], warnings: string[] = [], result: ParserResult['rows'] = [];
  const exact = (name: string) => headers.findIndex(c => (c || '').trim().toLowerCase() === name);
  const iTk = exact('ticket no') !== -1 ? exact('ticket no') : exact('no');
  const iStatus = exact('displaystatus');
  if (iTk === -1) {
    errors.push('RTS General Ticket Report: no "Ticket No" column.');
    return { rows: result, errors, warnings };
  }
  const iPNR = col(headers, 'Record Locator'), iPax = col(headers, 'Passenger'), iRoute = col(headers, 'Route');
  const iTicketed = exact('ticketing date'), iVoided = exact('void date'), iRefunded = exact('refund date');
  const iReissued = exact('reissue date'), iBooked = exact('pnr creation date');
  const iTotal = exact('total') !== -1 ? exact('total') : exact('grand total');
  const iRefund = exact('refund'), iComm = exact('commission');
  const iReq = findExplicitReqColumn(headers);
  const at = (row: string[], i: number) => (i >= 0 ? cell(row, i) : '');

  rows.forEach(row => {
    const rawTk = at(row, iTk);
    if (!rawTk || !rawTk.includes('-')) return;
    const parts = rawTk.split('-');
    const cleanRTS = parts.length >= 3 ? parts.slice(0, -1).join('-') : rawTk;
    const tkClean = cleanTk(cleanRTS);
    const total = num(at(row, iTotal));
    const shown = at(row, iStatus);
    let status = normalizeStatus(shown);
    if (status === 'UNKNOWN') {
      warnings.push(`Ticket ${tkClean}: RTS status "${shown}" not recognised - read as issued`);
      status = 'ISSUE';
    }
    const reissued = !!at(row, iReissued);
    const issuedOn = parseDate(at(row, iTicketed) || at(row, iReissued) || at(row, iBooked));
    const req = resolveReq(at(row, iReq));
    if (!req && status !== 'VOID') warnings.push(`Ticket ${tkClean}: Missing Req Num`);
    const base = {
      ticketNo: tkClean,
      pnr: at(row, iPNR).replace(/\s+/g, '').toUpperCase(),
      passengerName: cleanPax(at(row, iPax)),
      airlineCode: airlineCode(cleanRTS),
      route: iRoute !== -1 ? extractRoute(at(row, iRoute)) : '',
      commission: num(at(row, iComm)),
      reqNum: req,
      vendorReference: at(row, iReq),
      currency: resolveCurrency(row, headers, defaultCurrency),
    };

    if (status === 'VOID') {
      result.push({ ...base, date: parseDate(at(row, iVoided)) || issuedOn, amount: 0, totalDoc: Math.abs(total), status: 'VOID' });
      return;
    }
    // The sale - at no charge on a reissue that cost nothing.
    result.push({ ...base, date: issuedOn, amount: Math.abs(total), totalDoc: Math.abs(total), status: 'ISSUE',
      ...(reissued && total === 0 ? { freeReissue: true } : {}) });
    if (status === 'REFUND') {
      const refund = Math.abs(num(at(row, iRefund)));
      if (refund > 0)
        result.push({ ...base, date: parseDate(at(row, iRefunded)) || issuedOn, amount: -refund, totalDoc: refund, status: 'REFUND' });
      else warnings.push(`Ticket ${tkClean}: RTS says refunded, with no refund amount - the refund was not recorded`);
    }
  });
  return { rows: result, errors, warnings };
}
