/**
 * Dollars into dirhams, on the way into the books.
 *
 * A ticket bought on an airline's own website is paid in dollars; the books
 * are kept in dirhams. The dirham is pegged at 3.67 to the dollar, so that
 * is the rate, fixed — not a market quote that moves the books every time
 * somebody looks.
 *
 * The original is kept beside the converted figure. Their sheet and the
 * airline's receipt both say "1,323.40 USD", and a ticket that only says
 * "4,856.88 AED" can no longer be matched against either.
 */
import type { Ticket } from '../../types';

export const USD_TO_AED = 3.67;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The ticket in dirhams, when it was in dollars. Anything else unchanged. */
export function toDirhams<T extends Partial<Ticket>>(t: T): T {
  if ((t.currency || '').toUpperCase() !== 'USD') return t;
  if (t.originalCurrency) return t; // converted already — never twice
  return {
    ...t,
    amount: r2((t.amount ?? 0) * USD_TO_AED),
    totalDoc: t.totalDoc == null ? t.totalDoc : r2(t.totalDoc * USD_TO_AED),
    commission: t.commission == null ? t.commission : r2(t.commission * USD_TO_AED),
    currency: 'AED',
    originalCurrency: 'USD',
    originalAmount: t.amount ?? 0,
    fxRate: USD_TO_AED,
  };
}
