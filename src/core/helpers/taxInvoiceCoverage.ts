import type { Ticket } from '../../types';

/**
 * Which tickets we can actually produce a tax invoice for.
 *
 * "It has an invoice number" and "we hold the invoice" are different facts,
 * and only the second one survives an auditor. Every Ibtekar row in the ledger
 * carries a reference, but that reference was typed off a statement, and a
 * statement is not a tax invoice. On the ZATCA template the reference is not
 * even printed on the page.
 *
 * So the reference is ignored here entirely. The question asked of every
 * ticket is the one an auditor asks: is this document number printed on a
 * piece of paper we hold, and does that paper call itself a tax invoice.
 *
 * Two kinds of row are left out of the question, because no invoice was ever
 * going to name them:
 *   - refunds, which Ibtekar credit on their own document
 *   - wallet top-ups, which are payments rather than purchases
 */

export type Coverage =
  | 'COVERED'    // printed on a document headed TAX INVOICE
  | 'NOT_TAX'    // printed, but only on something that is not a tax invoice
  | 'NONE';      // no document we hold names it

export interface HeldInvoice {
  invoiceNo: string;
  invoiceDate: string;
  isTaxInvoice: boolean;
  net: number | null;
  vat: number | null;
  total: number | null;
  /** The ten-digit document serials printed on it. */
  serials: string[];
  sourceFile?: string;
  theirSerial?: string;
  layout?: string;
}

export interface TicketCoverage {
  ticket: Ticket;
  coverage: Coverage;
  /** The invoice numbers that print this ticket, tax invoices first. */
  invoices: string[];
}

export interface InvoiceCoverage {
  invoice: HeldInvoice;
  /** Serials it bills that the ledger holds. */
  inLedger: Ticket[];
  /** Serials it bills that the ledger has never seen. */
  notInLedger: string[];
  /** What the ledger holds for those tickets, net of nothing. */
  ledgerTotal: number;
  /** ledgerTotal against the invoice's own printed total, where it has one. */
  difference: number | null;
}

export interface CoverageReport {
  tickets: TicketCoverage[];
  invoices: InvoiceCoverage[];
  covered: TicketCoverage[];
  notTax: TicketCoverage[];
  uncovered: TicketCoverage[];
  coveredValue: number;
  uncoveredValue: number;
  /** Serials printed on an invoice that the ledger has no row for at all. */
  billedNotHeld: string[];
}

export const serialOf = (t: string) => (t || '').replace(/\D/g, '').slice(-10);

/** The rows an invoice could ever name: purchases, not credits or top-ups. */
export function invoiceable(t: Ticket): boolean {
  if ((t.amount ?? 0) < 0) return false;
  if ((t.transactionType || '').toUpperCase() === 'REFUND') return false;
  if ((t.status || '').toUpperCase() === 'FUND') return false;
  return true;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function coverageReport(invoices: HeldInvoice[], tickets: Ticket[]): CoverageReport {
  /** serial -> the invoices printing it. */
  const printedIn = new Map<string, HeldInvoice[]>();
  for (const inv of invoices)
    for (const s of new Set(inv.serials)) {
      if (!printedIn.has(s)) printedIn.set(s, []);
      printedIn.get(s)!.push(inv);
    }

  const held = tickets.filter(invoiceable);
  const bySerial = new Map<string, Ticket[]>();
  for (const t of held) {
    const k = serialOf(t.ticketNo);
    if (!bySerial.has(k)) bySerial.set(k, []);
    bySerial.get(k)!.push(t);
  }

  const rows: TicketCoverage[] = held.map(ticket => {
    const on = printedIn.get(serialOf(ticket.ticketNo)) ?? [];
    const tax = on.filter(i => i.isTaxInvoice);
    return {
      ticket,
      coverage: tax.length ? 'COVERED' : on.length ? 'NOT_TAX' : 'NONE',
      invoices: [...tax, ...on.filter(i => !i.isTaxInvoice)].map(i => i.invoiceNo),
    };
  });

  const invoiceRows: InvoiceCoverage[] = invoices.map(invoice => {
    const inLedger: Ticket[] = [];
    const notInLedger: string[] = [];
    for (const s of new Set(invoice.serials)) {
      const ours = bySerial.get(s);
      if (ours?.length) inLedger.push(...ours); else notInLedger.push(s);
    }
    const ledgerTotal = round2(inLedger.reduce((n, t) => n + (t.amount ?? 0), 0));
    return {
      invoice, inLedger, notInLedger, ledgerTotal,
      difference: invoice.total === null ? null : round2(ledgerTotal - invoice.total),
    };
  });

  const covered = rows.filter(r => r.coverage === 'COVERED');
  const notTax = rows.filter(r => r.coverage === 'NOT_TAX');
  const uncovered = rows.filter(r => r.coverage === 'NONE');
  const sum = (rs: TicketCoverage[]) => round2(rs.reduce((n, r) => n + (r.ticket.amount ?? 0), 0));

  return {
    tickets: rows, invoices: invoiceRows,
    covered, notTax, uncovered,
    coveredValue: sum(covered),
    uncoveredValue: sum(uncovered),
    billedNotHeld: [...new Set(invoiceRows.flatMap(i => i.notInLedger))].sort(),
  };
}
