import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk, pnrClean, rowContentId } from './shared';
import { resolveReq, pickReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';

/**
 * Turkish Airlines (TK) agent sales report.
 *
 * A clean, properly-headed export: one row per document, an explicit
 * Operation Type word, its own Currency column, and — unusually — a "req num"
 * column the agency already keeps inside the vendor's own file.
 *
 * Two things about this format need care:
 *
 * 1. There is NO passenger-name column. Rows are identified by ticket number,
 *    falling back to PNR.
 * 2. The ticket numbers are 13-digit values stored as NUMBERS, which Excel
 *    renders as "2.35254E+12". They are read via the raw cell value (see
 *    readFileAsText) — if a row still arrives in exponent form it is rejected
 *    rather than imported, because every such row would carry the same
 *    meaningless id and collapse the report onto a single ticket.
 */
export const TurkishAirlinesParser: VendorParser = {
  id: 'TURKISH',
  name: 'Turkish Airlines',

  detect: (headers) => {
    const hj = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
    return hj.includes('operationtype') &&
           hj.includes('ticketnumber') &&
           (hj.includes('totalfare') || hj.includes('basefare'));
  },

  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result = [];

    const iTicket = col(headers, 'Ticket Number', 'TicketNumber');
    const iPNR    = col(headers, 'PNR');
    const iDate   = col(headers, 'Transaction Date', 'TransactionDate');
    const iOp     = col(headers, 'Operation Type', 'OperationType');
    const iTotal  = col(headers, 'Total Fare', 'TotalFare');
    const iBase   = col(headers, 'Base Fare', 'BaseFare');
    const iTax    = col(headers, 'Taxes', 'Tax');
    const iCur    = col(headers, 'Currency');
    const iRoute  = col(headers, 'Route', 'Sector', 'Itinerary');
    const iPax    = col(headers, 'Passenger', 'Pax Name', 'Passenger Name');
    // "req num" is a real column in this vendor's own export, so it is offered
    // as the vendor alias; an explicitly-named Req column still wins.
    const iReq    = pickReqColumn(headers, col(headers, 'req num', 'reqnum', 'Req Number'));

    if (iTicket === -1 || iOp === -1) {
      errors.push('Turkish Airlines: required columns missing (Ticket Number / Operation Type).');
      return { rows: result, errors, warnings };
    }

    rows.forEach((row, idx) => {
      if (!row.some(c => c?.trim())) return;

      const rawTk = cell(row, iTicket).replace(/\s+/g, '');
      const pnr   = pnrClean(cell(row, iPNR));

      // Excel exponent form means the real number was lost on the way in.
      // Importing it would give every row the same id, so refuse the row and
      // say exactly how to fix the file.
      if (/e\+?\d+$/i.test(rawTk)) {
        errors.push(`Row ${idx + 2}: Turkish Airlines - ticket number arrived as "${rawTk}" (Excel scientific notation). Format that column as Text or Number with 0 decimals and re-export.`);
        return;
      }

      const opRaw = cell(row, iOp).toUpperCase().trim();
      // Vendor's own vocabulary -> the ledger's statuses. REISSUE is a real
      // exchange that carries its own fare difference, so it settles like an
      // issue; VOID/CANCEL never touch the balance.
      let status: string;
      if (/^ISSUE|^SALE|^TKTT/.test(opRaw))           status = 'ISSUE';
      else if (/^REFUND|^RFND/.test(opRaw))           status = 'REFUND';
      else if (/^REISSUE|^EXCHANGE|^REVALIDAT/.test(opRaw)) status = 'ISSUE';
      else if (/^VOID|^CANCEL|^CANX|^CANN/.test(opRaw))     status = 'VOID';
      else if (/^EMD/.test(opRaw))                    status = 'EMDS';
      else if (/^ADM/.test(opRaw))                    status = 'ADM';
      else if (/^ACM/.test(opRaw))                    status = 'ACM';
      else {
        warnings.push(`Ticket ${rawTk || pnr}: unknown Operation Type "${opRaw}" — treated as ISSUE`);
        status = 'ISSUE';
      }

      const total = iTotal !== -1 ? num(cell(row, iTotal)) : 0;
      const base  = iBase  !== -1 ? num(cell(row, iBase))  : 0;
      const tax   = iTax   !== -1 ? num(cell(row, iTax))   : 0;
      const gross = total || (base + tax);

      const amount = status === 'VOID'   ? 0
                   : status === 'REFUND' ? -Math.abs(gross)
                   : Math.abs(gross);

      let ticketNo = rawTk && /^\d{8,15}$/.test(rawTk) ? cleanTk(rawTk) : '';
      if (!ticketNo) ticketNo = pnr || '';
      if (!ticketNo) {
        // Real money but nothing to key on — keep the amount, flag the row.
        ticketNo = `TURKISH_NOREF_${rowContentId(row)}`;
        warnings.push(`Row ${idx + 2}: Turkish Airlines - no ticket or PNR, using placeholder`);
      }

      const req = resolveReq(iReq >= 0 ? cell(row, iReq) : '');
      if (!req && status !== 'VOID') warnings.push(`Ticket ${ticketNo}: Missing Req Num`);

      const cur = (iCur !== -1 ? cell(row, iCur) : '').toUpperCase();

      result.push({
        ticketNo,
        pnr,
        // This export carries no passenger column; keep the field empty rather
        // than borrowing another column and inventing a name.
        passengerName: iPax !== -1 ? cleanPax(cell(row, iPax)) : '',
        airlineCode:   airlineCode(rawTk),
        route:         iRoute !== -1 ? cell(row, iRoute) : '',
        date:          parseDate(cell(row, iDate)),
        amount,
        totalDoc:      Math.abs(gross),
        commission:    0,
        reqNum:        req,
        vendorReference: pnr,
        status,
        currency: (cur === 'AED' || cur === 'SAR' ? cur : defaultCurrency) as typeof defaultCurrency,
      });
    });

    return { rows: result, errors, warnings };
  },
};
