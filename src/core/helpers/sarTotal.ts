import { useEffect, useState } from 'react';
import type { PriceTotal } from './priceReview';

/**
 * A file in one figure, in riyals.
 *
 * The team mostly gives operations its prices in riyals, so a file bought
 * partly in dirhams is added up in riyals at 1.02 a dirham (the user, 26 Nov
 * 2026) - their rate, not the 1.0211 peg. Shown beside each currency's own
 * figures, never in place of them, and only when asked for.
 */
export const AED_TO_SAR = 1.02;
/** A dollar left in dollars goes the way the file does: into dirhams at the
 *  3.6725 peg, then at 1.02 (the user, 26 Nov 2026). It was silently left out
 *  before (KSAML2771). The review turns their dollars into ours first, so this
 *  is only what could not be. */
export const USD_TO_AED = 3.6725;
export const USD_TO_SAR = USD_TO_AED * AED_TO_SAR;
const RATE: Record<string, number> = { SAR: 1, AED: AED_TO_SAR, USD: USD_TO_SAR };
/** How the riyal figure was made, from the currencies in it: "SAR + AED x 1.02". */
export const sarRule = (currencies: string[] = ['SAR', 'AED'], times = '\u00d7') => {
  const has = new Set(currencies.map(c => (c || '').toUpperCase()));
  return ['SAR', ...(has.has('AED') || !has.size ? [`AED ${times} ${AED_TO_SAR}`] : []), ...(has.has('USD') ? [`USD ${times} ${USD_TO_AED} ${times} ${AED_TO_SAR}`] : [])].join(' + ');
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Riyals, dirhams and dollars as riyals; anything else is left out and named. */
export function inSar(byCurrency: Record<string, number>): { sar: number; left: string[] } {
  let sar = 0;
  const left: string[] = [];
  for (const [c, v] of Object.entries(byCurrency)) {
    const cur = (c || '').toUpperCase();
    if (RATE[cur] !== undefined) sar += v * RATE[cur];
    else if (Math.abs(v) >= 0.005) left.push(cur);
  }
  return { sar: r2(sar), left };
}

/** The price totals of riyals, dirhams and dollars as one, in riyals. Null when there is none of them. */
export function totalInSar(totals: PriceTotal[]): (PriceTotal & { left: string[] }) | null {
  const parts = totals.filter(t => RATE[(t.currency || '').toUpperCase()] !== undefined);
  if (!parts.length) return null;
  const k = (t: PriceTotal) => RATE[(t.currency || '').toUpperCase()];
  const sum = (f: (t: PriceTotal) => number) => r2(parts.reduce((n, t) => n + f(t) * k(t), 0));
  const counts: PriceTotal['counts'] = {};
  for (const t of parts) for (const [r, n] of Object.entries(t.counts)) counts[r as keyof typeof counts] = (counts[r as keyof typeof counts] ?? 0) + (n ?? 0);
  return {
    req: parts[0].req, currency: 'SAR', tickets: parts.reduce((n, t) => n + t.tickets, 0),
    charged: sum(t => t.charged), net: sum(t => t.net), commission: sum(t => t.commission), aviation: sum(t => t.aviation),
    price: sum(t => t.price), toOps: sum(t => t.toOps), markup: sum(t => t.markup), belowPrice: sum(t => t.belowPrice),
    refunds: sum(t => t.refunds), profit: sum(t => t.profit), counts,
    left: totals.filter(t => !parts.includes(t)).map(t => t.currency),
  };
}

/** Whether this viewer asked to see files in riyals too. Remembered in this browser only. */
export function useSarTotal(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem('sarTotal') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('sarTotal', on ? '1' : '0'); } catch { /* private window: this session only */ }
  }, [on]);
  return [on, setOn];
}
