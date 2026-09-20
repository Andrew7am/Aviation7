import type { Ticket, VendorStatement } from '../../types';
import { vendorMatchesSource } from './walletMath';

/**
 * A vendor's own statement of account against what the ledger recorded.
 *
 * Ibtekar and NSA are settled on their figures, not ours: we issue on their
 * stock and they adjust the account on their side afterwards. So there are
 * three separate questions, and running them together is what has made this
 * hard to follow until now:
 *
 *   1. Does the statement foot at all?  opening + paid - billed - other
 *      should be the closing balance the vendor printed. When it does not,
 *      something on the statement was not read or not entered, and every
 *      comparison below is built on sand.
 *
 *   2. Does our ledger agree with what they billed?  We hold a row per ticket;
 *      they bill a figure per period. The gap is the answer to "how much are
 *      we out by", and it is the number the whole screen exists to show.
 *
 *   3. Does the chain hold?  Each statement's opening balance should be the
 *      previous one's closing. A break means a period is missing, and any
 *      total drawn across the gap is wrong by however much happened inside it.
 *
 * Money is compared to the half-piastre. Vendors round their own totals, and a
 * tolerance any tighter reports a discrepancy on every period.
 */
const CENT = 0.011;

export interface StatementCheck {
  statement: VendorStatement;
  /** opening + paid - billed - other_charges, as the statement's own numbers
   *  say it should come out. */
  impliedClosing: number;
  /** impliedClosing - the closing the vendor printed. Zero when it foots. */
  footingGap: number;
  foots: boolean;
  /** What our own ledger says this vendor billed over the same dates: issues
   *  positive, refunds negative. Undated rows are left out — they cannot be
   *  shown to fall inside the period, and counting them would move a figure
   *  the vendor never saw. */
  ledgerBilled: number;
  ledgerRows: number;
  /** billed - ledgerBilled. Positive means the vendor charged more than we
   *  recorded; negative means we recorded more than they charged. */
  billedGap: number;
  /** Tickets inside the period, for the drill-down. */
  tickets: Ticket[];
  /** Set when the previous statement's closing is not this one's opening. */
  chainGap: number | null;
}

export interface StatementSummary {
  vendorName: string;
  currency: string;
  checks: StatementCheck[];
  /** The latest closing balance the vendor has stated, and when. */
  latestClosing: number | null;
  latestAsOf: string;
  /** Every gap added up, so a vendor can be judged at a glance. */
  totalBilledGap: number;
  totalFootingGap: number;
  /** True when a period is missing between two statements. */
  hasChainBreak: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tickets this vendor issued between two dates, inclusive. */
export function ticketsInPeriod(
  vendorName: string, tickets: Ticket[], from: string, to: string,
): Ticket[] {
  return tickets.filter(t => {
    if (!vendorMatchesSource(vendorName, t.source || '')) return false;
    const d = (t.date || '').slice(0, 10);
    if (!d) return false;
    return d >= from && d <= to;
  });
}

/**
 * One statement, checked.
 *
 * `previous` is the statement immediately before this one for the same vendor,
 * when there is one; it is only used for the chain check.
 */
export function checkStatement(
  s: VendorStatement, tickets: Ticket[], previous?: VendorStatement,
): StatementCheck {
  const impliedClosing = round2(s.openingBalance + s.paid - s.billed - s.otherCharges);
  const footingGap = round2(impliedClosing - s.closingBalance);

  const inPeriod = ticketsInPeriod(s.vendorName, tickets, s.periodStart, s.periodEnd);
  const ledgerBilled = round2(inPeriod.reduce((sum, t) => sum + (t.amount || 0), 0));

  return {
    statement: s,
    impliedClosing,
    footingGap,
    foots: Math.abs(footingGap) < CENT,
    ledgerBilled,
    ledgerRows: inPeriod.length,
    billedGap: round2(s.billed - ledgerBilled),
    tickets: inPeriod,
    chainGap: previous ? round2(s.openingBalance - previous.closingBalance) : null,
  };
}

/** Every statement a vendor has, oldest first, each checked against the one before. */
export function summariseVendor(
  vendorName: string, statements: VendorStatement[], tickets: Ticket[],
): StatementSummary {
  const mine = statements
    .filter(s => s.vendorName === vendorName)
    .slice()
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart)
                 || a.periodEnd.localeCompare(b.periodEnd));

  const checks = mine.map((s, i) => checkStatement(s, tickets, i > 0 ? mine[i - 1] : undefined));
  const last = checks[checks.length - 1];

  return {
    vendorName,
    currency: mine[0]?.currency || 'SAR',
    checks,
    latestClosing: last ? last.statement.closingBalance : null,
    latestAsOf: last ? last.statement.periodEnd : '',
    totalBilledGap: round2(checks.reduce((n, c) => n + c.billedGap, 0)),
    totalFootingGap: round2(checks.reduce((n, c) => n + c.footingGap, 0)),
    hasChainBreak: checks.some(c => c.chainGap !== null && Math.abs(c.chainGap) >= CENT),
  };
}

