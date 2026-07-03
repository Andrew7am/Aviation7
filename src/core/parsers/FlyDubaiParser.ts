import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax } from './shared';
import { resolveReq } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { isValidPNR } from '../helpers/isValidTicket';
import { SupportedCurrency } from '../helpers/resolveCurrency';

export const FlyDubaiParser: VendorParser = {
  id: 'FLYDUBAI', name: 'FlyDubai',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('invoiceno')&&hj.includes('bookingreference');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iPNR = col(headers,'Booking reference','booking reference');
    const iPax = col(headers,'Passenger name','passenger name');
    const iDate = col(headers,'Payment date','Booked date','payment date');
    const iAmt = col(headers,'Amount'); const iReq = col(headers,'REQ Number','REQ NUMBER','Req Number');
    rows.forEach((row,idx) => {
      const rawPnr = cell(row,iPNR).replace(/\s+/g,'').toUpperCase();
      const amt = num(cell(row,iAmt)); if(amt===0) return;
      // "NA" is FlyDubai's literal placeholder for a booking reference on
      // refund/reversal lines — still a real transaction, just flag it
      // instead of dropping the amount.
      const hasPnr = !!rawPnr && rawPnr!=='NA' && rawPnr.length>=5;
      if (!hasPnr) warnings.push(`Row ${idx+2}: FlyDubai - no booking reference, using placeholder`);
      const ticketId = hasPnr ? rawPnr : `FLYDUBAI_NOREF_${idx}`;
      const req = resolveReq(cell(row,iReq));
      if (!req) warnings.push(`PNR ${ticketId}: Missing Req Num`);
      result.push({ticketNo:ticketId,pnr:hasPnr?rawPnr:'',passengerName:cleanPax(cell(row,iPax)),date:parseDate(cell(row,iDate)),amount:amt,totalDoc:Math.abs(amt),commission:0,reqNum:req,vendorReference:cell(row,iReq),status:amt<0?'REFUND':'ISSUE',currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
