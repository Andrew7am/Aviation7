import type { Ticket } from '../../types';
import { serialOf, type HeldInvoice } from './taxInvoiceCoverage';

/**
 * Which refunds we hold a ZATCA credit note for.
 *
 * The sales side asks "is this ticket on a final tax invoice"; this is the
 * same question for the money that came back. A refund cuts the VAT we
 * claimed on its sale, and only a credit note from the supplier's ZATCA
 * system - with its QR code - documents that.
 *
 * Their credit note names no ticket. It prints the number of the invoice it
 * reduces ("Invoice NO 1599") and an amount, nothing else. So a refund is
 * found its credit note through its sale: the final invoice that bills the
 * ticket, then the credit notes written against that invoice, matched by
 * amount. A sale with no final invoice of its own cannot have a credit note
 * against it yet - its e-invoice is owed first.
 */

export type RefundCoverage = 'CREDITED' | 'AMOUNT_DIFFERS' | 'NONE' | 'SALE_NOT_FINAL';

export interface RefundRow {
  ticket: Ticket;
  coverage: RefundCoverage;
  /** Their serials of the final invoices billing the sale - what a credit note must name. */
  saleInvoices: string[];
  /** The credit notes matched to it, by their own number. */
  creditNotes: string[];
  /** For AMOUNT_DIFFERS: what the credit note says against what we refunded. */
  noteTotal?: number;
}

export interface CreditReport {
  refunds: RefundRow[];
  credited: RefundRow[];
  differs: RefundRow[];
  owed: RefundRow[];
  saleNotFinal: RefundRow[];
  owedValue: number;
  /** Credit notes no refund of ours accounts for. */
  unmatched: HeldInvoice[];
}

const TOL = 0.05;
const round2 = (n: number) => Math.round(n * 100) / 100;
export const isRefund = (t: Ticket) =>
  (t.amount ?? 0) < 0 && (t.status || '').toUpperCase() !== 'FUND';

export function creditNoteReport(invoices: HeldInvoice[], tickets: Ticket[]): CreditReport {
  const finals = invoices.filter(i => i.kind !== 'CREDIT_NOTE' && i.isTaxInvoice && i.theirSerial);
  const billedBy = new Map<string, string[]>();
  for (const f of finals)
    for (const s of new Set(f.serials)) billedBy.set(s, [...(billedBy.get(s) ?? []), f.theirSerial!]);
  const notes = invoices.filter(i => i.kind === 'CREDIT_NOTE' && i.isTaxInvoice);

  const rows: RefundRow[] = tickets.filter(isRefund).map(ticket => ({
    ticket, coverage: 'NONE', creditNotes: [],
    saleInvoices: billedBy.get(serialOf(ticket.relatedTicket || ticket.ticketNo)) ?? [],
  }));
  const value = (r: RefundRow) => Math.abs(r.ticket.amount ?? 0);
  const noteValue = (n: HeldInvoice) => Math.abs(n.total ?? 0);
  const used = new Set<HeldInvoice>();

  // One note, one refund, same amount, against the invoice that bills the sale.
  for (const n of notes) {
    const r = rows.find(r => r.coverage === 'NONE' && r.saleInvoices.includes(n.against ?? '')
      && Math.abs(value(r) - noteValue(n)) <= TOL);
    if (!r) continue;
    r.coverage = 'CREDITED'; r.creditNotes = [n.theirSerial || n.invoiceNo]; used.add(n);
  }
  // One note for several refunds on the same invoice, when they add up to it.
  for (const n of notes.filter(n => !used.has(n))) {
    const rs = rows.filter(r => r.coverage === 'NONE' && r.saleInvoices.includes(n.against ?? ''));
    if (rs.length < 2 || Math.abs(rs.reduce((s, r) => s + value(r), 0) - noteValue(n)) > TOL) continue;
    for (const r of rs) { r.coverage = 'CREDITED'; r.creditNotes = [n.theirSerial || n.invoiceNo]; }
    used.add(n);
  }
  // A note against the right invoice whose amount is not what we refunded.
  for (const n of notes.filter(n => !used.has(n))) {
    const rs = rows.filter(r => r.coverage === 'NONE' && r.saleInvoices.includes(n.against ?? ''));
    if (!rs.length) continue;
    for (const r of rs) { r.coverage = 'AMOUNT_DIFFERS'; r.creditNotes = [n.theirSerial || n.invoiceNo]; r.noteTotal = noteValue(n); }
    used.add(n);
  }
  for (const r of rows) if (r.coverage === 'NONE' && !r.saleInvoices.length) r.coverage = 'SALE_NOT_FINAL';

  return summarise(rows, notes.filter(n => !used.has(n)));
}

function summarise(refunds: RefundRow[], unmatched: HeldInvoice[]): CreditReport {
  const owed = refunds.filter(r => r.coverage === 'NONE');
  return {
    refunds, unmatched, owed,
    credited: refunds.filter(r => r.coverage === 'CREDITED'),
    differs: refunds.filter(r => r.coverage === 'AMOUNT_DIFFERS'),
    saleNotFinal: refunds.filter(r => r.coverage === 'SALE_NOT_FINAL'),
    owedValue: round2([...owed, ...refunds.filter(r => r.coverage !== 'CREDITED' && r.coverage !== 'NONE')]
      .reduce((n, r) => n + Math.abs(r.ticket.amount ?? 0), 0)),
  };
}

/** The refunds issued in a period, by the refund's own date. Empty bounds are open. */
export function creditsInPeriod(report: CreditReport, from: string, to: string): CreditReport {
  if (!from && !to) return report;
  const within = (d?: string) => !!d && (!from || d >= from) && (!to || d <= to);
  return summarise(report.refunds.filter(r => within(r.ticket.date)),
    report.unmatched.filter(n => within(n.invoiceDate)));
}

export const CREDIT_REASON: Record<Exclude<RefundCoverage, 'CREDITED'>, string> = {
  NONE: 'No credit note received - please send the ZATCA credit note',
  AMOUNT_DIFFERS: 'Credit note amount differs from the refund - please confirm or correct',
  SALE_NOT_FINAL: 'The sale has no ZATCA e-invoice yet - please send the e-invoice, then the credit note against it',
};

/** The rows to send them, English. */
export function creditRequestSheet(report: CreditReport) {
  return report.refunds.filter(r => r.coverage !== 'CREDITED')
    .sort((a, b) => (a.ticket.date || '').localeCompare(b.ticket.date || ''))
    .map(r => ({
      'Refund Date': r.ticket.date || '',
      'Ticket No': r.ticket.relatedTicket || r.ticket.ticketNo,
      'Passenger': r.ticket.passengerName || '',
      'PNR': r.ticket.pnr || '',
      'Refund Amount': Math.abs(r.ticket.amount ?? 0),
      'Currency': r.ticket.currency || 'SAR',
      'Your Invoice No (sale)': r.saleInvoices.join(', '),
      'Credit Note': r.creditNotes.join(', '),
      'Credit Note Amount': r.noteTotal ?? '',
      'Request No': r.ticket.reqNum || '',
      'Request': CREDIT_REASON[r.coverage as Exclude<RefundCoverage, 'CREDITED'>],
    }));
}
