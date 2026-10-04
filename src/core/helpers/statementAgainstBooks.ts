/**
 * A vendor's statement of account, line by line against our books.
 *
 * The statement is what Ibtekar bills on, so it is the figure that will be
 * paid. Uploading one should answer, without anybody working it out by hand:
 *
 *   - Does the account agree?  Their closing balance against ours on the same
 *     day - every payment we recorded up to it, less every ticket.
 *   - Where does it not?  A ticket billed at another figure, a ticket billed
 *     that we never recorded, a ticket of ours they never billed, a receipt
 *     we never recorded as a payment.
 *   - What changed since their last statement?  Ibtekar move the account on
 *     their side after the fact. Their 01/08-14/09 statement opened on
 *     13,235.37; the 01/08-30/09 one opens the same day on 14,388.37.
 *   - The ten riyals.  Each ticket line bills about ten riyals above the
 *     ticket's own fare - 783.00 against a fare of 772.80. The statement
 *     line less the fare is that figure, ticket by ticket.
 *
 * What a statement settles on its own: a ticket we hold as one row, billed
 * at another figure, takes the statement's figure. What it does not: a
 * ticket with a refund against it, where Ibtekar may net the refund across
 * other lines - those are put to a person with both figures.
 */
import type { Ticket, BalanceTopUp, VendorStatement } from '../../types';
import type { ParsedStatement, StatementLine } from '../parsers/ibtekarStatementPdf';
import { vendorMatchesSource, drawsOnWallet } from './walletMath';

const r2 = (n: number) => Math.round(n * 100) / 100;
const ser = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
const day = (d?: string) => (d || '').slice(0, 10);
/** Below a riyal it is rounding between two systems, not a fee. */
const FEE_FLOOR = 1;

export interface LineCheck {
  line: StatementLine;
  /** Our rows for the same document. */
  ours: Ticket[];
  /** What the statement bills for it, net of any credit on the same line. */
  theirs: number;
  /** What we hold for it, net. */
  held: number;
  /** The ticket's own fare, where we hold one sale for it. */
  fare: number | null;
  /** The statement's figure above the fare: Ibtekar's ten riyals. */
  fee: number | null;
  gap: number;
  verdict: 'AGREES' | 'REPRICE' | 'ASK' | 'NOT_IN_BOOKS';
  why: string;
}

export interface Reprice {
  id: string;
  ticketNo: string;
  was: number;
  amount: number;
  fare: number;
  adjustment: number | undefined;
  adjustmentNote: string | undefined;
}

export interface ReceiptCheck {
  line: StatementLine;
  /** The payment we recorded for it, if any. */
  recorded: BalanceTopUp | null;
}

export interface SinceLast {
  previous: VendorStatement;
  /** The day both statements state a balance for. */
  on: string;
  was: number;
  now: number;
  change: number;
}

export interface StatementReview {
  vendor: string;
  lines: LineCheck[];
  reprice: Reprice[];
  ask: LineCheck[];
  notInBooks: LineCheck[];
  /** Ours, dated inside the period, that the statement never bills. */
  notBilled: Ticket[];
  receipts: ReceiptCheck[];
  fees: { count: number; total: number; min: number; max: number };
  /** Our books on the statement's last day: payments less tickets. */
  ourClosing: number;
  /** Their closing less ours. Zero is an account that agrees. */
  closingGap: number;
  /** What the statement would close on once every REPRICE is applied. */
  gapAfterReprice: number;
  since: SinceLast | null;
}

/** The balance the statement prints on a day: its last line on or before it. */
function balanceOn(st: ParsedStatement, on: string): number | null {
  if (on < st.periodStart) return null;
  let bal = st.openingBalance;
  for (const l of st.lines) {
    if (l.date > on) break;
    bal = r2(bal + l.credit - l.debit);
  }
  return bal;
}

/**
 * The previous statement for the same vendor that this one can be laid
 * against: the latest one that ends inside this one's period.
 */
function sinceLast(st: ParsedStatement, vendor: string, saved: VendorStatement[]): SinceLast | null {
  const prior = saved
    .filter(s => s.vendorName === vendor && s.periodEnd >= st.periodStart && s.periodEnd <= st.periodEnd)
    .filter(s => !(s.periodStart === st.periodStart && s.periodEnd === st.periodEnd
      && Math.abs(s.closingBalance - st.closingBalance) < 0.005 && Math.abs(s.openingBalance - st.openingBalance) < 0.005))
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const previous = prior[0];
  if (!previous) return null;
  // Same opening day: compare the openings, which is where a change made
  // before the period shows. Otherwise compare the balance on their last day.
  if (previous.periodStart === st.periodStart)
    return { previous, on: st.periodStart, was: previous.openingBalance, now: st.openingBalance,
             change: r2(st.openingBalance - previous.openingBalance) };
  const now = balanceOn(st, previous.periodEnd);
  if (now == null) return null;
  return { previous, on: previous.periodEnd, was: previous.closingBalance, now,
           change: r2(now - previous.closingBalance) };
}

