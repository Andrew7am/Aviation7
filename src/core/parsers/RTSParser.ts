import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk } from './shared';
import { resolveReq, findReqColumn, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency, resolveCurrency } from '../helpers/resolveCurrency';
import { extractRoute } from '../helpers/extractRoute';
import { normalizeStatus } from '../helpers/normalizeStatus';

export const RTSParser: VendorParser = {
  id: 'RTS', name: 'RTS',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('recordlocator')&&hj.includes('action');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
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
    let iReq = findExplicitReqColumn(headers);
    if (iReq === -1) iReq = findReqColumn(headers);
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
