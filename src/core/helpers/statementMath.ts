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
export function unmatchedInPeriod(check: StatementCheck): Ticket[] {
  return check.tickets.filter(t => !/^(INV|RFD|RV|DMA|DN)[-\d]|^\d{4}$/i.test((t.vendorReference || '').trim()));
}
