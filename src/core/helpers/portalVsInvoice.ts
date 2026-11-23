/**
 * A portal's report against the IATA invoice already in the books.
 *
 * A Riyadh Air ticket is sold on their portal and settled through IATA. When
 * the invoice came first the portal's row is not added - the invoice's money
 * is what was paid - and it was dropped without a word even where the two
 * disagree. 2100106143: Riyadh Air's report says 950.00 was paid, and IATA
 * charged 1,400.00.
 *
 * Riyadh Air only: another portal prints a gross fare beside an invoice net of
 * commission, and every ticket of it would differ.
 */
import type { Ticket } from '../../types';
import { isSettlementSource } from '../ImportEngine';
import { ticketMatchKey } from './ticketIdentity';

export interface InvoiceDifference {
  ticketNo: string;
  currency: string;
  reported: number;
  invoiced: number;
  /** Positive: the invoice charged more than the report says was paid. */
  apart: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceDifferences(incoming: Ticket[], held: Ticket[]): InvoiceDifference[] {
  const out: InvoiceDifference[] = [];
  const seen = new Set<string>();
  for (const t of incoming) {
    if (!/riyadh\s*air/i.test(t.source || '') || !t.amount) continue;
    const k = ticketMatchKey(t.ticketNo || '');
    const side = t.amount < 0;
    const inv = held.find(h => isSettlementSource(h.source) && ticketMatchKey(h.ticketNo || '') === k
      && !!h.amount && (h.amount < 0) === side
      && (!h.airlineCode || !t.airlineCode || h.airlineCode === t.airlineCode));
    if (!inv || (inv.currency || '') !== (t.currency || '')) continue;
    const near = (a?: number) => Math.abs(Math.abs(a ?? 0) - Math.abs(t.amount)) < 0.05;
    if (near(inv.amount) || near(inv.totalDoc) || seen.has(`${k}|${side}`)) continue;
    seen.add(`${k}|${side}`);
    out.push({ ticketNo: t.ticketNo, currency: t.currency || '', reported: r2(t.amount), invoiced: r2(inv.amount),
      apart: r2(Math.abs(inv.amount) - Math.abs(t.amount)) });
  }
  return out;
}
