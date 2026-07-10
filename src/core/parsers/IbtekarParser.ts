import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk } from './shared';
import { resolveReq, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency } from '../helpers/resolveCurrency';

export const IbtekarParser: VendorParser = {
  id: 'IBTEKAR', name: 'Ibtekar',
  detect: (headers) => {
    const hj = headers.map(c=>(c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return hj.includes('fileno')&&hj.includes('ticket')&&hj.includes('debit')&&hj.includes('sector');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    // File No IS Ibtekar's req AND drives its top-up detection — keep it.
    // But an explicit user-added Req column, if present, supplies the req.
    const iFileNo = col(headers,'File No','FileNo');
    const iExplicitReq = findExplicitReqColumn(headers);
    const iTicket = col(headers,'Ticket'); const iPNR = col(headers,'PNR');
    const iDate = col(headers,'Issue Date'); const iPax = col(headers,'Passenger');
    const iDebit = col(headers,'Debit'); const iRoute = col(headers,'Sector');
    const iDocNo = col(headers,'Doc No');
    rows.forEach((row,idx) => {
      const rawTk = cell(row,iTicket); const fileNo = cell(row,iFileNo);
      const isTopUp = /^(topup|fund|top.?up)$/i.test(fileNo)||/^RV\d+$/i.test(rawTk);
      if (isTopUp) {
        const credit = num(cell(row,iDebit+1))||num(cell(row,iDebit));
        if (credit>0) result.push({ticketNo:`FUND_${Date.now()}${idx}`,pnr:'',passengerName:'BALANCE TOP-UP',date:parseDate(cell(row,0)),amount:credit,totalDoc:credit,commission:0,reqNum:'',status:'FUND',currency:defaultCurrency,isTopUp:true});
        return;
      }
      // Same "3-digit airline code + dash + ticket digits" shape cleanTk()/airlineCode()
      // already parse — accept the dash with or without surrounding spaces (source
      // export is inconsistent: "065 - 123..." on some rows, "065-123..." on others).
      const hasTk = /^\d{3}\s*[-–]\s*\d+/.test(rawTk)||/^\d{10,}$/.test(rawTk.replace(/\s/g,''));
      if (!hasTk) { if(row.some(c=>c?.trim()))errors.push(`Row ${idx+2}: Ibtekar - no ticket [${rawTk}]`); return; }
      const tkClean = cleanTk(rawTk); const ac = airlineCode(rawTk);
      const debit = num(cell(row,iDebit)); const credit = num(cell(row,iDebit+1));
      const docNo = cell(row,iDocNo);
      const isRef = /^RFD/i.test(docNo)||(credit>0&&debit===0);
      const amt = isRef ? -Math.abs(credit||debit) : debit;
      const req = resolveReq(iExplicitReq !== -1 ? cell(row, iExplicitReq) : fileNo);
      if (!req) warnings.push(`Ticket ${tkClean}: Missing Req Num`);
      const dp = (cell(row,iDate)||'').split('/');
      const date = dp.length===3 ? `${dp[2]}-${dp[1]}-${dp[0]}` : parseDate(cell(row,iDate));
      result.push({ticketNo:tkClean,pnr:cell(row,iPNR).replace(/\s+/g,'').toUpperCase(),passengerName:cleanPax(cell(row,iPax)),airlineCode:ac,route:cell(row,iRoute),date,amount:amt,totalDoc:Math.abs(amt),commission:0,reqNum:req,vendorReference:fileNo,status:isRef?'REFUND':'ISSUE',currency:defaultCurrency});
    });
    return {rows:result,errors,warnings};
  },
};
