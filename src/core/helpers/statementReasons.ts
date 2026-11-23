/**
 * Why a statement and our books close on different figures, said simply.
 *
 * The difference is taken apart rather than guessed at:
 *
 *   their closing - our closing
 *     = their opening - our opening          (what was already different)
 *     + their receipts - our payments        (inside the dates)
 *     - their tickets  + our tickets         (inside the dates)
 *
 * so the reasons add up to the difference exactly, and anything left over is
 * shown as left over. A ticket or payment the two sides merely date on either
 * side of the first day is not a reason: it is in both closings.
 *
 * Each reason is a title, what happened in one sentence, and what to do -
 * for somebody who has not read a statement of account before.
 */
import type { Ticket, BalanceTopUp, VendorStatement } from '../../types';
import type { ParsedStatement } from '../parsers/ibtekarStatementPdf';
import type { LineCheck, ReceiptCheck, Dropped, Reprice } from './statementAgainstBooks';
import { drawsOnWallet } from './walletMath';

export type ReasonKind =
  | 'OPENING' | 'PAYMENT_DATE' | 'PAYMENT_MISSING' | 'PAYMENT_NOT_THEIRS' | 'PAYMENT_AMOUNT'
  | 'TICKET_NOT_OURS' | 'REFUND_NOT_OURS' | 'DROPPED' | 'TICKET_NOT_THEIRS' | 'REFUND_NOT_THEIRS'
  | 'PRICE' | 'REFUND_AMOUNT' | 'BILLED_LATER' | 'MOVED' | 'TICKET_DATE' | 'OTHER_CHARGE' | 'ROUNDING' | 'FOOTING';

