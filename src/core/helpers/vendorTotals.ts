/**
 * The rows on screen totalled by vendor, each in its own currency.
 *
 * A request bought through Ibtekar and NSA in SAR and IATA in AED has one
 * net per currency already; this says how much of it each vendor holds -
 * what is owed to whom. A vendor that bills in two currencies gets a line
 * for each, never a sum across them.
 */
import type { Ticket } from '../../types';
import { ticketCurrency, byCurrencyOrder } from './sourceCurrency';

export interface VendorTotal {
  vendor: string;
  currency: string;
  count: number;
  issued: number;
  refunds: number;
  net: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function totalsByVendor(rows: Ticket[]): VendorTotal[] {
  const m = new Map<string, VendorTotal>();
  for (const t of rows) {
    const vendor = (t.source || '').trim() || 'UNKNOWN';
    const currency = ticketCurrency(t);
    const k = `${vendor}|${currency}`;
    const e = m.get(k) ?? { vendor, currency, count: 0, issued: 0, refunds: 0, net: 0 };
    const a = t.amount || 0;
    e.count++;
    if (a < 0) e.refunds = r2(e.refunds + a); else e.issued = r2(e.issued + a);
    e.net = r2(e.net + a);
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => byCurrencyOrder(a.currency, b.currency) || Math.abs(b.net) - Math.abs(a.net));
}
