import { Ticket } from '../../types';
import { sourceToCurrency } from './sourceCurrency';
import { CABIN_LABEL, type Cabin } from './cabinClass';

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
 * elsewhere are split the same way. This is why a row's "share" is not one
 * number: pct is its share of ticket COUNT, pctSar and pctAed are its share of
 * SAR and AED issued VOLUME, each a complete 100% on its own within that
 * currency. An airline with few tickets but high fares can rank near the top
 * by volume and near the bottom by count — both are correct, they are
 * answering different questions.
 *
 * Refunds are excluded from the ticket COUNT so "how many did we issue" means
 * issued, but their money still nets off the amounts, so the value shown is
 * what was actually earned rather than a gross a cancellation already took
 * back. Volume share (pctSar/pctAed) is measured on gross ISSUED money only
 * (sarIssued/aedIssued) — refunds are excluded from it the same way, so a
 * heavily-refunded airline is not read as having negative or reduced "share of
 * the business" for having taken money back on tickets that were sold.
 */

export interface ShareRow {
  key: string;
  tickets: number;
  /** This row's share of the ranking's TICKET COUNT — "how many of the
   *  tickets we issued were this airline's". Kept for rankings that have no
   *  honest money figure to rank by (routes, cabins) and for anyone who wants
   *  volume in the ticket sense. For "how much of the business this airline
   *  is" by money, use pctSar / pctAed instead. */
  pct: number;
  /** This row's share of the ranking's total SAR (respectively AED) issued
   *  volume — sarIssued / (sum of sarIssued across every row), as a
   *  percentage. This is what "market share" means in money: an airline with
   *  few tickets but high fares can outrank one with many cheap ones. Zero
   *  when the ranking has no SAR (AED) volume at all, rather than dividing by
   *  zero. Never combined with the other currency — see the module note. */
  pctSar: number;
  pctAed: number;
  /** Refunds against this airline. Not sales, but money that moved. */
  refunds: number;
  /** Credit and debit memos and EMDs — money owed to or from the airline that
   *  was never a ticket. Shown rather than folded in, so a total that a memo
   *  moved can be traced to the memo. */
  otherDocs: number;
  /** Tickets by cabin, for this airline or route. `unknown` counts the ones
   *  whose cabin was never recorded, so a small business figure can be read as
   *  "few sold" or "few known" rather than mistaken for the first. */
  cabins: { FIRST: number; BUSINESS: number; PREMIUM_ECONOMY: number; ECONOMY: number; unknown: number };
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
  /** Tickets by cabin — First, Business, Premium Economy, Economy. Tickets
   *  with no cabin recorded are NOT a row here; the shares are of what is
   *  known. Read them next to cabinKnown / cabinTotal. */
  byCabin: ShareRow[];
  /** Issued tickets carrying a cabin, and issued tickets in total — the
   *  coverage every cabin percentage should be read against. */
  cabinKnown: number;
  cabinTotal: number;
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
  key, tickets: 0, pct: 0, pctSar: 0, pctAed: 0, refunds: 0, otherDocs: 0,
  cabins: { FIRST: 0, BUSINESS: 0, PREMIUM_ECONOMY: 0, ECONOMY: 0, unknown: 0 },
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
    if (countsAsTicket(t)) {
      row.tickets++;
      // Cabin is a fact about a sale, so only sales are counted by it. A
      // refund does not un-sell a business seat, and a memo was never in one.
      const cab = (t.cabinClass || '') as keyof ShareRow['cabins'];
      if (cab && cab in row.cabins) row.cabins[cab]++;
      else row.cabins.unknown++;
    }
    else if (isRefund(t)) row.refunds++;
    else row.otherDocs++;
    addMoney(row, t);
    map.set(key, row);
  }
  const out = [...map.values()].sort((a, b) => b.tickets - a.tickets);
  const total = out.reduce((s, r) => s + r.tickets, 0) || 1;
  // Guarded the same way as `total`: if nothing in this ranking has any SAR
  // (AED) volume, every row's share of it is 0 rather than 0/0.
  const totalSar = out.reduce((s, r) => s + r.sarIssued, 0) || 1;
  const totalAed = out.reduce((s, r) => s + r.aedIssued, 0) || 1;
  return out.map(r => ({
    ...r,
    pct: (r.tickets / total) * 100,
    pctSar: (r.sarIssued / totalSar) * 100,
    pctAed: (r.aedIssued / totalAed) * 100,
  }));
}

export function computeAnalytics(tickets: Ticket[]): Analytics {
  const real = analysable(tickets);

  const byAirline = tally(real, t => (t.airlineCode || '').trim() || 'No code');

  // Separators differ by vendor — "RUH/JED/RUH" and "RUH-JED-RUH" are one
  // route written two ways, so they are folded together. Direction is NOT:
  // MED-RUH and RUH-MED are different journeys and stay apart.
  const byRoute = tally(real, t =>
    (t.route || '').trim().toUpperCase().replace(/[\\/]/g, '-').replace(/\s+/g, ''));

  // Only tickets whose cabin is known, so the percentages answer "of what we
  // know, how much was business". A cabin is recorded for about a quarter of
  // the ledger, and including the rest as a slice made "Not recorded" three
  // quarters of the chart and squeezed every real cabin into a sliver — the
  // question being asked is what is sold, not how complete the data entry is.
  //
  // The unknown are not swept away: cabinKnown and cabinTotal below carry the
  // coverage, and the screen states it beside the chart, so a Business share
  // is always read next to how much of the ledger it was measured over.
  const byCabin = tally(real, t =>
    CABIN_LABEL[(t.cabinClass || '') as Exclude<Cabin, ''>] ?? '');

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
    byCabin,
    cabinKnown: byCabin.reduce((s, r) => s + r.tickets, 0),
    cabinTotal: real.filter(countsAsTicket).length,
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
