import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax } from './shared';
import { resolveReq, pickReqColumn } from '../helpers/resolveReq';
import { SupportedCurrency } from '../helpers/resolveCurrency';

export const FlyAdealKSAParser: VendorParser = {
  id: 'FLYADEAL_KSA', name: 'FlyAdeal KSA',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('recordlocator')&&(hj.includes('pnrtotal')||hj.includes('totalinorgcurrency'));
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iPNR = col(headers,'recordLocator','recordlocator');
    const iPax = col(headers,'passengerName','passengername');
    const iAmt = col(headers,'pnrTotal','pnrtotal','totalInOrgCurrency');
    const iDate = col(headers,'departureDate','departuredate');
    const iStatus = col(headers,'status','Status');
    const iRoute = col(headers,'legDetails','legdetails');
    const iReq = pickReqColumn(headers, col(headers,'Req Number','Req number','REQ NUMBER'));
    rows.forEach((row,idx) => {
      const pnr = cell(row,iPNR).replace(/\s+/g,'').toUpperCase();
      if (!pnr||pnr.length<5) return;
      const amt = num(cell(row,iAmt)); if(amt===0) return;
      const req = resolveReq(cell(row,iReq));
      if (!req) warnings.push(`PNR ${pnr}: Missing Req Num`);
      // No "today" fallback — a blank date must stay deterministically blank
      // or duplicate detection (keyed on date) breaks on every re-import.
      result.push({ticketNo:pnr,pnr,passengerName:cleanPax(cell(row,iPax)),route:cell(row,iRoute),date:(cell(row,iDate)||'').split('T')[0],amount:amt,totalDoc:Math.abs(amt),commission:0,reqNum:req,vendorReference:cell(row,iReq),status:amt<0?'REFUND':'ISSUE',currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
