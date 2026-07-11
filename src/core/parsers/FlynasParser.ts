import { VendorParser, ParserResult } from './types';
import { col, cell, cleanPax, rowContentId } from './shared';
import { resolveReq, pickReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { isValidPNR } from '../helpers/isValidTicket';
import { SupportedCurrency } from '../helpers/resolveCurrency';

export const FlynasParser: VendorParser = {
  id: 'FLYNAS', name: 'Flynas',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('pnr2')&&(hj.includes('req.number')||hj.includes('reqnumber'));
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iPNR = col(headers,'PNR2'); const iPax = col(headers,'pax');
    const iDate = col(headers,'Date'); const iAmt = col(headers,'AMOUNT');
    const iReq = pickReqColumn(headers, col(headers,'REQ. NUMBER','REQ NUMBER','Req Number'));
    const iRoute = col(headers,'Column6','Route');
    rows.forEach((row,idx) => {
      const pnr = cell(row,iPNR).replace(/\s+/g,'').toUpperCase();
      const pax = cell(row,iPax);
      if (/beg\.?\s*balance/i.test(pnr)) return;
      // FUND rows legitimately have no PNR at all — must be checked before
      // the empty-PNR bailout below, or a genuine top-up (e.g. "Fund" with
      // amount -15000 and blank PNR2) gets silently dropped.
      if (/^fund$/i.test(pax.trim())) {
        const rawAmt = cell(row,iAmt).replace(/SAR|,|\s/gi,'');
        const fundAmt = Math.abs(parseFloat(rawAmt)||0);
        if (fundAmt>0) result.push({ticketNo:`FLYNAS_FUND_${rowContentId(row)}`,pnr:'',passengerName:'BALANCE TOP-UP',date:parseDate(cell(row,iDate)),amount:fundAmt,totalDoc:fundAmt,commission:0,reqNum:'',status:'FUND',currency:defaultCurrency,isTopUp:true});
        return;
      }
      if (!pnr) return;
      if (!isValidPNR(pnr)) return;
      const rawAmt = cell(row,iAmt).replace(/SAR|,|\s/gi,'');
      const amt = parseFloat(rawAmt)||0; if(amt===0) return;
      const finalAmt = amt<0?amt:amt;
      const req = resolveReq(cell(row,iReq));
      if (!req) warnings.push(`PNR ${pnr}: Missing Req Num`);
      result.push({ticketNo:pnr,pnr,passengerName:cleanPax(pax),route:cell(row,iRoute).toLowerCase().trim(),date:parseDate(cell(row,iDate)),amount:finalAmt,totalDoc:Math.abs(finalAmt),commission:0,reqNum:req,vendorReference:cell(row,iReq),status:amt<0?'REFUND':'ISSUE',currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
