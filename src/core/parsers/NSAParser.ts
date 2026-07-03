import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk } from './shared';
import { resolveReq } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency } from '../helpers/resolveCurrency';

export const NSAParser: VendorParser = {
  id: 'NSA', name: 'NSA',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('lponumber') && hj.includes('requestnumber') && hj.includes('docno');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iTicket = col(headers,'Doc No'); const iPNR = col(headers,'PNR');
    const iPax = col(headers,'Description'); const iDate = col(headers,'DATE');
    const iDebit = col(headers,'DEBIT','DEBIT (SAR)'); const iReq = col(headers,'Request Number');
    const iRoute = col(headers,'LPO NUMBER');
    rows.forEach((row,idx) => {
      if (!row.some(c=>c?.trim())) return;
      const rawDoc = cell(row,iTicket);
      const desc = cell(row,iPax);
      if (/^RV-/i.test(rawDoc)||/^payment/i.test(desc)) {
        const credit = num(cell(row,iDebit+1));
        if (credit>0) result.push({ticketNo:`FUND_${Date.now()}${idx}`,pnr:'',passengerName:'BALANCE TOP-UP',date:parseDate(cell(row,iDate)),amount:credit,totalDoc:credit,commission:0,reqNum:'',status:'FUND',currency:defaultCurrency,isTopUp:true});
        return;
      }
      if (!rawDoc.includes(' - ')&&!/^\d{3}[-]\d+/.test(rawDoc.replace(/\s/g,''))) { if(row.some(c=>c?.trim()))errors.push(`Row ${idx+2}: NSA - no ticket [${rawDoc}]`); return; }
      const tkClean = cleanTk(rawDoc); const ac = airlineCode(rawDoc);
      const debit = num(cell(row,iDebit)); const credit = num(cell(row,iDebit+1));
      const rawDocNo = cell(row,col(headers,'Doc No'));
      const isRef = /^RFD/i.test(rawDocNo)||(credit>0&&debit===0);
      const amt = isRef ? -Math.abs(credit||debit) : debit;
      const req = resolveReq(cell(row,iReq));
      if (!req) warnings.push(`Ticket ${tkClean}: Missing Req Num`);
      result.push({ticketNo:tkClean,pnr:cell(row,iPNR).replace(/\s+/g,'').toUpperCase(),passengerName:cleanPax(desc),airlineCode:ac,route:cell(row,iRoute),date:parseDate(cell(row,iDate)),amount:amt,totalDoc:Math.abs(amt),commission:0,reqNum:req,vendorReference:cell(row,iReq),status:isRef?'REFUND':'ISSUE',currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
