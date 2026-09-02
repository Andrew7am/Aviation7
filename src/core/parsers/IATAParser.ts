import { VendorParser, ParserResult } from './types';
import { col, cell, num, cleanPax } from './shared';
import { splitTicketNo } from '../helpers/ticketIdentity';
import { resolveReq, pickReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { SupportedCurrency, resolveCurrency } from '../helpers/resolveCurrency';
import { normalizeStatus, type NormalizedStatus } from '../helpers/normalizeStatus';
import { readReportPeriod } from '../helpers/reportPeriod';

export const IATAParser: VendorParser = {
  id:   'IATA',
  name: 'IATA BSP',

  detect: (headers) => {
    const hj = headers.map(c => (c||'').toLowerCase().replace(/[^a-z0-9.]/g,'')).join('|');
    return (hj.includes('ticketnumber') && hj.includes('paxname')) ||
           (hj.includes('seqno') && hj.includes('trnc') && hj.includes('docnumber'));
  },

  parse: (rows, headers, defaultCurrency, _defaultSource, preamble): ParserResult => {
    const errors:   string[] = [];
    const warnings: string[] = [];
    const result = [];

    /**
     * The BSP sales report (TJQ) has no date column — across forty of them,
     * not one does. Its only date is the range printed above the table, and
     * ignoring it saved every row undated: an undated row belongs to no month,
     * so it vanished from every period filter while still counting in the
     * all-time totals. The same block is also the only place the report names
     * its currency, which is why BSP rows kept being stored as SAR.
     */
    const period = readReportPeriod(preamble ?? []);
    let fromPeriod = 0, approximate = 0;

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

      // BSP prints the bare 10-digit serial and names the airline in its own
      // A/L column, so that column is the ONLY source for the code here —
      // deriving it from a 10-digit serial just returns the serial's own first
      // three digits (see ticketIdentity.ts). Blank beats invented.
      const alRaw   = cell(row, iAL);
      const { ticketNo: tkSerial, airlineCode: alCode } = splitTicketNo(rawTk, alRaw);
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
      // TRNC may be empty in custom IATA exports — fall back to the amount.
      //
      // The sign tells a refund from a sale, but only when there IS an amount.
      // A row with no stated type, no fare and nothing payable is not a sale:
      // on the invoice these are the cancellations, printed as CANN/CANX with
      // 0.00 across every column. Calling them ISSUE put four cancelled
      // documents into the ledger as live tickets that could never be closed.
      // With nothing to go on, VOID is both the truthful reading and the safe
      // one — it settles at zero either way, so a genuine zero-fare ticket
      // misread here costs nothing, while a cancellation read as a sale does.
      const typeless = normSt === 'UNKNOWN';
      const noMoney  = amount === 0 && total === 0;
      let status: NormalizedStatus;
      if (!typeless)     status = normSt;
      else if (noMoney) {
        warnings.push(`Ticket ${rawTk}: no transaction type and no value — treated as a cancellation (VOID) rather than a sale.`);
        status = 'VOID';
      }
      else status = amount < 0 ? 'REFUND' : 'ISSUE';
      // VOID (RFNX/CANX/CANN/VOID) — cancelled ticket or cancelled refund.
      // Business rule: value is zero (informational only, no balance impact).
      const finalAmt = status === 'VOID'   ? 0
                     : status === 'REFUND' ? -Math.abs(amount)
                     : Math.abs(amount);

      // A currency column on the row wins; otherwise what the report itself
      // declares, and only then the default chosen on the import screen.
      const currency = resolveCurrency(row, headers, period.currency ?? defaultCurrency);

      // A date on the row always wins. Only when the format carries none does
      // the report's own range stand in for it.
      const rowDate = parseDate(cell(row, iDate));
      let date = rowDate;
      if (!date && period.from) {
        date = period.from;
        fromPeriod++;
        if (!period.exact) approximate++;
      }

      const req = resolveReq(cell(row, iReq));
      if (!req) warnings.push(`Ticket ${rawTk}: Missing Req Num`);

      const serialRaw = cell(row, iSerial).replace(/[^0-9]/g, '');
      const serial = serialRaw ? parseInt(serialRaw, 10) : undefined;

      result.push({
        ticketNo:       tkSerial,
        pnr:            cell(row, iPNR).replace(/\s+/g,'').toUpperCase(),
        passengerName:  cleanPax(cell(row, iPax)),
        airlineCode:    alCode,
        date,
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

    // Said once for the file rather than once per ticket, which would bury
    // every other warning under a hundred identical lines.
    if (fromPeriod) {
      warnings.push(approximate
        ? `${fromPeriod} rows have no date of their own and took the report's range ` +
          `${period.from} to ${period.to}; the report does not say which day inside it ` +
          `each ticket was issued, so ${period.from} was used. The BSP invoice gives the exact day.`
        : `${fromPeriod} rows have no date of their own and took the report's date, ${period.from}.`);
    }

    return { rows: result, errors, warnings };
  },
};