/**
 * Groups of differences that net to nothing, smallest first, each line in at
 * most one. Every group holds a ticket with a refund against it - a sale
 * repriced by a sale is two errors, not money moved - and the search stops
 * at sixteen differences, past which a statement needs reading, not solving.
 */
function cancellingGroups(off: LineCheck[]): LineCheck[][] {
  if (off.length < 2 || off.length > 16) return [];
  const out: LineCheck[][] = [];
  const taken = new Set<LineCheck>();
  const masks: number[] = [];
  for (let m = 1; m < 1 << off.length; m++) if (m & (m - 1)) masks.push(m);
  masks.sort((a, b) => bits(a) - bits(b));
  for (const m of masks) {
    const g = off.filter((_, i) => m & (1 << i));
    if (g.some(c => taken.has(c))) continue;
    if (Math.abs(r2(g.reduce((n, c) => n + c.gap, 0))) >= 0.05) continue;
    if (!g.some(c => c.ours.some(t => (t.amount || 0) < 0))) continue;
    g.forEach(c => taken.add(c));
    out.push(g);
  }
  return out;
}
const bits = (m: number) => { let k = 0; while (m) { k += m & 1; m >>= 1; } return k; };

export function reviewStatement(
  st: ParsedStatement,
  vendor: string,
  tickets: Ticket[],
  topUps: BalanceTopUp[],
  saved: VendorStatement[] = [],
  wallet?: { initialBalance: number; openingDate?: string },
): StatementReview {
  const mine = tickets.filter(t => vendorMatchesSource(vendor, t.source || ''));
  const bySer = new Map<string, Ticket[]>();
  for (const t of mine) {
    const k = ser(t.ticketNo);
    if (!k) continue;
    if (!bySer.has(k)) bySer.set(k, []);
    bySer.get(k)!.push(t);
  }

  // One document can appear on more than one line; it is billed as the sum.
  const docLines = st.lines.filter(l => l.section !== 'RECEIPT' && ser(l.ticketNo).length === 10);
  const billed = new Map<string, number>();
  for (const l of docLines) billed.set(ser(l.ticketNo), r2((billed.get(ser(l.ticketNo)) ?? 0) + l.debit - l.credit));

  const seen = new Set<string>();
  const lines: LineCheck[] = [];
  for (const l of docLines) {
    const k = ser(l.ticketNo);
    if (seen.has(k)) continue;
    seen.add(k);
    const ours = bySer.get(k) ?? [];
    const theirs = billed.get(k)!;
    const held = r2(ours.reduce((n, t) => n + (t.amount || 0), 0));
    const sales = ours.filter(t => (t.amount || 0) > 0);
    const fare = sales.length === 1 && ours.length === 1 ? (sales[0].totalDoc ?? null) : null;
    const fee = fare != null && fare > 0 ? r2(theirs - fare) : null;
    const gap = r2(theirs - held);
    let verdict: LineCheck['verdict'] = 'AGREES', why = '';
    if (!ours.length) { verdict = 'NOT_IN_BOOKS'; why = 'Billed on the statement; we hold no ticket with this number.'; }
    else if (Math.abs(gap) < 0.005) verdict = 'AGREES';
    else if (ours.length === 1 && (ours[0].amount || 0) > 0 && theirs > 0) {
      verdict = 'REPRICE';
      why = `The statement bills ${theirs.toFixed(2)}; we hold ${held.toFixed(2)}.`;
    } else {
      verdict = 'ASK';
      why = ours.length > 1
        ? `We hold ${ours.length} rows for it (${ours.map(t => (t.amount || 0).toFixed(2)).join(', ')}), net ${held.toFixed(2)}; the statement bills ${theirs.toFixed(2)}.`
        : `The statement bills ${theirs.toFixed(2)}; we hold ${held.toFixed(2)}.`;
    }
    lines.push({ line: l, ours, theirs, held, fare, fee, gap, verdict, why });
  }

  // Differences that cancel each other out: the account agrees, and the
  // statement has put part of one ticket's money on another - a refund
  // netted against a different line, typically. 4862083218 holds a refund
  // of 1,603.67; the 01/08-30/09 statement takes 812.44 of it off that
  // ticket and 791.24 off 4862141169. Correcting 4862141169 alone would
  // throw out by 791.23 an account that agrees to the fil - so none of them
  // is corrected, and all of them are said.
  // Any other difference on the same statement must not hide the pair, so
  // the smallest groups that cancel are looked for, not just the whole set.
  for (const group of cancellingGroups(lines.filter(c => c.verdict === 'ASK' || c.verdict === 'REPRICE'))) {
    for (const c of group) {
      c.verdict = 'ASK';
      c.why += ` Together with ${group.filter(o => o !== c).map(o => o.line.ticketNo).join(', ')} it comes to the`
        + ' same money: the statement has moved part of one onto the other, most likely a refund netted against'
        + ' a different ticket. The total agrees, so nothing is changed.';
    }
  }
  const ask = lines.filter(c => c.verdict === 'ASK');

  const reprice: Reprice[] = lines.filter(c => c.verdict === 'REPRICE').map(c => {
    const t = c.ours[0];
    const fare = t.totalDoc ?? 0;
    const above = r2(c.theirs - fare);
    const marks = fare > 0 && above >= FEE_FLOOR;
    return {
      id: t.id, ticketNo: t.ticketNo, was: t.amount, amount: c.theirs, fare,
      adjustment: marks ? above : t.adjustment,
      adjustmentNote: marks
        ? `${vendor}'s statement for ${st.periodStart} to ${st.periodEnd} bills ${c.theirs.toFixed(2)} for this`
          + ` document; the ledger held ${(t.amount || 0).toFixed(2)}. Their figure is what will be paid, so it is`
          + ` the one recorded. Its fare is ${fare.toFixed(2)}, so ${above.toFixed(2)} of it sits above the fare.`
        : t.adjustmentNote,
    };
  });

  const onStatement = new Set(lines.map(c => ser(c.line.ticketNo)));
  const notBilled = mine.filter(t => {
    const d = day(t.date);
    return d && d >= st.periodStart && d <= st.periodEnd && !onStatement.has(ser(t.ticketNo))
      && (t.status || '').toUpperCase() !== 'FUND' && (t.amount || 0) !== 0;
  });

  // Receipts: matched to a payment we recorded by its number first, then by
  // amount within a week, each payment used once.
  const pays = topUps.filter(p => vendorMatchesSource(vendor, p.vendorName || ''));
  const used = new Set<string>();
  const receipts: ReceiptCheck[] = st.lines.filter(l => l.section === 'RECEIPT' && l.credit > 0).map(l => {
    const ref = (l.document || '').toUpperCase();
    const near = (p: BalanceTopUp) => Math.abs(new Date(day(p.date)).getTime() - new Date(l.date).getTime()) <= 7 * 864e5;
    const hit = pays.find(p => !used.has(p.id) && ref && (p.note || '').toUpperCase().includes(ref))
      ?? pays.find(p => !used.has(p.id) && Math.abs(p.amount - l.credit) < 0.005 && near(p));
    if (hit) used.add(hit.id);
    return { line: l, recorded: hit ?? null };
  });

  // Our books on the statement's last day, by the wallet's own rules.
  const w = { initialBalance: wallet?.initialBalance ?? 0, openingDate: wallet?.openingDate };
  const spent = mine
    .filter(t => (t.status || '').toUpperCase() !== 'FUND' && day(t.date) && day(t.date) <= st.periodEnd)
    .filter(t => drawsOnWallet(w, t.date))
    .reduce((n, t) => n + (t.amount || 0), 0);
  const paid = pays.filter(p => day(p.date) <= st.periodEnd).reduce((n, p) => n + p.amount, 0);
  const ourClosing = r2(w.initialBalance + paid - spent);
  const closingGap = r2(st.closingBalance - ourClosing);
  const repriceTotal = r2(reprice.reduce((n, x) => n + (x.amount - x.was), 0));

  const feeList = lines.map(c => c.fee).filter((f): f is number => f != null && f >= FEE_FLOOR);
  return {
    vendor, lines, reprice, ask, notInBooks: lines.filter(c => c.verdict === 'NOT_IN_BOOKS'),
    notBilled, receipts,
    fees: {
      count: feeList.length, total: r2(feeList.reduce((n, f) => n + f, 0)),
      min: feeList.length ? Math.min(...feeList) : 0, max: feeList.length ? Math.max(...feeList) : 0,
    },
    ourClosing, closingGap,
    gapAfterReprice: r2(closingGap + repriceTotal),
    since: sinceLast(st, vendor, saved),
  };
}
