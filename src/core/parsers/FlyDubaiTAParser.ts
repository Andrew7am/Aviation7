import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, rowContentId } from './shared';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency } from '../helpers/resolveCurrency';

/**
 * flydubai's travel agent portal, "TA Transaction Report": one line a booking.
 *
 *   CONFIRMATION_NUM  the booking reference (PNR), which is the document - as
 *                     on every flydubai row in the books
 *   FIRST/LAST_NAME   the lead passenger; TOTALPASSENGERS says how many more
 *   TRANSACTION_DATE  "10/22/2026   2:27:45PM", month first
 *   BOOKEDAMOUNT      what the booking cost - a sale
 *   CANCELLEDAMOUNT   what was given back on it - a refund
 *   DEPOSITS          money put into the account - a top-up
 *   INVOICE_NUM       flydubai's invoice, kept as the vendor reference
 *
 * The older export (Booking reference, Invoice no, Amount) has its own
 * parser; this one matches only this header set. Read as the old one, a
 * booking came in with no PNR, no name and no date (Y4TG8S, 22 Oct 2026).
 */
export const FlyDubaiTAParser: VendorParser = {
  id: 'FLYDUBAI_TA', name: 'FlyDubai',
  detect: (headers) => {
    const h = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    return h.includes('confirmationnum') && h.includes('bookedamount') && h.includes('cancelledamount');
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result = [];
    const iPnr = col(headers, 'CONFIRMATION_NUM');
    const iFirst = col(headers, 'FIRST_NAME'), iLast = col(headers, 'LAST_NAME');
    const iDate = col(headers, 'TRANSACTION_DATE');
    const iInv = col(headers, 'INVOICE_NUM');
    const iCur = col(headers, 'CURRENCY');
    const iDep = col(headers, 'DEPOSITS'), iBooked = col(headers, 'BOOKEDAMOUNT'), iCancelled = col(headers, 'CANCELLEDAMOUNT');
    const iPax = col(headers, 'TOTALPASSENGERS');
    rows.forEach((row, idx) => {
      const pnr = cell(row, iPnr).replace(/\s+/g, '').toUpperCase();
      const date = parseDate(cell(row, iDate).split(/\s+/)[0], 'mdy');
      const currency = ((cell(row, iCur) || defaultCurrency).toUpperCase()) as SupportedCurrency;
      const inv = cell(row, iInv);
      const pax = cleanPax(`${cell(row, iFirst)} ${cell(row, iLast)}`.trim());
      const booked = num(cell(row, iBooked)), cancelled = Math.abs(num(cell(row, iCancelled))), deposit = num(cell(row, iDep));
      if (deposit > 0)
        result.push({ ticketNo: `FLYDUBAI_FUND_${rowContentId(row)}`, pnr: '', passengerName: 'BALANCE TOP-UP', date, amount: deposit, totalDoc: deposit,
          commission: 0, reqNum: '', status: 'FUND', currency, isTopUp: true });
      if (!booked && !cancelled) return;
      if (!pnr) { errors.push(`Row ${idx + 2}: FlyDubai - no confirmation number`); return; }
      const n = Number(cell(row, iPax)) || 0;
      if (n > 1) warnings.push(`${pnr}: one booking for ${n} passengers, recorded under the lead passenger`);
      const base = { ticketNo: pnr, pnr, passengerName: pax, date, commission: 0, reqNum: '', vendorReference: inv, currency };
      if (booked) result.push({ ...base, amount: booked, totalDoc: booked, status: 'ISSUE' });
      if (cancelled) result.push({ ...base, amount: -cancelled, totalDoc: cancelled, status: 'REFUND' });
    });
    return { rows: result, errors, warnings };
  },
};
