import { VendorParser, ParserResult, ParsedRow } from './types';
import { col, cell, num, cleanPax, airlineCode, cleanTk, rowContentId } from './shared';
import { resolveReq, findReqColumn, findExplicitReqColumn } from '../helpers/resolveReq';
import { parseDate } from '../helpers/parseDate';
import { resolveCurrency } from '../helpers/resolveCurrency';
import { normalizeStatus } from '../helpers/normalizeStatus';
import { LearnedProfile, headerFingerprint } from '../ai/learnedProfile';

/**
 * ProfileParser — executes a LearnedProfile deterministically. This is how a
 * format the AI analyzed once gets parsed forever after with zero AI calls:
 * the profile is data, this is the single engine that runs it.
 *
 * Follows the same pipeline invariants as the handwritten parsers: returns
 * ParsedRow[] only, resolves req/date/currency/status through the
 * single-source helpers, never drops a row that carries a real amount
 * (placeholder reference + warning instead).
 */
export function makeProfileParser(profile: LearnedProfile): VendorParser {
  return {
    id:   `AI_${profile.vendorName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    name: `${profile.vendorName} (learned)`,

    detect: (headers) => headerFingerprint(headers) === profile.fingerprint,

    parse: (rows, headers, defaultCurrency): ParserResult => {
      const errors: string[] = [], warnings: string[] = [];
      const result: ParsedRow[] = [];
      const c = profile.columns;

      const iTicket = c.ticket     ? col(headers, c.ticket)     : -1;
      const iPNR    = c.pnr        ? col(headers, c.pnr)        : -1;
      const iPax    = c.passenger  ? col(headers, c.passenger)  : -1;
      const iDate   = c.date       ? col(headers, c.date)       : -1;
      const iAmt    = c.amount     ? col(headers, c.amount)     : -1;
      const iDebit  = c.debit      ? col(headers, c.debit)      : -1;
      const iCredit = c.credit     ? col(headers, c.credit)     : -1;
      const iTotal  = c.total      ? col(headers, c.total)      : -1;
      const iComm   = c.commission ? col(headers, c.commission) : -1;
      const iStatus = c.status     ? col(headers, c.status)     : -1;
      const iRoute  = c.route      ? col(headers, c.route)      : -1;
      // Explicit user-added Req column always wins; then the AI's mapped
      // column; then the broad heuristic.
      const iExplicitReq = findExplicitReqColumn(headers);
      const iReq    = iExplicitReq !== -1 ? iExplicitReq
                     : c.req ? col(headers, c.req)
                     : findReqColumn(headers);

      rows.forEach((row, idx) => {
        if (!row.some(v => v?.trim())) return;

        // ── money ──
        const debit  = iDebit  >= 0 ? num(cell(row, iDebit))  : 0;
        const credit = iCredit >= 0 ? num(cell(row, iCredit)) : 0;
        const single = iAmt    >= 0 ? num(cell(row, iAmt))    : 0;
        const total  = iTotal  >= 0 ? num(cell(row, iTotal))  : 0;
        const comm   = iComm   >= 0 ? num(cell(row, iComm))   : 0;
        const base   = iAmt >= 0 ? single : (iDebit >= 0 ? debit || credit : total);
        if (base === 0 && debit === 0 && credit === 0 && total === 0) return; // no money = not a transaction row

        // ── refund detection per the profile's rule ──
        const rawStatus = iStatus >= 0 ? cell(row, iStatus) : '';
        const normSt = normalizeStatus(rawStatus);
        let isRefund: boolean;
        switch (profile.rules.refund) {
          case 'credit_column':  isRefund = credit > 0 && debit === 0; break;
          case 'status_column':  isRefund = normSt === 'REFUND'; break;
          default:               isRefund = base < 0; break;
        }
        const status = normSt !== 'UNKNOWN' ? normSt : (isRefund ? 'REFUND' : 'ISSUE');
        if (status === 'FUND') {
          const fundAmt = Math.abs(base);
          result.push({ ticketNo: `${profile.vendorName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_FUND_${rowContentId(row)}`, pnr: '', passengerName: 'BALANCE TOP-UP', date: parseDate(iDate >= 0 ? cell(row, iDate) : ''), amount: fundAmt, totalDoc: fundAmt, commission: 0, reqNum: '', status: 'FUND', currency: resolveCurrency(row, headers, defaultCurrency), isTopUp: true });
          return;
        }
        const finalAmt = status === 'REFUND' ? -Math.abs(base) : Math.abs(base);

        // ── row identifier ──
        const rawTk = iTicket >= 0 ? cell(row, iTicket) : '';
        const pnr = iPNR >= 0 ? cell(row, iPNR).replace(/\s+/g, '').toUpperCase() : '';
        let ticketId = '';
        if (rawTk && /\d{6,}/.test(rawTk.replace(/\s/g, ''))) ticketId = cleanTk(rawTk);
        else if (pnr && pnr.length >= 5) ticketId = pnr;
        if (!ticketId) {
          // Real money but no usable reference — keep the amount, flag it.
          ticketId = `${profile.vendorName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_NOREF_${rowContentId(row)}`;
          warnings.push(`Row ${idx + 2}: ${profile.vendorName} - no ticket/PNR reference, using placeholder`);
        }

        const req = resolveReq(iReq >= 0 ? cell(row, iReq) : '');
        if (!req) warnings.push(`Ticket ${ticketId}: Missing Req Num`);

        result.push({
          ticketNo:        ticketId,
          pnr,
          passengerName:   iPax >= 0 ? cleanPax(cell(row, iPax)) : '',
          airlineCode:     airlineCode(rawTk),
          route:           iRoute >= 0 ? cell(row, iRoute) : '',
          date:            parseDate(iDate >= 0 ? cell(row, iDate) : ''),
          amount:          finalAmt,
          totalDoc:        Math.abs(total) || Math.abs(finalAmt),
          commission:      comm,
          reqNum:          req,
          vendorReference: iReq >= 0 ? cell(row, iReq) : '',
          status,
          currency:        resolveCurrency(row, headers, defaultCurrency),
        });
      });

      return { rows: result, errors, warnings };
    },
  };
}
