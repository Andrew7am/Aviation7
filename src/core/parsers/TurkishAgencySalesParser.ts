import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, pnrClean } from './shared';
import { splitTicketNo } from '../helpers/ticketIdentity';
import { resolveReq, pickReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { extractRoute } from '../helpers/extractRoute';
import { NormalizedStatus } from '../helpers/normalizeStatus';

/**
 * Turkish Airlines "Agency Sales Report" — the newer portal export.
 *
 * A different document from the older agent sales report TurkishAirlinesParser
 * reads: "Type of Transaction" instead of "Operation Type", "Fare Amount"
 * instead of "Total Fare", and 43 columns instead of a dozen. The old parser's
 * detect() does not match it at all, so both are kept and each recognises its
 * own file.
 *
 * What makes this export worth having is that it states the settlement
 * arithmetic in full, which the old one did not:
 *
 *     Cash Payment = Fare Amount + Total Tax Amount - Discount Amount
 *     15,834.80    = 13,840.00   + 2,410.00        - 415.20
 *
 * "Discount Amount" is the agency's own earning on the sale, and it is the
 * same figure BSP later invoices as commission — checked against the agent's
 * own invoices, ticket by ticket. That matters: the old export gave only the
 * gross fare, so a portal row read 16,250.00 where the invoice said 15,834.80
 * and every reconciliation showed a difference. Reading this format, the
 * portal row already agrees with the invoice.
 *
 * Only CASH settles through the agency's credit. A card sale is collected by
 * the airline directly, so its Cash Payment is 0 and the ledger figure is 0 —
 * the same rule the BSP invoice parser follows for its own FOP column.
 */
export const TurkishAgencySalesParser: VendorParser = {
  id:   'TURKISH_AGENCY',
  // Same vendor name as the older export: `source` decides which wallet and
  // which vendor a row belongs to, so both formats must land on one vendor.
  name: 'Turkish Airlines',

  detect: (headers) => {
    const hj = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
    return hj.includes('typeoftransaction') &&
           hj.includes('ticketnumber') &&
           hj.includes('cashpayment') &&
           hj.includes('fareamount');
  },

  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors:   string[] = [];
    const warnings: string[] = [];
    const result = [];

    const iType     = col(headers, 'Type of Transaction', 'TypeofTransaction');
    const iTicket   = col(headers, 'Ticket Number', 'TicketNumber');
    const iIssue    = col(headers, 'Issue Date', 'IssueDate');
    const iTxnDate  = col(headers, 'Transaction Date', 'TransactionDate');
    const iCash     = col(headers, 'Cash Payment', 'CashPayment');
    const iNegCash  = col(headers, 'Negative Cash Payment', 'NegativeCashPayment');
    const iCard     = col(headers, 'Credit Card Payment', 'CreditCardPayment');
    const iInvoice  = col(headers, 'Invoice Payment', 'InvoicePayment');
    const iFare     = col(headers, 'Fare Amount', 'FareAmount');
    const iDiscount = col(headers, 'Discount Amount', 'DiscountAmount');
    const iComm     = col(headers, 'Commission Amount', 'CommissionAmount');
    const iTax      = col(headers, 'Total Tax Amount', 'TotalTaxAmount');
    const iFees     = col(headers, 'Total Fees Amount', 'TotalFeesAmount');
    const iRemit    = col(headers, 'Total Remittence', 'TotalRemittance', 'TotalRemittence');
    const iCur      = col(headers, 'Currency');
    const iRoute    = col(headers, 'Route');
    const iPax      = col(headers, 'Passenger Name', 'PassengerName');
    const iPNR      = col(headers, 'PNR');
    const iDocType  = col(headers, 'Document Type', 'DocumentType');
    const iInvol    = col(headers, 'Invol Ticket', 'InvolTicket');
    const iReq      = pickReqColumn(headers, col(headers, 'req num', 'reqnum', 'Req Number'));

    if (iTicket === -1 || iType === -1) {
      errors.push('Turkish Agency Sales: required columns missing (Ticket Number / Type of Transaction).');
      return { rows: result, errors, warnings };
    }

    rows.forEach((row, idx) => {
      if (!row.some(c => c?.trim())) return;

      const rawTk = cell(row, iTicket).replace(/\s+/g, '');
      // Excel turns a 13-digit number into "2.35254E+12". Every such row would
      // carry the same id, so the file must be re-exported rather than guessed.
      if (/e\+?\d+$/i.test(rawTk)) {
        errors.push(`Row ${idx + 2}: Turkish - ticket number arrived as "${rawTk}" (Excel scientific notation). Format that column as Text and re-export.`);
        return;
      }
      if (!/^\d{8,15}$/.test(rawTk)) {
        errors.push(`Row ${idx + 2}: Turkish - invalid ticket number [${rawTk}]`);
        return;
      }

      const { ticketNo, airlineCode } = splitTicketNo(rawTk);
      const pnr = pnrClean(cell(row, iPNR));

      const typeRaw = cell(row, iType).toUpperCase().trim();
      let status: NormalizedStatus;
      if (/^SALE|^SALES|^ISSUE|^TKTT/.test(typeRaw))             status = 'ISSUE';
      else if (/^REFUND|^RFND/.test(typeRaw))                    status = 'REFUND';
      else if (/^VOID|^CANCEL|^CANX|^CANN/.test(typeRaw))        status = 'VOID';
      else if (/^REISSUE|^EXCHANGE|^REVALIDAT/.test(typeRaw))    status = 'ISSUE';
      else if (/^EMD/.test(typeRaw))                             status = 'ISSUE';
      else {
        warnings.push(`Ticket ${ticketNo}: unknown Type of Transaction "${typeRaw}" — treated as a sale.`);
        status = 'ISSUE';
      }

      const cash     = num(cell(row, iCash));
      const negCash  = Math.abs(num(cell(row, iNegCash)));
      const card     = num(cell(row, iCard));
      const invoiced = num(cell(row, iInvoice));
      const fare     = num(cell(row, iFare));
      const tax      = num(cell(row, iTax));
      const fees     = num(cell(row, iFees));
      const remit    = num(cell(row, iRemit));

      // The discount is SIGNED, and the sign is the whole point. A sale writes
      // it negative ("-415.2") because it reduces what the agency remits; a
      // refund writes it positive ("240.9") because the commission is being
      // handed back. Taking the magnitude broke the report's own identity on
      // every refund, so the signed value is used as written:
      //
      //   Cash Payment = Fare + Total Tax + Total Fees + Discount
      //   sale:    12,310 + 2,480 + 0 + (-369.30) =  14,420.70
      //   refund:  -7,280 + -2,370 + 0 +  240.90  =  -9,409.10
      //
      // Commission is the agency's earning, so it is the discount inverted:
      // positive on a sale, negative on a refund, which is how the rest of the
      // ledger already records a reversal.
      const stated  = num(cell(row, iDiscount));
      // A separate Commission Amount column exists and is 0 throughout the
      // agent's history; if a file ever fills it in, it is a real commission
      // on top and must not be silently dropped.
      const commCol = num(cell(row, iComm));

      const gross   = fare + tax + fees;
      // Only cash settles through the agency's credit; a card sale is
      // collected by the airline from the passenger.
      const settled = cash - negCash;

      // Integrity check on the vendor's own arithmetic. When it fails, a
      // column has been misread and the row's money cannot be trusted.
      const expected = gross + stated;
      if (card === 0 && invoiced === 0 && Math.abs(expected - settled) > 0.01) {
        warnings.push(
          `Ticket ${ticketNo}: fare ${fare} + tax ${tax} + fees ${fees} + discount ${stated} = ${expected.toFixed(2)}, ` +
          `but Cash Payment is ${settled.toFixed(2)} — the report's own arithmetic does not agree.`);
      }
      if (iRemit !== -1 && Math.abs(remit - settled) > 0.01 && card === 0 && invoiced === 0) {
        warnings.push(`Ticket ${ticketNo}: Total Remittence ${remit} does not match Cash Payment ${settled}.`);
      }
      if (card > 0) {
        warnings.push(`Ticket ${ticketNo}: paid by credit card (${card}) — the airline collects this directly, so it settles nothing through the agency.`);
      }
      if (invoiced > 0) {
        warnings.push(`Ticket ${ticketNo}: ${invoiced} settled as Invoice Payment, not cash.`);
      }

      // The report already signs a refund's cash negative, so `settled` carries
      // the right direction on its own. The status still has the final say, so
      // a mislabelled sign cannot turn a refund into a sale.
      //
      // There is deliberately no "fall back to the computed figure when this is
      // zero". Zero is frequently the RIGHT answer — a card sale settles
      // nothing through the agency — and a fallback would quietly restore the
      // full fare on exactly those rows. Only a missing Cash Payment column,
      // which is a different thing from a zero in it, uses the computed value.
      const figure = iCash === -1 ? expected : settled;
      const amount = status === 'VOID'   ? 0
                   : status === 'REFUND' ? -Math.abs(figure)
                   : figure;

      const req = resolveReq(iReq >= 0 ? cell(row, iReq) : '');
      if (!req && status !== 'VOID') warnings.push(`Ticket ${ticketNo}: Missing Req Num`);

      const cur = (iCur !== -1 ? cell(row, iCur) : '').toUpperCase().trim();
      // "Invol" marks an involuntary reissue — the passenger did not pay for
      // it, so it explains a zero fare rather than being an error.
      const invol = iInvol !== -1 && /^y|^true/i.test(cell(row, iInvol));
      if (invol && gross === 0) {
        warnings.push(`Ticket ${ticketNo}: involuntary ticket with no fare — expected, no money is due on it.`);
      }

      result.push({
        ticketNo,
        pnr,
        passengerName: iPax   !== -1 ? cleanPax(cell(row, iPax)) : '',
        airlineCode,
        route:         iRoute !== -1 ? extractRoute(cell(row, iRoute)) : '',
        // Issue Date is when the DOCUMENT was written; Transaction Date is when
        // THIS line happened. They are the same on a sale, and differ on a
        // refund or a later change — a refund of a 13 Aug ticket on 28 Aug
        // carries Issue Date 13.08. Dating that row 13 Aug would put the
        // refund before it happened and group it with the sale it reverses, so
        // anything that is not the original issue takes the transaction date.
        date:          parseDate(cell(row, status === 'ISSUE' && iIssue !== -1 ? iIssue : (iTxnDate !== -1 ? iTxnDate : iIssue))),
        amount,
        totalDoc:      Math.abs(gross) || Math.abs(amount),
        commission:    -stated + commCol,
        reqNum:        req,
        vendorReference: pnr,
        status,
        transactionType: iDocType !== -1 ? cell(row, iDocType) || status : status,
        currency: (cur === 'AED' || cur === 'SAR' ? cur : defaultCurrency) as typeof defaultCurrency,
      });
    });

    return { rows: result, errors, warnings };
  },
};
