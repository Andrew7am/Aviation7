import type { Ticket } from '../../types';
import type { ParsedInvoice } from '../parsers/ibtekarInvoicePdf';
import { invoiceFoots } from '../parsers/ibtekarInvoicePdf';

/**
 * An invoice the vendor sent, against the rows the ledger holds for it.
 *
 * There are two honest comparisons and one dishonest one, and the dishonest
 * one is the obvious one. Line amounts on an Ibtekar invoice are NET, and VAT
 * is charged on the invoice rather than on the line: an international sector
 * is zero-rated, so grossing a line up by 15% invents money on any invoice
 * that carries one. It reported 6906030983 as 223.79 short when the ledger had
 * it exactly right.
 *
 * So the money is compared invoice against invoice — what the document asks to
 * be paid, against what the ledger holds for the same document — and the lines
 * are compared by presence rather than by amount: is this ticket in the ledger
 * at all, and does the ledger have rows for this invoice that the invoice does
 * not list.
 *
 * Refunds are excluded from the ledger side. A refund shares its ticket number
 * with the sale it reverses, and Ibtekar credits it on a separate document —
 * counting it against the invoice makes every invoice look short by whatever
 * came back afterwards.
 */

export type LineVerdict =
  | 'MATCHED'      // the invoice names it and the ledger holds it
  | 'MISSING'      // the invoice bills it and the ledger has never seen it
  | 'ZERO_LINE'    // billed at nothing: a reissue shown beside its penalty fee
  | 'ELSEWHERE';   // the ledger holds it against a different invoice

export interface LineResult {
  line: ParsedInvoice['lines'][number];
  verdict: LineVerdict;
  ticket?: Ticket;
  /** The invoice the ledger has it under, when that is not this one. */
  heldUnder?: string;
}

export interface InvoiceResult {
  invoice: ParsedInvoice;
  /** Did the document read cleanly — lines to subtotal, subtotal + VAT to total. */
  foots: ReturnType<typeof invoiceFoots>;
  lines: LineResult[];
  /** Ledger rows filed under this invoice number, refunds excluded. */
  ledgerRows: Ticket[];
  ledgerTotal: number;
  /** ledgerTotal - the invoice's printed total. The number to act on. */
  difference: number;
  agrees: boolean;
  /** Rows the ledger files under this invoice that the invoice never lists. */
  notOnInvoice: Ticket[];
  /** Refunds against a ticket this invoice billed. Not counted; shown because
   *  they are usually the reason a total looks wrong at first glance. */
  refunds: Ticket[];
}

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function reconcileInvoice(inv: ParsedInvoice, tickets: Ticket[]): InvoiceResult {
  const byTicket = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const k = serial(t.ticketNo);
    if (!byTicket.has(k)) byTicket.set(k, []);
    byTicket.get(k)!.push(t);
  }

  const billedSerials = new Set(inv.lines.map(l => l.ticketNo));

  const lines: LineResult[] = inv.lines.map(line => {
    const held = (byTicket.get(line.ticketNo) ?? []).filter(t => (t.amount ?? 0) >= 0);
    const onThis = held.find(t => (t.vendorReference || '').trim() === inv.invoice);
    if (onThis) return { line, verdict: 'MATCHED', ticket: onThis };
    if (held.length) {
      return {
        line, verdict: 'ELSEWHERE', ticket: held[0],
        heldUnder: (held[0].vendorReference || '').trim() || '(none)',
      };
    }
    // A line billed at nothing is a reissued document printed beside the
    // penalty fee that carries its money. It is not a gap in the ledger.
    if (!line.amount) return { line, verdict: 'ZERO_LINE' };
    return { line, verdict: 'MISSING' };
  });

  const filed = tickets.filter(t => (t.vendorReference || '').trim() === inv.invoice);
  const ledgerRows = filed.filter(t => (t.amount ?? 0) >= 0);
  const ledgerTotal = round2(ledgerRows.reduce((n, t) => n + (t.amount ?? 0), 0));
  const difference = inv.total === null ? 0 : round2(ledgerTotal - inv.total);

  return {
    invoice: inv,
    foots: invoiceFoots(inv),
    lines,
    ledgerRows,
    ledgerTotal,
    difference,
    agrees: inv.total !== null && Math.abs(difference) < 0.02,
    notOnInvoice: ledgerRows.filter(t => !billedSerials.has(serial(t.ticketNo))),
    refunds: tickets.filter(t => (t.amount ?? 0) < 0 && billedSerials.has(serial(t.ticketNo))),
  };
}

export function reconcileAll(invoices: ParsedInvoice[], tickets: Ticket[]): InvoiceResult[] {
  return invoices.map(i => reconcileInvoice(i, tickets));
}
