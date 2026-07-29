import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk } from './shared';
import { resolveReq, pickReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency, resolveCurrency } from '../helpers/resolveCurrency';
import { normalizeStatus } from '../helpers/normalizeStatus';

export const IATAParser: VendorParser = {
  id:   'IATA',
  name: 'IATA BSP',

  detect: (headers) => {
    const hj = headers.map(c => (c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return (hj.includes('ticketnumber') && hj.includes('paxname')) ||
           (hj.includes('seqno') && hj.includes('trnc') && hj.includes('docnumber'));
  },

  parse: (rows, headers, defaultCurrency): ParserResult => {
    const errors:   string[] = [];
    const warnings: string[] = [];
    const result = [];

    const iTicket = col(headers, 'ticket number', 'DOC NUMBER', 'DOCNUMBER');
    const iTax    = col(headers, 'tax', 'TAX');
    const iPNR    = col(headers, 'PNR', 'RLOC');
    const iPax    = col(headers, 'Pax Name', 'PAX NAME', 'PASSENGER');
    const iDate   = col(headers, 'DATE', 'ISSUE DATE', 'TRAVEL DATE');
    const iTotal  = col(headers, 'total', 'TOTAL DOC', 'TOTALDOC');
    const iNet    = col(headers, 'NET', 'net');
    const iComm   = col(headers, 'COMM', 'comm', 'commission');
    const iStatus = col(headers, 'TRNC', 'status', 'Status');
    const iAL     = col(headers, 'A/L', 'Airline key', 'AIRLINE');
    const iSerial = col(headers, 'Serial', 'SEQ NO', 'Seq No', 'SEQNO', 'SEQ', 'Serial Number');
    const iReq    = pickReqColumn(headers, col(headers, 'Req Number', 'REQ NUMBER', 'REQ NUM', 'Request Number'));
    // currency resolved per-row via resolveCurrency() — no dedicated col index needed

    rows.forEach((row, idx) => {
      if (!row.some(c => c?.trim())) return;

      const rawTk = cell(row, iTicket).replace(/\s+/g, '');
      if (!/^\d{8,15}$/.test(rawTk)) {
        if (row.some(c => c?.trim())) errors.push(`Row ${idx+2}: IATA - invalid ticket [${rawTk}]`);
        return;
      }

      const alRaw   = cell(row, iAL);
      const alCode  = /^\d{3}$/.test(alRaw) ? alRaw : airlineCode(rawTk);
      const total   = num(cell(row, iTotal));
      const netRaw  = num(cell(row, iNet));
      const taxVal  = iTax !== -1 ? num(cell(row, iTax)) : 0;
      let   comm    = num(cell(row, iComm));

      // Data-entry guard: a batch of rows in the source had the tax value
      // pasted into the comm column, so the sheet's own NET (= total - comm)
      // came out short by the tax amount. Real commission runs ~1-19% of
      // total and the same tickets carry comm=0 on their ISSUE row, so an
      // exact comm == tax match is a paste error, not a real commission.
      // Drop the bogus commission and take NET straight from total.
      const commIsPastedTax = taxVal !== 0 && comm === taxVal;
      if (commIsPastedTax) {
        warnings.push(`Ticket ${rawTk}: commission equals tax (${comm}) — treated as a data-entry error, net taken from total.`);
        comm = 0;
      }
      const amount  = commIsPastedTax ? total : (netRaw || (total - comm));
      const rawSt   = cell(row, iStatus).toUpperCase();
      const normSt  = normalizeStatus(rawSt);
      // TRNC may be empty in custom IATA exports — fall back to amount sign
      const status  = normSt !== 'UNKNOWN' ? normSt : (amount < 0 ? 'REFUND' : 'ISSUE');
      // VOID (RFNX/CANX/CANN/VOID) — cancelled ticket or cancelled refund.
      // Business rule: value is zero (informational only, no balance impact).
      const finalAmt = status === 'VOID'   ? 0
                     : status === 'REFUND' ? -Math.abs(amount)
                     : Math.abs(amount);

      const currency = resolveCurrency(row, headers, defaultCurrency);

      const req = resolveReq(cell(row, iReq));
      if (!req) warnings.push(`Ticket ${rawTk}: Missing Req Num`);

      const serialRaw = cell(row, iSerial).replace(/[^0-9]/g, '');
      const serial = serialRaw ? parseInt(serialRaw, 10) : undefined;

      result.push({
        ticketNo:       rawTk,
        pnr:            cell(row, iPNR).replace(/\s+/g,'').toUpperCase(),
        passengerName:  cleanPax(cell(row, iPax)),
        airlineCode:    alCode,
        date:           parseDate(cell(row, iDate)),
        amount:         finalAmt,
        totalDoc:       Math.abs(total) || Math.abs(finalAmt),
        commission:     comm,
        reqNum:         req,
        vendorReference: cell(row, iReq),
        status,
        currency,
        serial,
      });
    });

    return { rows: result, errors, warnings };
  },
};
