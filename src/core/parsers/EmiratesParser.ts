import { VendorParser, ParserResult, ExchangeEdge } from './types';
import { col, cell, num, pnrClean } from './shared';
import { splitTicketNo } from '../helpers/ticketIdentity';
import { resolveReq, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';

/**
 * Emirates' agency sales report - what the agency issues on Emirates' own
 * system (PCC EY0F), one line per document:
 *
 *     POSDate  TransDesc  ValidatingCarrier  ...  FLXRecLoc  Type  DocumentNumber
 *     ...  BaseAmt  Tax1..3  TotalAmt  Fees  GrandDailyTotal  NetDueAirline
 *     Comm  NegativeComm  Currency  FOP  ...  ExchangedFor  ...  RefundPenalty
 *
 * Like Turkish, these tickets settle through BSP: this report records the sale
 * the day it happens, and the weekly IATA BSP invoice later lands on the same
 * document (airline 176 + serial) and settles it - one row, the vendor still
 * Emirates, the channel BSP. Nothing here is specific to that; it is how the
 * import treats every portal whose tickets BSP invoices.
 *
 * NetDueAirline is what the agency owes on the document - the total less any
 * commission - and so the ledger figure, the same as Turkish's Cash Payment.
 * A card sale is paid with the company's card (26 Oct 2026): it settles
 * nothing through BSP, but the ticket still cost what it cost, so it is held
 * at the same figure as a cash sale. Held at 0.00, a card ticket vanished
 * from its request's cost.
 */
export const EmiratesParser: VendorParser = {
  id:   'EMIRATES',
  name: 'Emirates',

  detect: (headers) => {
    const hj = headers.map(c => (c || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
    return hj.includes('posdate') && hj.includes('documentnumber')
      && hj.includes('netdueairline') && hj.includes('flxrecloc');
  },

  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result = [];
    const exchanges: ExchangeEdge[] = [];

    const iDate    = col(headers, 'POSDate');
    const iDesc    = col(headers, 'TransDesc');
    const iPNR     = col(headers, 'FLXRecLoc');
    const iType    = col(headers, 'Type');
    const iConj    = col(headers, 'ConjunctiveIndicator');
    const iDoc     = col(headers, 'DocumentNumber');
    const iBase    = col(headers, 'BaseAmt');
    const iTotal   = col(headers, 'TotalAmt');
    const iFees    = col(headers, 'Fees');
    const iGrand   = col(headers, 'GrandDailyTotal');
    const iNet     = col(headers, 'NetDueAirline');
    const iComm    = col(headers, 'Comm');
    const iNegComm = col(headers, 'NegativeComm');
    const iCur     = col(headers, 'Currency');
    const iFOP     = col(headers, 'FOP');
    const iExch    = col(headers, 'ExchangedFor');
    const iPenalty = col(headers, 'RefundPenalty');
    const iEmd     = col(headers, 'EMDDescription');
    const iReq     = findExplicitReqColumn(headers);

    if (iDoc === -1 || (iNet === -1 && iGrand === -1 && iTotal === -1)) {
      errors.push('Emirates: required columns missing (DocumentNumber / NetDueAirline).');
      return { rows: result, errors, warnings };
    }

    rows.forEach((row, idx) => {
      if (!row.some(c => c?.trim())) return;
      const rawDoc = cell(row, iDoc).replace(/\s+/g, '');
      if (/e\+?\d+$/i.test(rawDoc)) {
        errors.push(`Row ${idx + 2}: Emirates - document number arrived as "${rawDoc}" (Excel scientific notation). Format that column as Text and re-export.`);
        return;
      }
      if (!/^\d{10,15}$/.test(rawDoc)) {
        errors.push(`Row ${idx + 2}: Emirates - invalid document number [${rawDoc}]`);
        return;
      }
      const { ticketNo, airlineCode } = splitTicketNo(rawDoc);

      const type = cell(row, iType).toUpperCase().trim();
      const desc = cell(row, iDesc).toUpperCase().trim();
      let status: string;
      if (/^RFN|^RFND/.test(type) || /REFUND/.test(desc))            status = 'REFUND';
      else if (/^CAN|^VOID/.test(type) || /VOID|CANCEL/.test(desc))  status = 'VOID';
      else if (/^EMD/.test(type) || /\bEMD\b/.test(desc))            status = 'EMDS';
      else if (/^TKT/.test(type) || /TICKET|EXCHANGE|REISSUE/.test(desc)) status = 'ISSUE';
      else {
        warnings.push(`Document ${ticketNo}: unknown type "${type || desc}" - treated as a sale.`);
        status = 'ISSUE';
      }

      const net    = iNet   !== -1 ? num(cell(row, iNet))   : NaN;
      const grand  = iGrand !== -1 ? num(cell(row, iGrand)) : 0;
      const total  = iTotal !== -1 ? num(cell(row, iTotal)) : 0;
      const fees   = iFees  !== -1 ? num(cell(row, iFees))  : 0;
      const base   = iBase  !== -1 ? num(cell(row, iBase))  : 0;
      const comm   = (iComm !== -1 ? num(cell(row, iComm)) : 0) - (iNegComm !== -1 ? Math.abs(num(cell(row, iNegComm))) : 0);
      const gross  = grand || total + fees;

      /* A conjunction coupon - the second booklet of one long itinerary -
         carries no money of its own; the fare is on the first document. */
      const conj = iConj !== -1 && !!cell(row, iConj).trim();
      if (conj && !gross && !(net || 0)) return;

      const fop = (iFOP !== -1 ? cell(row, iFOP) : '').toUpperCase().trim();
      // CASH (and INVC, invoiced to the agency) settle through BSP; a card does not,
      // but it is the company's card and the cost stands.
      const card = !/^(CASH|INV)/.test(fop) && /^(CC|CARD|CREDIT|VI|AX|MC|DC)/.test(fop);
      if (card) warnings.push(`Document ${ticketNo}: paid by card (${fop}) - kept at its cost; it will not appear on the BSP invoice.`);

      const owed = Number.isFinite(net) && cell(row, iNet).trim() !== '' ? net : gross - comm;
      const figure = Math.abs(owed);
      const amount = status === 'VOID' ? 0 : status === 'REFUND' ? -figure : figure;

      const penalty = iPenalty !== -1 ? num(cell(row, iPenalty)) : 0;
      if (status === 'REFUND' && penalty)
        warnings.push(`Document ${ticketNo}: refund carries a ${penalty} penalty, kept by the airline.`);

      const exchanged = (iExch !== -1 ? cell(row, iExch) : '').replace(/\D/g, '');
      const date = parseDate(cell(row, iDate));
      if (exchanged.length >= 10) {
        const old = splitTicketNo(exchanged);
        exchanges.push({ ticketNo, replacedTicket: old.ticketNo, airlineCode: airlineCode || old.airlineCode,
          date, fee: Math.abs(amount) });
      }

      const req = resolveReq(iReq !== -1 ? cell(row, iReq) : '');
      if (!req && status !== 'VOID') warnings.push(`Ticket ${ticketNo}: Missing Req Num`);

      const cur = (iCur !== -1 ? cell(row, iCur) : '').toUpperCase().trim();
      const pnr = pnrClean(cell(row, iPNR));

      result.push({
        ticketNo,
        pnr,
        passengerName: '',
        airlineCode,
        route: status === 'EMDS' && iEmd !== -1 ? cell(row, iEmd) : '',
        date,
        amount,
        totalDoc: Math.abs(gross) || Math.abs(base) || Math.abs(amount),
        commission: status === 'REFUND' ? -Math.abs(comm) : comm,
        reqNum: req,
        vendorReference: pnr,
        status,
        rawType: type || desc,
        relatedTicket: exchanged.length >= 10 ? splitTicketNo(exchanged).ticketNo : undefined,
        currency: (cur === 'AED' || cur === 'SAR' || cur === 'USD' ? cur : defaultCurrency) as typeof defaultCurrency,
      });
    });

    return { rows: result, errors, warnings, exchanges };
  },
};
