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
  /** Refunds against this airline. Not sales, but money that moved. */
  refunds: number;
  /** Credit and debit memos and EMDs — money owed to or from the airline that
   *  was never a ticket. Shown rather than folded in, so a total that a memo
   *  moved can be traced to the memo. */
  otherDocs: number;
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
  /** Memos and EMDs — airline money that was never a ticket. */
  otherDocCount: number;
  totals: {
    sar: number; aed: number;
    sarIssued: number; sarRefunded: number;
    aedIssued: number; aedRefunded: number;
  };
}

/**
 * Documents that are money owed to or from an airline without being a sale.
 *
 * An ACM is the airline crediting the agency, an ADM is it billing back, an
 * EMD is a service charge. None of them is a ticket, and none of them is
 * excluded: every one carries an airline code and real money, so leaving them
 * out understated what each airline actually cost. They are counted in their
 * own column and their money lands in the same totals as everything else.
 */
const NOT_A_SALE = new Set(['ACM', 'ADM', 'EMD', 'EMDS', 'EMDA']);

/**
 * Does this document count as a ticket the agency issued?
 *
 * It has to be a ticket, and the money has to have gone out. A refund is a
 * credit, a memo or an EMD is not a sale, and an ISSUE carrying a negative
 * amount is a credit note however it was typed — two AirArabia rows are
 * exactly that, one of them -20,000.
 *
 * None of them is dropped. Each is counted in the column it belongs to, and
 * every one of their amounts lands in the same money totals as a sale.
 *
 * A ticket worth zero still counts: eighteen of those are genuine documents
 * issued at no fare, and dropping them would understate what was sold.
 */
function countsAsTicket(t: Ticket): boolean {
  const s = (t.status || '').toUpperCase();
  if (s === 'REFUND') return false;
  if (NOT_A_SALE.has(s)) return false;
  return t.amount >= 0;
}

/**
 * Everything an airline's figures are built from.
 *
 * Only wallet funding is left out, and only because it is money paid to a
 * vendor rather than anything an airline issued — it carries no airline code
 * at all. Every other document does, so every other document is in.
 */
export function analysable(tickets: Ticket[]): Ticket[] {
  return tickets.filter(t => (t.status || '').toUpperCase() !== 'FUND');
}

const blank = (key: string): ShareRow => ({
  key, tickets: 0, pct: 0, refunds: 0, otherDocs: 0,
  sar: 0, aed: 0, other: 0,
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

const isRefund = (t: Ticket) => (t.status || '').toUpperCase() === 'REFUND';

/** Rank rows by ticket count. `keyOf` returning '' drops the ticket, which is
 *  how tickets with no route stay out of a route ranking instead of forming a
 *  large and meaningless "blank" row. */
function tally(rows: Ticket[], keyOf: (t: Ticket) => string): ShareRow[] {
  const map = new Map<string, ShareRow>();
  for (const t of rows) {
    const key = keyOf(t);
    if (!key) continue;
    const row = map.get(key) ?? blank(key);
    // Every document lands in exactly one column, and every document's money
    // lands in the totals — nothing is counted twice and nothing is dropped.
    if (countsAsTicket(t)) row.tickets++;
    else if (isRefund(t)) row.refunds++;
    else row.otherDocs++;
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
    if (countsAsTicket(t)) p.tickets++;
    else if (isRefund(t)) p.refunds++;
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
    issuedCount: real.filter(countsAsTicket).length,
    refundCount: real.filter(isRefund).length,
    otherDocCount: real.filter(t => !countsAsTicket(t) && !isRefund(t)).length,
    totals: {
      sar: all.sar, aed: all.aed,
      sarIssued: all.sarIssued, sarRefunded: all.sarRefunded,
      aedIssued: all.aedIssued, aedRefunded: all.aedRefunded,
    },
  };
}
