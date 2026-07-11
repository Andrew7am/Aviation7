import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, rowContentId } from './shared';
import { resolveReq, pickReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency, resolveCurrency } from '../helpers/resolveCurrency';

export const FlyAdealDXBParser: VendorParser = {
  id: 'FLYADEAL_DXB', name: 'FlyAdeal DXB',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('paymentdate')&&hj.includes('pnr')&&hj.includes('accountamount');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iPNR = col(headers,'pnr'); const iDate = col(headers,'paymentDate','paymentdate');
    const iPax = col(headers,'passenger_Name','passenger_name','passenger');
    const iAmt = col(headers,'accountAmount','accountamount','bookingAmount','bookingamount');
    const iCurr = col(headers,'accountCurrency','accountcurrency'); // used for SAR-skip only
    const iReq = pickReqColumn(headers, col(headers,'Req number','Req Number','REQ NUMBER','req'));
    rows.forEach((row,idx) => {
      // SAR rows = internal FlyAdeal transfers, not AED-billed ticket charges — skip
      const acctCurr = (row[iCurr]||'').trim().toUpperCase();
      if (acctCurr==='SAR') return;
      const pnr = cell(row,iPNR).replace(/\s+/g,'').toUpperCase();
      const amt = num(cell(row,iAmt)); if(amt===0) return;
      // A missing/short PNR with a real amount is a balance adjustment line
      // (fund movement), not a real booking — still real money, so keep it
      // with a placeholder reference instead of silently dropping it.
      const hasPnr = !!pnr && pnr.length>=5;
      if (!hasPnr) warnings.push(`Row ${idx+2}: FlyAdeal DXB - no PNR, using placeholder`);
      const ticketId = hasPnr ? pnr : `FLYADEAL_DXB_NOREF_${rowContentId(row)}`;
      // resolveCurrency reads accountCurrency col (and any other currency cols) → single source
      const currency = resolveCurrency(row, headers, defaultCurrency);
      const req = resolveReq(cell(row,iReq));
      if (!req) warnings.push(`PNR ${ticketId}: Missing Req Num`);
      // No "today" fallback here — a blank date must stay deterministically
      // blank, or duplicate detection (which keys on date) silently breaks
      // for this row on every future re-import.
      result.push({ticketNo:ticketId,pnr:hasPnr?pnr:'',passengerName:cleanPax(cell(row,iPax)),date:(cell(row,iDate)||'').split('T')[0],amount:amt<0?amt:amt,totalDoc:Math.abs(amt),commission:0,reqNum:req,vendorReference:cell(row,iReq),status:amt<0?'REFUND':'ISSUE',currency});
    });
    return {rows:result,errors,warnings};
  },
};
