import { VendorParser, ParserResult, ParsedRow } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk, rowContentId } from './shared';
import { resolveReq } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { extractRoute } from '../helpers/extractRoute';

/**
 * NSA's statement of account ("Ticketwise Client Statement Of Accounts"),
 * uploaded as its Excel file or pasted from it.
 *
 * Not their sales report (NSAParser: LPO NUMBER, Request Number): this is
 * the account itself - a balance brought forward, then one line per
 * document with Debit, Credit and the running Balance, ending "Amount Due
 * To Us". Until 1 Nov 2026 it was read by hand: the 16-20 Oct statement's
 * two ADMs went in through a script.
 *
 *   a ticket      Ticket names it: a sale (debit) or its refund (credit)
 *   an ADM        DMA-... in Doc No and ADM-... in Ticket (27 Oct 2026),
 *                 the ticket it is raised on in Narration: recorded as NSA's
 *                 earlier ADMs are - its ADM number, under the request "ADM"
 *   a receipt     Doc No RV-...: a payment, a top-up of the account
 *   the rest      Balance B/F, TOTAL, Amount Due To Us: not documents
 */
export const NSAStatementParser: VendorParser = {
  id: 'NSA_SOA', name: 'NSA',
  detect: (headers) => {
    const h = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    return ['docno', 'ticket', 'passenger', 'sector', 'debit', 'credit', 'balance', 'narration'].every(k => h.includes(k));
  },
  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [], warnings: string[] = [], result: ParsedRow[] = [];
    const i = {
      date: col(headers, 'Date'), file: col(headers, 'File No'), doc: col(headers, 'Doc No'), ticket: col(headers, 'Ticket'),
      pnr: col(headers, 'PNR'), issue: col(headers, 'Issue Date'), lpo: col(headers, 'LPO No'), pax: col(headers, 'Passenger'),
      sector: col(headers, 'Sector'), debit: col(headers, 'Debit'), credit: col(headers, 'Credit'), narration: col(headers, 'Narration'),
    };
    rows.forEach((row, idx) => {
      if (!row.some(c => c?.trim())) return;
      const doc = cell(row, i.doc).trim().toUpperCase();
      const file = cell(row, i.file).trim().toUpperCase();
      const ticketCell = cell(row, i.ticket).trim();
      const debit = num(cell(row, i.debit)), credit = num(cell(row, i.credit));
      const narration = cell(row, i.narration).trim();
      const date = parseDate(cell(row, i.date)) || parseDate(cell(row, i.issue));
      // An ADM's own number sits in the Ticket column, its debit memo in Doc No.
      const adm = [doc, file, ticketCell.toUpperCase()].some(x => /^(ADM|DMA)-/.test(x));
      const ticket = adm ? '' : ticketCell;
      // Balance B/F, TOTAL, Amount Due To Us: the account's own lines.
      if (!doc && !ticketCell) return;
      if (!debit && !credit) { warnings.push(`Row ${idx + 2}: ${doc || ticket} moves no money - skipped.`); return; }

      if (/^RV/.test(doc)) {
        result.push({ ticketNo: `NSA_FUND_${doc}`, pnr: '', passengerName: 'BALANCE TOP-UP', date, amount: credit - debit, totalDoc: Math.abs(credit - debit),
          commission: 0, reqNum: '', status: 'FUND', currency: defaultCurrency, isTopUp: true, vendorReference: doc });
        return;
      }
      const ref = [file, doc].filter(Boolean).join(' / ');
      if (!ticket) {
        // An ADM (or a credit memo) NSA passes on, with no ticket of its own.
        const cells = [ticketCell.toUpperCase(), doc, file];
        const admNo = cells.find(x => /^ADM-/.test(x)) || cells.find(Boolean) || '';
        const memo = cells.find(x => /^DMA-/.test(x) && x !== admNo) || cells.find(x => x && x !== admNo) || '';
        const amount = debit ? debit : -credit;
        result.push({ ticketNo: admNo || `NSA_NOREF_${rowContentId(row)}`, pnr: '', passengerName: '', date, amount, totalDoc: Math.abs(amount), commission: 0,
          reqNum: adm ? 'ADM' : 'ACM', vendorReference: [memo, narration].filter(Boolean).join(' / '),
          status: amount < 0 ? 'REFUND' : 'ISSUE', currency: defaultCurrency, rawType: adm ? 'ADM' : 'ACM' });
        if (!adm) warnings.push(`Row ${idx + 2}: ${doc} credits ${credit.toFixed(2)} with no ticket named - recorded under "ACM"; check what it pays back.`);
        return;
      }
      const refund = credit > 0 && !debit || /^RFD/.test(doc);
      const amount = refund ? -Math.abs(credit || debit) : debit - credit;
      // Their LPO No, when it names a request. Never the narration: on an ADM it is a ticket number.
      const req = resolveReq(cell(row, i.lpo));
      result.push({
        ticketNo: cleanTk(ticket), airlineCode: airlineCode(ticket), pnr: cell(row, i.pnr).replace(/\s+/g, '').toUpperCase(),
        passengerName: cleanPax(cell(row, i.pax)), route: extractRoute(cell(row, i.sector)) || cell(row, i.sector).trim().toUpperCase(),
        date, amount, totalDoc: Math.abs(amount), commission: 0, reqNum: req, vendorReference: doc || ref,
        status: refund ? 'REFUND' : 'ISSUE', currency: defaultCurrency,
      });
    });
    if (!result.length && !errors.length) warnings.push('No documents on this statement - only its balances.');
    return { rows: result, errors, warnings };
  },
};