/**
 * Which tickets in the period the vendor's own document never names.
 *
 * The billed gap says how much; this says which rows it could be. A vendor
 * reference that is not a document number — a request number, a PNR, a blank —
 * means nothing on their side has ever been matched to that row.
 */
export function unmatchedInPeriod(check: { tickets: Ticket[] }): Ticket[] {
  return check.tickets.filter(t => !/^(INV|RFD|RV|DMA|DN)[-\d]|^\d{4}$/i.test((t.vendorReference || '').trim()));
}

/* ────────────────────────────────────────────────────────────────────────────
 * The account between any two dates.
 *
 * A statement covers the period the vendor chose to cut. The question people
 * actually ask is a different one — "what was the balance on the 1st, what is
 * it on the 15th, and what happened in between" — and no statement answers it
 * unless the vendor happened to cut on those days.
 *
 * So the balance is carried: take the last figure the vendor stated, and walk
 * our own rows forward from it. The walk is only as good as the rows, which is
 * why where the opening figure came from is part of the answer rather than a
 * footnote. A balance anchored on a statement the vendor signed is evidence; a
 * balance anchored on the wallet is our own arithmetic, and says so.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Payment {
  id: string;
  vendorName: string;
  amount: number;
  date: string;
  note?: string;
}

export type BalanceAnchor = 'statement' | 'wallet' | 'none';

export interface RangeMovement {
  vendorName: string;
  from: string;
  to: string;
  currency: string;
  /** What the opening balance is founded on. */
  anchor: BalanceAnchor;
  /** Said in full, because the difference matters: a stated balance is the
   *  vendor's word, a carried one is ours. */
  anchorLabel: string;
  /**
   * What the VENDOR's own figures make the balance, carried forward from the
   * last period they issued. Evidence, and the thing to settle against — but
   * not the number the agency runs on, because it stops where their last
   * statement stopped.
   *
   * Null when nothing anchors it: the movement is still real, the balance
   * would be invented.
   */
  statedOpening: number | null;
  statedClosing: number | null;
  /**
   * What OUR books make it, at each end of the range. The same arithmetic the
   * Vendor Credit screen does — opening balance, plus every payment, less
   * every ticket — so on today's date the closing figure IS what that screen
   * shows, to the piastre.
   *
   * These are the headline figures. The agency reconciles against the vendor's
   * statement but it runs on its own ledger, and a balance that stops at the
   * vendor's last cut-off is not the balance anybody is working from.
   *
   * Null when the vendor has no wallet to compute them from.
   */
  openingBalance: number | null;
  closingBalance: number | null;
  /** Positive magnitudes, over the range. */
  issued: number;
  refunded: number;
  paid: number;
  issues: Ticket[];
  refunds: Ticket[];
  payments: Payment[];
  /** Rows this vendor has in the range that carry no date, so they could not
   *  be placed inside it or outside it. Counted nowhere in the movement above;
   *  they ARE in openingBalance and closingBalance, because the wallet counts
   *  them — and being in both ends, they cancel. */
  undated: number;
  /** ours - theirs, at the end of the range: what the two disagree by. */
  balanceGap: number | null;
}

const mine = (vendorName: string, tickets: Ticket[]) =>
  tickets.filter(t => vendorMatchesSource(vendorName, t.source || ''));

/** Sum of our rows for a vendor over a window, both ends inclusive. */
function billedBetween(vendorName: string, tickets: Ticket[], from: string, to: string): number {
  return round2(mine(vendorName, tickets)
    .filter(t => { const d = (t.date || '').slice(0, 10); return d && d >= from && d <= to; })
    .reduce((n, t) => n + (t.amount || 0), 0));
}

function paidBetween(vendorName: string, payments: Payment[], from: string, to: string): number {
  return round2(payments
    .filter(p => p.vendorName === vendorName)
    .filter(p => { const d = (p.date || '').slice(0, 10); return d && d >= from && d <= to; })
    .reduce((n, p) => n + (p.amount || 0), 0));
}

/** The day before an ISO date, so a window can end where the next one starts. */
export function dayBefore(iso: string): string { return shiftDay(iso, -1); }
/** The day after, so a carry starts where the statement stopped. */
export function dayAfter(iso: string): string { return shiftDay(iso, 1); }

