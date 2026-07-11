import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, rowContentId } from './shared';
import { resolveReq, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency } from '../helpers/resolveCurrency';
import { normalizeStatus } from '../helpers/normalizeStatus';

export const GoldMedalParser: VendorParser = {
  id: 'GOLDMEDAL', name: 'Gold Medal',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('customerno')&&hj.includes('routing')&&hj.includes('ticketnumber');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iTicket = col(headers,'Ticket Number','ticket number');
    const iPax = col(headers,'Passenger Name','passenger name');
    const iDate = col(headers,'Invoice Date'); const iAmt = col(headers,'Original Amount');
    const iStatus = col(headers,'Transaction_Type','transaction_type','Status');
    const iRoute = col(headers,'Routing');
    // Gold Medal's "PO Number" header (col 7) matches findReqColumn()'s
    // generic "po number" signal, but it actually holds Gold Medal's own
    // internal booking ref (e.g. "BKR-2026-149934") — NOT our req number.
    // The real req number lives in an unlabeled column (col 5) that also
    // carries city names on invoice-type rows. Because the labeled column
    // is a false match, we deliberately use the fixed position here rather
    // than trusting the header search, and filter obvious non-req values
    // (city names, currency codes) at the value level.
    const iReq = 5;
    // If the user added an explicit Req column, it overrides Gold Medal's
    // fixed-position/city-name heuristic entirely.
    const iExplicitReq = findExplicitReqColumn(headers);
    const REJECT_VALUES = ['DUBAI','CAIRO','RIYADH','JEDDAH','SAR','AED'];
    rows.forEach((row,idx) => {
      const rawGMTk = cell(row,iTicket).replace(/\s*\(\d+\s*PAX\)/i,'').replace(/[^0-9]/g,'');
      const amt = num(cell(row,iAmt));
      // Rows with a real passenger + amount but no ticket number yet (e.g.
      // still pending issuance) shouldn't lose the amount — flag with a
      // placeholder instead of dropping. Rows with neither a ticket number
      // nor any amount are genuinely empty and stay excluded.
      if (!rawGMTk||rawGMTk.length<8) {
        if (amt===0) return;
        warnings.push(`Row ${idx+2}: Gold Medal - no ticket number, using placeholder`);
      }
      const ticketId = (rawGMTk && rawGMTk.length>=8) ? rawGMTk : `GOLDMEDAL_NOREF_${rowContentId(row)}`;
      let rawReqVal: string, req: string;
      if (iExplicitReq !== -1) {
        rawReqVal = cell(row, iExplicitReq).toUpperCase();
        req = resolveReq(rawReqVal);
      } else {
        rawReqVal = cell(row, iReq).toUpperCase();
        const looksLikeReq = rawReqVal && rawReqVal.length>=2 && !REJECT_VALUES.includes(rawReqVal) && !/^[A-Z]{9,}$/.test(rawReqVal);
        req = looksLikeReq ? resolveReq(rawReqVal) : '';
      }
      const normSt = normalizeStatus(cell(row,iStatus));
      const status = normSt !== 'UNKNOWN' ? normSt : 'ISSUE';
      const finalAmt = status==='REFUND'?-Math.abs(amt):Math.abs(amt);
      if (!req) warnings.push(`Ticket ${ticketId}: Missing Req Num`);
      result.push({ticketNo:ticketId,pnr:'',passengerName:cleanPax(cell(row,iPax)),route:cell(row,iRoute),date:parseDate(cell(row,iDate)),amount:finalAmt,totalDoc:Math.abs(finalAmt),commission:0,reqNum:req,vendorReference:rawReqVal,status,currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
