import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk } from './shared';
import { resolveReq, findReqColumn, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency } from '../helpers/resolveCurrency';
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
    const iPax = col(headers,'Passenger'); const iDate = col(headers,'PNR creation date');
    const iAmt = col(headers,'Total'); const iStatus = col(headers,'Action');
    const iComm = col(headers,'Commission','commission');
    // An explicit user-added Req column wins first. Otherwise RTS's req column
    // has no recognizable header text in the source export — findReqColumn()
    // returns -1, so we fall back to the one known position (col 4).
    let iReq = findExplicitReqColumn(headers);
    if (iReq === -1) iReq = findReqColumn(headers);
    if (iReq === -1) iReq = 4;
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
      const normSt = normalizeStatus(cell(row,iStatus));
      const status = normSt !== 'UNKNOWN' ? normSt : 'ISSUE';
      const amt = num(cell(row,iAmt)); const comm = num(cell(row,iComm));
      const finalAmt = status==='REFUND'?-Math.abs(amt):Math.abs(amt);
      const rtsReq = resolveReq(cell(row, iReq));
      if (!rtsReq) warnings.push(`Ticket ${tkClean}: Missing Req Num`);
      result.push({ticketNo:tkClean,pnr:cell(row,iPNR).replace(/\s+/g,'').toUpperCase(),passengerName:cleanPax(cell(row,iPax)),airlineCode:ac,date:parseDate(cell(row,iDate)),amount:finalAmt,totalDoc:Math.abs(finalAmt),commission:comm,reqNum:rtsReq,vendorReference:cell(row,iReq),status,currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