export interface Reason {
  kind: ReasonKind;
  title: string;
  /** What to do about it. */
  todo: string;
  /** Nothing is wrong: dates or rounding. */
  harmless: boolean;
  /** Its share of their closing less ours. */
  amount: number;
  items: { ref: string; text: string; amount: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ser = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
const day = (d?: string) => (d || '').slice(0, 10);
const sum = (xs: number[]) => r2(xs.reduce((n, x) => n + x, 0));
const money = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Two systems rounding the same figure. */
const ROUND = 0.05;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-11-20 -> 20 Nov. */
export const shortDay = (d?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : (d || '');
};

/** The words for each kind. {v} is the vendor. */
const WORDS: Record<ReasonKind, [title: string, todo: string, harmless?: boolean]> = {
  FOOTING: ['Their statement does not add up', 'Their own lines do not come to the closing balance they print. Ask {v} for a corrected statement.'],
  OPENING: ['Already different before this period', 'It comes from an earlier statement. Check the statement before this one first.'],
  PAYMENT_MISSING: ['Payment not entered in our books', 'Add it in Vendor Credit, with the date shown here.'],
  PAYMENT_DATE: ['Same payment, different date', 'No money is missing. {v} counts it inside this statement and we count it after.', true],
  PAYMENT_AMOUNT: ['Same payment, different amount', 'Check the amount on the bank transfer.'],
  PAYMENT_NOT_THEIRS: ['Payment we entered, not on their statement', 'Send {v} the transfer proof and ask when they will add it.'],
  TICKET_NOT_OURS: ['Ticket they billed, not in our books', 'Import {v}\'s sales report. If it is not there, ask {v} what the ticket is.'],
  REFUND_NOT_OURS: ['Refund they gave, not in our books', 'Add the refund to our books.'],
  DROPPED: ['Ticket they cancelled', 'It was on their last statement and is gone from this one. Move it to Voids below.'],
  TICKET_NOT_THEIRS: ['Ticket in our books, not on their statement', 'It is usually on their next statement. If not, ask {v} whether it was voided.'],
  REFUND_NOT_THEIRS: ['Refund in our books, not on their statement', 'Ask {v} for the refund.'],
  PRICE: ['Different ticket price', 'They will be paid the price on the statement. Check it, then correct ours.'],
  REFUND_AMOUNT: ['Different refund amount', 'Ask {v} how the refund was calculated.'],
  BILLED_LATER: ['Ticket they added on a later statement', 'No money is missing. This statement was printed before {v} added it.', true],
  MOVED: ['Amount moved between tickets', 'These cancel each other out: the total is right. Nothing to change.', true],
  TICKET_DATE: ['Same ticket, different date', 'No money is missing. {v} counts it inside this statement and we count it after.', true],
  OTHER_CHARGE: ['Other charge on their statement', 'Not a ticket and not a payment. Ask {v} what it is.'],
  ROUNDING: ['Rounding', 'A few halalas. Nothing to do.', true],
};
const ORDER = Object.keys(WORDS) as ReasonKind[];

export function explainGap(a: {
  st: ParsedStatement;
  vendor: string;
  mine: Ticket[];
  pays: BalanceTopUp[];
  wallet: { initialBalance: number; openingDate?: string };
  saved: VendorStatement[];
  lines: LineCheck[];
  receipts: ReceiptCheck[];
  dropped: Dropped | null;
  reprice: Reprice[];
  closingGap: number;
}): { reasons: Reason[]; unexplained: number; ourOpening: number } {
  const { st, vendor, pays, wallet: w } = a;
  const ps = st.periodStart, pe = st.periodEnd;
  const bucket = new Map<ReasonKind, Reason['items']>();
  const add = (kind: ReasonKind, ref: string, text: string, amount: number) => {
    if (Math.abs(amount) < 0.005) return;
    bucket.set(kind, [...(bucket.get(kind) ?? []), { ref, text, amount: r2(amount) }]);
  };

  const rows = a.mine.filter(t => (t.status || '').toUpperCase() !== 'FUND' && day(t.date) && drawsOnWallet(w, t.date));
  const ourOpening = r2(w.initialBalance + sum(pays.filter(p => day(p.date) < ps).map(p => p.amount))
    - sum(rows.filter(t => day(t.date) < ps).map(t => t.amount || 0)));
  let opening = r2(st.openingBalance - ourOpening);

  // ── tickets ──────────────────────────────────────────────────────────────
  const theirs = new Map(a.lines.map(c => [ser(c.line.ticketNo), c]));
  const ours = new Map<string, Ticket[]>();
  for (const t of rows) {
    const k = ser(t.ticketNo) || t.id;
    ours.set(k, [...(ours.get(k) ?? []), t]);
  }
  const dropped = new Set((a.dropped?.tickets ?? []).map(t => t.id));
  const reprice = new Set(a.reprice.map(x => ser(x.ticketNo)));
  const earlier = new Map<string, number>();
  for (const s of a.saved) {
    if (s.vendorName !== vendor || s.periodStart >= ps) continue;
    for (const l of s.lines ?? []) if (day(l.date) < ps)
      earlier.set(ser(l.ticketNo), r2(l.debit - l.credit));
  }

  const later = new Set<string>();
  for (const s of a.saved) if (s.vendorName === vendor && s.periodEnd > pe)
    for (const l of s.lines ?? []) if (day(l.date) <= pe && l.debit > 0) later.add(ser(l.ticketNo));

  for (const k of new Set([...theirs.keys(), ...ours.keys()])) {
    const c = theirs.get(k);
    const all = ours.get(k) ?? [];
    const inside = all.filter(t => day(t.date) >= ps && day(t.date) <= pe);
    const before = sum(all.filter(t => day(t.date) < ps).map(t => t.amount || 0));
    const after = all.filter(t => day(t.date) > pe);
    const held = sum(inside.map(t => t.amount || 0));
    const billed = c?.theirs ?? 0;
    let eff = r2(held - billed);
    if (!c && !inside.length) continue;
    if (Math.abs(eff) < 0.005) continue;

    // Dated on either side of the first day by the two of us: in both closings.
    if (c && before && Math.abs(r2(eff + before)) <= ROUND) { opening = r2(opening - before); eff = r2(eff + before); }
    else if (!c && earlier.has(k) && Math.abs(r2(earlier.get(k)! - held)) <= ROUND) { opening = r2(opening + held); eff = 0; }
    if (Math.abs(eff) < 0.005) continue;

    const no = c?.line.ticketNo ?? (all[0].ticketNo || '');
    const two = (x: number, y: number) => `${vendor}: ${money(x)} · us: ${money(y)}`;
    if (Math.abs(eff) <= ROUND) { add('ROUNDING', no, two(billed, held || before), eff); continue; }
    if (c && after.length && Math.abs(r2(eff + sum(after.map(t => t.amount || 0)))) <= ROUND) {
      add('TICKET_DATE', no, `${vendor}: ${shortDay(c.line.date)} · us: ${shortDay(after[0].date)}`, eff); continue;
    }
    if (!c) {
      const req = inside[0].reqNum ? `, ${inside[0].reqNum}` : '';
      const kind: ReasonKind = inside.some(t => dropped.has(t.id)) ? 'DROPPED'
        : held > 0 && later.has(k) ? 'BILLED_LATER' : held > 0 ? 'TICKET_NOT_THEIRS' : 'REFUND_NOT_THEIRS';
      add(kind, no, `${shortDay(inside[0].date)}${req}`, eff); continue;
    }
    if (!all.length) {
      add(billed > 0 ? 'TICKET_NOT_OURS' : 'REFUND_NOT_OURS', no, `${shortDay(c.line.date)}${c.line.document ? `, ${c.line.document}` : ''}`, eff);
      continue;
    }
    if (c.credit > 0 && !all.some(t => (t.amount || 0) < 0)) {
      const sale = c.debit || sum(all.map(t => t.amount || 0));
      add('REFUND_NOT_OURS', no, `refund ${money(c.credit)}${c.line.document ? `, ${c.line.document}` : ''}`
        + (c.credit > sale + 1 ? ' — more than the ticket cost: ask first' : ''), eff);
      continue;
    }
    if (c.debit > 0 && !all.some(t => (t.amount || 0) > 0)) { add('TICKET_NOT_OURS', no, `sale ${money(c.debit)}; we hold only its refund`, eff); continue; }
    if (c.cancelsWith?.length) { add('MOVED', no, `${two(billed, held)} · with ${c.cancelsWith.join(', ')}`, eff); continue; }
    const refund = c.credit > 0 || all.some(t => (t.amount || 0) < 0);
    add(refund && !reprice.has(k) ? 'REFUND_AMOUNT' : 'PRICE', no, two(billed, held), eff);
  }

  // Lines that are neither a ticket nor a receipt with money in it.
  for (const l of st.lines) {
    const isTicket = l.section !== 'RECEIPT' && ser(l.ticketNo).length === 10;
    const isReceipt = l.section === 'RECEIPT' && l.credit > 0;
    if (!isTicket && !isReceipt) add('OTHER_CHARGE', l.document || l.ticketNo, shortDay(l.date), r2(l.credit - l.debit));
  }

  // ── payments ─────────────────────────────────────────────────────────────
  const used = new Set<string>();
  for (const x of a.receipts) {
    const p = x.recorded, ref = x.line.document;
    if (!p) { add('PAYMENT_MISSING', ref, shortDay(x.line.date), x.line.credit); continue; }
    used.add(p.id);
    if (day(p.date) > pe) {
      add('PAYMENT_DATE', ref, `${vendor}: ${shortDay(x.line.date)} · us: ${shortDay(p.date)}`, x.line.credit);
      continue;
    }
    if (day(p.date) < ps) opening = r2(opening + p.amount);
    add('PAYMENT_AMOUNT', ref, `${vendor}: ${money(x.line.credit)} · us: ${money(p.amount)}`, r2(x.line.credit - p.amount));
  }
  for (const p of pays) {
    if (used.has(p.id) || day(p.date) < ps || day(p.date) > pe) continue;
    // On their statement before this one: the opening carries it already.
    if (Math.abs(r2(opening - p.amount)) <= ROUND) { opening = r2(opening - p.amount); continue; }
    add('PAYMENT_NOT_THEIRS', p.note || 'payment', shortDay(p.date), -p.amount);
  }

  if (Math.abs(opening) <= ROUND) add('ROUNDING', 'opening', `balance on ${shortDay(ps)}`, opening);
  else add('OPENING', 'opening', `${vendor}: ${money(st.openingBalance)} · us: ${money(r2(st.openingBalance - opening))}`, opening);
  const implied = r2(st.openingBalance + sum(st.lines.map(l => r2(l.credit - l.debit))));
  add(Math.abs(r2(st.closingBalance - implied)) <= ROUND ? 'ROUNDING' : 'FOOTING', 'closing',
    `adds up to ${money(implied)} · printed ${money(st.closingBalance)}`, r2(st.closingBalance - implied));

  const reasons: Reason[] = ORDER.filter(k => bucket.has(k)).map(kind => {
    const [title, todo, harmless] = WORDS[kind];
    const items = bucket.get(kind)!;
    return { kind, title, todo: todo.replace(/\{v\}/g, vendor), harmless: !!harmless, amount: sum(items.map(i => i.amount)), items };
  });
  return { reasons, unexplained: r2(a.closingGap - sum(reasons.map(r => r.amount))), ourOpening };
}
