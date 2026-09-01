import { Ticket } from '../../types';
import { sourceToCurrency } from './sourceCurrency';

/**
 * Share of business by airline, by route, and over time.
 *
 * A pure function over whatever tickets it is handed, so the same maths serves
 * the whole ledger and a single month without a second implementation to keep
 * in step. The screen passes a period-filtered slice; useReports passes
 * everything.
 *
 * Amounts are kept PER CURRENCY, never summed into one figure. Airlines in
 * this ledger sell in both SAR and AED, and adding those together produces a
 * number that looks like money and is not — the reason the vendor totals
 * elsewhere are split the same way.
 *
 * Refunds are excluded from the ticket COUNT so "how many did we issue" means
 * issued, but their money still nets off the amounts, so the value shown is
 * what was actually earned rather than a gross a cancellation already took
 * back.
 */

export interface ShareRow {
  key: string;
  tickets: number;
  pct: number;
  sar: number; aed: number; other: number;
  /** Kept alongside the net so a negative total can explain itself. An airline
   *  selling mostly in SAR can still show a negative AED net — a few AED sales
   *  against refunds of tickets issued earlier — and a bare minus sign reads
   *  as a bug. */
  sarIssued: number; sarRefunded: number;
  aedIssued: number; aedRefunded: number;
}

/** One month of activity, for the trend chart. */
export interface MonthPoint {
  month: string;     // YYYY-MM
  tickets: number;   // issues only, matching the counts everywhere else
  refunds: number;   // how many refunds fell in the month
  sar: number;
  aed: number;
}

export interface Analytics {
  byAirline: ShareRow[];
  byRoute: ShareRow[];
  months: MonthPoint[];
  issuedCount: number;
  refundCount: number;
  totals: {
    sar: number; aed: number;
    sarIssued: number; sarRefunded: number;
    aedIssued: number; aedRefunded: number;
  };
}

/**
 * Memos are not ticket sales. An ACM is the airline crediting the agency and
 * an ADM is it billing back; neither was sold to a passenger, neither flew a
 * route, and a single -30,699 credit memo was enough to drag British Airways
 * to a negative total that looked like an error. They stay in the ledger and
 * in every balance — they just do not belong in a ranking of what was sold.
 */
const MEMO = new Set(['ACM', 'ADM']);

/** The rows a share ranking is built from: real sales, no memos, no funding. */
export function analysable(tickets: Ticket[]): Ticket[] {
  return tickets.filter(t =>
    t.status !== 'FUND' && !MEMO.has((t.status || '').toUpperCase()));
}

const blank = (key: string): ShareRow => ({
  key, tickets: 0, pct: 0, sar: 0, aed: 0, other: 0,
  sarIssued: 0, sarRefunded: 0, aedIssued: 0, aedRefunded: 0,
});

/** Add one ticket's money to a row, under its VENDOR's currency — the rule the
 *  ticket table, the summary bar and every export already use. */
function addMoney(row: ShareRow, t: Ticket) {
  const cur = sourceToCurrency(t.source || '');
  if (cur === 'SAR') {
    row.sar += t.amount;
    if (t.amount < 0) row.sarRefunded += t.amount; else row.sarIssued += t.amount;
  } else if (cur === 'AED') {
    row.aed += t.amount;
    if (t.amount < 0) row.aedRefunded += t.amount; else row.aedIssued += t.amount;
  } else {
    row.other += t.amount;
  }
}

const isIssue = (t: Ticket) => t.status !== 'REFUND';

/** Rank rows by ticket count. `keyOf` returning '' drops the ticket, which is
 *  how tickets with no route stay out of a route ranking instead of forming a
 *  large and meaningless "blank" row. */
function tally(rows: Ticket[], keyOf: (t: Ticket) => string): ShareRow[] {
  const map = new Map<string, ShareRow>();
  for (const t of rows) {
    const key = keyOf(t);
    if (!key) continue;
    const row = map.get(key) ?? blank(key);
    if (isIssue(t)) row.tickets++;
    addMoney(row, t);
    map.set(key, row);
  }
  const out = [...map.values()].sort((a, b) => b.tickets - a.tickets);
  const total = out.reduce((s, r) => s + r.tickets, 0) || 1;
  return out.map(r => ({ ...r, pct: (r.tickets / total) * 100 }));
}

export function computeAnalytics(tickets: Ticket[]): Analytics {
  const real = analysable(tickets);

  const byAirline = tally(real, t => (t.airlineCode || '').trim() || 'No code');

  // Separators differ by vendor — "RUH/JED/RUH" and "RUH-JED-RUH" are one
  // route written two ways, so they are folded together. Direction is NOT:
  // MED-RUH and RUH-MED are different journeys and stay apart.
  const byRoute = tally(real, t =>
    (t.route || '').trim().toUpperCase().replace(/[\\/]/g, '-').replace(/\s+/g, ''));

  const monthMap = new Map<string, MonthPoint>();
  for (const t of real) {
    if (!/^\d{4}-\d{2}/.test(t.date || '')) continue;
    const m = t.date.slice(0, 7);
    const p = monthMap.get(m) ?? { month: m, tickets: 0, refunds: 0, sar: 0, aed: 0 };
    if (isIssue(t)) p.tickets++; else p.refunds++;
    const cur = sourceToCurrency(t.source || '');
    if (cur === 'SAR') p.sar += t.amount;
    else if (cur === 'AED') p.aed += t.amount;
    monthMap.set(m, p);
  }
  const months = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  const all = blank('');
  for (const t of real) addMoney(all, t);

  return {
    byAirline,
    byRoute,
    months,
    issuedCount: real.filter(isIssue).length,
    refundCount: real.length - real.filter(isIssue).length,
    totals: {
      sar: all.sar, aed: all.aed,
      sarIssued: all.sarIssued, sarRefunded: all.sarRefunded,
      aedIssued: all.aedIssued, aedRefunded: all.aedRefunded,
    },
  };
}
