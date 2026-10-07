import type { CoverageReport } from './taxInvoiceCoverage';

/**
 * What to ask Ibtekar for: every ticket we have no final tax invoice for, and
 * the invoice number to quote for it.
 *
 * Two different asks, kept apart because Ibtekar answer them differently:
 *   - NO_QR: the ticket is on a printout of theirs headed TAX INVOICE with no
 *     ZATCA QR code. Quote that printout's number; they issue the e-invoice
 *     from their ZATCA system (INV264215 came back as 1599).
 *   - NONE: no document of theirs names the ticket at all. Quote the invoice
 *     number their statement filed it under, where there is one.
 */

export type RequestReason = 'NO_QR' | 'NONE';

export const REASON_TEXT: Record<RequestReason, string> = {
  NO_QR: 'Printout only, no ZATCA QR code - please send the e-invoice',
  NONE: 'No invoice received - please send the e-invoice',
};

export interface RequestTicket {
  invoiceNo: string;
  invoiceDate: string;
  ticketNo: string;
  passenger: string;
  pnr: string;
  route: string;
  issueDate: string;
  amount: number | null;
  currency: string;
  reqNum: string;
  reason: RequestReason;
  /** Billed on their printout but not in our books. */
  notInOurBooks?: boolean;
}

export interface RequestInvoice {
  invoiceNo: string;
  invoiceDate: string;
  tickets: number;
  /** Their printout's total, where the ask is a printout; else what our books hold. */
  total: number | null;
  reason: RequestReason;
}

const NO_NUMBER = '(no invoice number)';

/**
 * The invoice number their statement filed a ticket under, if it is one. The
 * same column holds booking references (8TFECR) on the newer imports, and
 * quoting a PNR as an invoice number would only confuse the ask.
 */
function statementInvoiceNo(ref: string | undefined): string {
  const r = (ref || '').trim();
  const inv = /\bINV\d{6}\b/i.exec(r)?.[0];
  if (inv) return inv.toUpperCase();
  if (/^\d{3,5}$/.test(r)) return `Ibtekar no. ${r}`;
  return NO_NUMBER;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceRequestList(report: CoverageReport): { invoices: RequestInvoice[]; tickets: RequestTicket[] } {
  const byNo = new Map(report.invoices.map(i => [i.invoice.invoiceNo, i]));
  const tickets: RequestTicket[] = [];

  for (const r of report.tickets) {
    if (r.coverage === 'COVERED') continue;
    const t = r.ticket;
    const printout = r.coverage === 'NOT_TAX' ? byNo.get(r.invoices[0])?.invoice : undefined;
    tickets.push({
      invoiceNo: printout?.invoiceNo ?? statementInvoiceNo(t.vendorReference),
      invoiceDate: printout?.invoiceDate ?? '',
      ticketNo: t.ticketNo,
      passenger: t.passengerName || '',
      pnr: t.pnr || '',
      route: t.route || '',
      issueDate: t.date || '',
      amount: t.amount ?? null,
      currency: t.currency || 'SAR',
      reqNum: t.reqNum || '',
      reason: printout ? 'NO_QR' : 'NONE',
    });
  }

  // What a printout bills that our books never recorded is still on it, and
  // still owed an e-invoice.
  for (const a of report.awaitingFinal)
    for (const s of a.notInLedger)
      tickets.push({
        invoiceNo: a.invoice.invoiceNo, invoiceDate: a.invoice.invoiceDate, ticketNo: s,
        passenger: '', pnr: '', route: '', issueDate: '', amount: null, currency: 'SAR', reqNum: '',
        reason: 'NO_QR', notInOurBooks: true,
      });

  tickets.sort((x, y) => x.reason.localeCompare(y.reason) || x.invoiceNo.localeCompare(y.invoiceNo)
                      || x.ticketNo.localeCompare(y.ticketNo));

  const groups = new Map<string, RequestTicket[]>();
  for (const t of tickets) {
    const k = `${t.reason}|${t.invoiceNo}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const invoices: RequestInvoice[] = [...groups.values()].map(ts => {
    const held = ts[0].reason === 'NO_QR' ? byNo.get(ts[0].invoiceNo)?.invoice : undefined;
    return {
      invoiceNo: ts[0].invoiceNo,
      invoiceDate: ts[0].invoiceDate,
      tickets: ts.length,
      total: held?.total ?? round2(ts.reduce((n, t) => n + (t.amount ?? 0), 0)),
      reason: ts[0].reason,
    };
  });
  return { invoices, tickets };
}

/** The two sheets, as rows ready for a spreadsheet. English, for sending. */
export function invoiceRequestSheets(report: CoverageReport) {
  const { invoices, tickets } = invoiceRequestList(report);
  return {
    invoices: invoices.map(i => ({
      'Invoice No': i.invoiceNo,
      'Invoice Date': i.invoiceDate,
      'Tickets': i.tickets,
      'Total (SAR)': i.total,
      'Request': REASON_TEXT[i.reason],
    })),
    tickets: tickets.map(t => ({
      'Invoice No': t.invoiceNo,
      'Ticket No': t.ticketNo,
      'Passenger': t.passenger,
      'PNR': t.pnr,
      'Route': t.route,
      'Issue Date': t.issueDate,
      'Amount': t.amount,
      'Currency': t.currency,
      'Request No': t.reqNum,
      'Request': REASON_TEXT[t.reason] + (t.notInOurBooks ? ' (not in our books)' : ''),
    })),
  };
}