function shiftDay(iso: string, by: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/**
 * What the account looked like between two dates.
 *
 * `wallet` is the opening balance the agency set for the vendor, used only
 * when no statement reaches back far enough.
 */
export function balanceOverRange(
  vendorName: string,
  from: string,
  to: string,
  statements: VendorStatement[],
  tickets: Ticket[],
  payments: Payment[],
  wallet?: { initialBalance: number; openingDate?: string },
): RangeMovement {
  const ours = mine(vendorName, tickets);
  const inRange = ours.filter(t => {
    const d = (t.date || '').slice(0, 10);
    return d && d >= from && d <= to;
  });
  const issues = inRange.filter(t => (t.amount || 0) >= 0);
  const refunds = inRange.filter(t => (t.amount || 0) < 0);
  const pays = payments
    .filter(p => p.vendorName === vendorName)
    .filter(p => { const d = (p.date || '').slice(0, 10); return d && d >= from && d <= to; })
    .sort((a, b) => a.date.localeCompare(b.date));

  const mineStatements = statements
    .filter(s => s.vendorName === vendorName)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  const before = dayBefore(from);

  // Three ways a statement can reach the day this range opens, in order of how
  // little of our own arithmetic each needs.
  //
  //   closed the day before   its closing balance IS the opening figure.
  //   closed earlier          carry its closing forward over our rows.
  //   still open on that day  its opening balance is true at its period start,
  //                           so carry THAT forward. Without this, the very
  //                           statement that covers the range fails to anchor
  //                           it - a range of 01/09 to 14/09 fell through to
  //                           the wallet while a statement running 01/08 to
  //                           14/09 sat right there stating the balance.
  const closedBefore = [...mineStatements].reverse().find(s => s.periodEnd <= before);
  const covering = mineStatements.find(s => s.periodStart <= from && s.periodEnd >= from);

  let anchor: BalanceAnchor = 'none';
  let anchorLabel = 'Nothing states a balance before these dates, so only the movement is shown.';
  let opening: number | null = null;

  /** Walk a stated balance forward from the day it was true to `before`. */
  const carry = (base: number, trueOn: string) => {
    const start = dayAfter(trueOn);
    if (start > before) return base;
    return round2(base
      + paidBetween(vendorName, payments, start, before)
      - billedBetween(vendorName, tickets, start, before));
  };

  if (closedBefore) {
    anchor = 'statement';
    opening = carry(closedBefore.closingBalance, closedBefore.periodEnd);
    anchorLabel = closedBefore.periodEnd === before
      ? `${vendorName} stated this balance as at ${closedBefore.periodEnd}.`
      : `Carried from ${vendorName}'s statement to ${closedBefore.periodEnd}, using our own rows since.`;
  } else if (covering) {
    anchor = 'statement';
    // The opening balance is true at the start of its first day, so the carry
    // begins on that day itself rather than the day after.
    opening = covering.periodStart === from
      ? covering.openingBalance
      : round2(covering.openingBalance
             + paidBetween(vendorName, payments, covering.periodStart, before)
             - billedBetween(vendorName, tickets, covering.periodStart, before));
    anchorLabel = covering.periodStart === from
      ? `${vendorName} stated this balance as at ${covering.periodStart}.`
      : `Carried from the ${covering.periodStart} opening balance on ${vendorName}'s `
      + `${covering.periodStart} to ${covering.periodEnd} statement, using our own rows since.`;
  } else if (wallet) {
    anchor = 'wallet';
    const start = (wallet.openingDate || '').slice(0, 10);
    opening = round2(wallet.initialBalance
      + paidBetween(vendorName, payments, start || '0000-01-01', before)
      - billedBetween(vendorName, tickets, start || '0000-01-01', before));
    anchorLabel = `No statement reaches back this far. Carried from the opening balance`
      + `${start ? ` of ${start}` : ''}, using our own rows — our arithmetic, not theirs.`;
  }

  const issued = round2(issues.reduce((n, t) => n + (t.amount || 0), 0));
  const refunded = round2(Math.abs(refunds.reduce((n, t) => n + (t.amount || 0), 0)));
  const paid = round2(pays.reduce((n, p) => n + (p.amount || 0), 0));

  // Our own books, at each end of the range, computed the way the Vendor
  // Credit screen computes its balance: the wallet's opening figure, plus
  // every payment, less every ticket. Undated rows are counted in — the wallet
  // counts them, and these figures exist to agree with the wallet — so when
  // `to` falls on or after the last row the closing figure is the number
  // Vendor Credit shows, to the piastre. An undated row lands in both ends and
  // cancels, so the row of figures still foots.
  const ledgerAt = (day: string): number | null => {
    if (!wallet) return null;
    const upTo = (d?: string) => { const x = (d || '').slice(0, 10); return !x || x <= day; };
    const tk = ours
      .filter(t => upTo(t.date) && (t.status || '').toUpperCase() !== 'FUND')
      .reduce((n, t) => n + (t.amount || 0), 0);
    const pd = payments
      .filter(p => p.vendorName === vendorName && upTo(p.date))
      .reduce((n, p) => n + (p.amount || 0), 0);
    return round2(wallet.initialBalance + pd - tk);
  };
  const ledgerOpening = ledgerAt(before);
  const ledgerClosing = ledgerAt(to);
  const statedClosing = opening === null ? null : round2(opening + paid - issued + refunded);

  return {
    vendorName, from, to,
    currency: mineStatements[0]?.currency || inRange[0]?.currency || 'SAR',
    anchor, anchorLabel,
    statedOpening: opening,
    statedClosing,
    openingBalance: ledgerOpening,
    closingBalance: ledgerClosing,
    issued, refunded, paid,
    issues: issues.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    refunds: refunds.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    payments: pays,
    undated: ours.filter(t => !(t.date || '').slice(0, 10)).length,
    balanceGap: ledgerClosing === null || statedClosing === null
      ? null
      : round2(ledgerClosing - statedClosing),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The account as OUR ledger has it, period by period.
 *
 * Everything above starts from the vendor's statement and asks whether our
 * rows agree with it. This asks the opposite question, which is the one the
 * agency actually runs on: what does our own ledger make the account, and does
 * it reach the figure Vendor Credit shows.
 *
 * The periods are the vendor's own cut-off dates wherever they have issued a
 * statement, because a comparison is only worth drawing between the same
 * dates. Past their last statement the account keeps moving and nobody has
 * stated anything about it, so it runs on in calendar months — which is where
 * the balance the agency is working from today actually lives.
 *
 * The arithmetic is the wallet's rather than a second version of it: opening
 * balance, plus every payment, less every ticket, with the same FUND and
 * opening-date rules calcVendorBalance applies. So the last period's closing
 * figure IS the Vendor Credit balance, to the piastre, and if the two ever
 * part company one of them has a bug rather than a point of view.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface LedgerPeriod {
  from: string;
  to: string;
  /** Our balance the day this period opens, and the day it closes. */
  opening: number;
  closing: number;
  /** Positive magnitudes inside the period. */
  issued: number;
  refunded: number;
  paid: number;
  tickets: Ticket[];
  payments: Payment[];
  /** The vendor's statement for these dates, when they cut one. */
  statement: VendorStatement | null;
  /** Their billed figure less ours, and their closing less ours. Null where
   *  they have stated nothing to compare against. */
  billedGap: number | null;
  balanceGap: number | null;
}

export interface LedgerAccount {
  vendorName: string;
  currency: string;
  periods: LedgerPeriod[];
  /** The last period's closing — the balance the agency is actually on. */
  balance: number | null;
  balanceAsOf: string;
  /** The last balance the vendor themselves stated, and when. */
  statedBalance: number | null;
  statedAsOf: string;
  /** Ours less theirs, on the day they last stated one. */
  balanceGap: number | null;
  /** Rows carrying no date: they cannot be put in a period, so they sit in
   *  every opening and closing figure alike and cancel out of the movement. */
  undated: number;
  undatedAmount: number;
}

const endOfMonth = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 8)}01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

/**
 * Our books for a vendor, cut on their statement dates and then on months.
 *
 * `wallet` carries the same two fields calcVendorBalance reads, and is what
 * makes the closing figure agree with Vendor Credit. Without one there is no
 * balance to state — only movement — and every balance comes back null.
 */
export function ledgerAccount(
  vendorName: string,
  statements: VendorStatement[],
  tickets: Ticket[],
  payments: Payment[],
  wallet?: { initialBalance: number; openingDate?: string },
  through?: string,
): LedgerAccount {
  const ours = mine(vendorName, tickets)
    .filter(t => (t.status || '').toUpperCase() !== 'FUND');
  const pays = payments.filter(p => p.vendorName === vendorName);
  const undatedRows = ours.filter(t => !(t.date || '').slice(0, 10));

  const stmts = statements
    .filter(s => s.vendorName === vendorName)
    .slice()
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  // A ticket dated before the wallet opened was settled out of whatever came
  // before it, so the wallet does not charge it — and neither does this.
  const openedOn = (wallet?.openingDate || '').slice(0, 10);
  const draws = (d?: string) => {
    if (!openedOn) return true;
    const x = (d || '').slice(0, 10);
    return x ? x >= openedOn : false;
  };
  const charged = ours.filter(t => draws(t.date));

  /** Our balance at the close of `day`, exactly as calcVendorBalance has it. */
  const at = (day: string): number | null => {
    if (!wallet) return null;
    const upTo = (d?: string) => { const x = (d || '').slice(0, 10); return !x || x <= day; };
    const t = charged.filter(x => upTo(x.date)).reduce((n, x) => n + (x.amount || 0), 0);
    const p = pays.filter(x => upTo(x.date)).reduce((n, x) => n + (x.amount || 0), 0);
    return round2(wallet.initialBalance + p - t);
  };

  const days = [
    ...ours.map(t => (t.date || '').slice(0, 10)),
    ...pays.map(p => (p.date || '').slice(0, 10)),
  ].filter(Boolean).sort();

  const starts = [days[0], stmts[0]?.periodStart].filter(Boolean).sort() as string[];
  const ends = [days[days.length - 1], stmts[stmts.length - 1]?.periodEnd, through]
    .filter(Boolean).sort() as string[];
  const first = starts[0];
  const last = ends[ends.length - 1];

  const spans: { from: string; to: string; statement: VendorStatement | null }[] = [];
  if (first && last) {
    let cursor = first;
    const months = (upTo: string) => {
      while (cursor <= upTo) {
        const eom = endOfMonth(cursor);
        const stop = eom < upTo ? eom : upTo;
        spans.push({ from: cursor, to: stop, statement: null });
        cursor = dayAfter(stop);
      }
    };
    for (const s of stmts) {
      if (s.periodEnd < cursor) continue;            // already inside a span
      if (s.periodStart > cursor) months(dayBefore(s.periodStart));
      spans.push({
        from: s.periodStart > cursor ? s.periodStart : cursor,
        to: s.periodEnd,
        statement: s,
      });
      cursor = dayAfter(s.periodEnd);
    }
    months(last);
  }

  const periods: LedgerPeriod[] = spans.map(({ from, to, statement }) => {
    const inRange = ours.filter(t => {
      const d = (t.date || '').slice(0, 10);
      return d && d >= from && d <= to;
    });
    const issues = inRange.filter(t => (t.amount || 0) >= 0);
    const refunds = inRange.filter(t => (t.amount || 0) < 0);
    const inPay = pays
      .filter(p => { const d = (p.date || '').slice(0, 10); return d && d >= from && d <= to; })
      .sort((a, b) => a.date.localeCompare(b.date));

    const issued = round2(issues.reduce((n, t) => n + (t.amount || 0), 0));
    const refunded = round2(Math.abs(refunds.reduce((n, t) => n + (t.amount || 0), 0)));
    const paid = round2(inPay.reduce((n, p) => n + (p.amount || 0), 0));
    const opening = at(dayBefore(from));
    const closing = at(to);

    return {
      from, to,
      opening: opening ?? 0,
      closing: closing ?? 0,
      issued, refunded, paid,
      tickets: inRange.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')),
      payments: inPay,
      statement,
      // Our figure for the comparison is the net the vendor bills on: issues
      // less refunds, the same thing their own billed column totals.
      billedGap: statement ? round2(statement.billed - round2(issued - refunded)) : null,
      balanceGap: statement && closing !== null ? round2(closing - statement.closingBalance) : null,
    };
  });

  // A trailing span with nothing in it is an artefact of running the account
  // up to today rather than up to the last thing that happened in it. It says
  // only that the vendor has been quiet, which the date on the balance above
  // already says, so it is dropped rather than printed as an empty row.
  while (periods.length > 1) {
    const end = periods[periods.length - 1];
    if (end.statement || end.tickets.length || end.payments.length) break;
    periods.pop();
  }

  const lastStated = stmts[stmts.length - 1] ?? null;
  const ourAtStated = lastStated ? at(lastStated.periodEnd) : null;

  return {
    vendorName,
    currency: stmts[0]?.currency || ours[0]?.currency || 'SAR',
    periods,
    balance: periods.length
      ? periods[periods.length - 1].closing
      : (wallet && last ? at(last) : null),
    balanceAsOf: periods.length ? periods[periods.length - 1].to : '',
    statedBalance: lastStated ? lastStated.closingBalance : null,
    statedAsOf: lastStated ? lastStated.periodEnd : '',
    balanceGap: lastStated && ourAtStated !== null
      ? round2(ourAtStated - lastStated.closingBalance) : null,
    undated: undatedRows.length,
    undatedAmount: round2(undatedRows.reduce((n, t) => n + (t.amount || 0), 0)),
  };
}
