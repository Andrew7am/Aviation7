import { VendorParser, ParserResult } from './types';
import { col, cell, numNoText, cleanPax, airlineCode } from './shared';
import { resolveReq } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency } from '../helpers/resolveCurrency';
import { normalizeStatus } from '../helpers/normalizeStatus';

export const AirArabiaParser: VendorParser = {
  id: 'AIRARABIA', name: 'AirArabia',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('referencecode')&&hj.includes('debitamount')&&hj.includes('ticketnumber');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iTicket = col(headers,'Ticket Number','ticket number');
    const iPNR = col(headers,'Remarks'); const iPax = col(headers,'Custmoner name','Customer name','customer name');
    const iDate = col(headers,'Transaction date','Transaction Date');
    const iDebit = col(headers,'Debit Amount','debit amount');
    const iReq = col(headers,'Request Number');
    rows.forEach((row,idx) => {
      const debit = numNoText(cell(row,iDebit)); const credit = numNoText(cell(row,iDebit+1));
      if (debit===0&&credit===0) return;
      if (credit>0&&debit===0&&!cell(row,iTicket)&&!cell(row,iPNR)) {
        result.push({ticketNo:`FUND_${Date.now()}${idx}`,pnr:'',passengerName:'BALANCE TOP-UP',date:parseDate(cell(row,iDate)),amount:credit,totalDoc:credit,commission:0,reqNum:'',status:'FUND',currency:defaultCurrency,isTopUp:true});
        return;
      }
      const tkRaw = cell(row,iTicket).replace(/[^0-9]/g,'');
      const pnr = cell(row,iPNR).replace(/\s+/g,'').toUpperCase();
      if (!tkRaw&&!pnr) return;
      const ticketId = tkRaw||pnr;
      const normSt = normalizeStatus(cell(row,col(headers,'Status','status')));
      const status = normSt !== 'UNKNOWN' ? normSt : (credit>0&&debit===0?'REFUND':'ISSUE');
      const amt = status==='REFUND'?-Math.abs(credit||debit):debit;
      const req = resolveReq(cell(row,iReq));
      if (!req) warnings.push(`Ticket ${ticketId}: Missing Req Num`);
      result.push({ticketNo:ticketId,pnr,passengerName:cleanPax(cell(row,iPax)),airlineCode:airlineCode(tkRaw),date:parseDate(cell(row,iDate)),amount:amt,totalDoc:Math.abs(amt),commission:0,reqNum:req,vendorReference:cell(row,iReq),status,currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
