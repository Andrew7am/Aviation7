import type { Finding } from './teamSheetCompare';
import type { PendingTicket, Ticket } from '../../types';
import { pendingFromFindings, whyNotConfirmable } from './pendingFromFindings';
import { ticketMatchKey } from './ticketIdentity';
import { settlesOnStatement, STATEMENT_WHY } from '../config/teamPortals';

/**
 * Recording the sheet's missing tickets straight into the ledger — the ones
 * that can be.
 *
 * The review queue exists because most of these cannot go in unread. A
 * shared cell prices a whole booking and arrives at zero, so recording it
 * writes a ticket worth nothing. A row from Ibtekar or NSA settles against a
 * credit wallet and keying it by hand moves that balance twice — once now
 * and once when their statement lands. A row with no date sits in no period
 * at all.
 *
 * So "add them now" cannot mean "add all of them". It means: take the rows
 * that already pass every test the queue would apply, put those in, and
 * leave the rest waiting with the reason they are waiting. The test is
 * whyNotConfirmable — the SAME function the confirm button uses — because
 * two different definitions of "ready" is how a row gets in one way that
 * could not get in the other.
 *
 * And a ticket the ledger already holds is never added again. The findings
 * are a snapshot of a comparison that has already been run; press the button
 * twice, or run the check again after adding, and without this every row
 * would arrive a second time.
 */

export interface SheetAddPlan {
  /** Passes every test: safe to write now. */
  ready: PendingTicket[];
  /** Cannot go in unread, and why. */
  waiting: { proposal: PendingTicket; why: string }[];
  /** Already in the books — the comparison has been overtaken. */
  alreadyHeld: PendingTicket[];
}

export interface PlanOptions {
  newId: () => string;
  userId: string;
  /** The ledger as it stands, to catch what has already been recorded. */
  tickets: Ticket[];
}

/* A document and its direction. A sale and its refund are two rows on one
   ticket; keyed on the ticket alone, a refund was "already held" whenever
   the sale was, and so could never be added - nor the refund of a ticket
   added in the same batch. */
const dirOf = (t: { amount?: number; transactionType?: string; status?: string }) =>
  (t.amount ?? 0) < 0 || /REFUND/i.test(`${t.transactionType || ''} ${t.status || ''}`) ? 'R' : 'S';
const keyOf = (t: { ticketNo?: string; pnr?: string; amount?: number; transactionType?: string; status?: string }) => {
  const doc = ticketMatchKey(t.ticketNo || '') || (t.ticketNo || '').toUpperCase() || (t.pnr || '').toUpperCase();
  return doc ? `${doc}|${dirOf(t)}` : '';
};

export const SUPPLIER_REFUND_WHY =
  "A supplier's refund arrives with its own report - their sheet saying it was refunded is not the credit.";

export function planSheetAdd(
  findings: Finding[], { newId, userId, tickets }: PlanOptions,
): SheetAddPlan {
  const held = new Set<string>();
  for (const t of tickets) {
    const k = keyOf(t);
    if (k) held.add(k);
  }
  const ledgerKeys = new Set(held);

  const plan: SheetAddPlan = { ready: [], waiting: [], alreadyHeld: [] };
  for (const proposal of pendingFromFindings(findings, { newId, userId })) {
    const k = keyOf(proposal);
    /* `held` grows as rows are accepted, so this also catches two proposals
       for the SAME document inside one batch — their sheet lists a reissue
       twice often enough that the second would otherwise be written as a
       separate ticket. */
    if (k && held.has(k)) { plan.alreadyHeld.push(proposal); continue; }
    /* whyNotConfirmable already refuses a row the check marked held back.
       This asks the VENDOR as well, because that flag is carried along on
       the finding and a flag can be lost on the way: everywhere else a
       person reads the row before it is recorded, and here nobody does.
       Ibtekar and NSA bill on a statement that settles against a credit
       wallet, so a ticket keyed in by hand moves that balance twice. */
    if (settlesOnStatement(proposal.source)) {
      plan.waiting.push({ proposal, why: proposal.heldBackWhy || STATEMENT_WHY() });
      continue;
    }
    /* A refund of a ticket already in our books, billed by a supplier that
       reports its refunds - BSP, RTS and the rest - comes from that
       supplier's report, never from their sheet. 7,025.00 on 5513408117
       went in from their sheet and RTS has not credited it. Only a purchase
       on an airline's own website, which no report will ever show, or a
       ticket going in together with its refund, is recorded from here. */
    const isRefund = dirOf(proposal) === 'R';
    const saleHeldBefore = isRefund && ledgerKeys.has(k.replace(/\|R$/, '|S'));
    if (saleHeldBefore && proposal.source !== 'Airline Website') {
      plan.waiting.push({ proposal, why: SUPPLIER_REFUND_WHY });
      continue;
    }
    const why = whyNotConfirmable(proposal);
    if (why) { plan.waiting.push({ proposal, why }); continue; }
    plan.ready.push(proposal);
    if (k) held.add(k);
  }
  return plan;
}

/** The reasons rows are waiting, commonest first — for the one line the
 *  screen has room for. */
/**
 * Each finding's proposal and why it waits, by the key its row looks itself
 * up under - so a row held back can be put in by a person who has read it,
 * starting from what the check already filled in.
 */
export function proposalsByKey(
  findings: Finding[], opts: PlanOptions,
): Map<string, { proposal: PendingTicket; why: string }> {
  const plan = planSheetAdd(findings, opts);
  const out = new Map<string, { proposal: PendingTicket; why: string }>();
  for (const p of plan.ready) out.set(keyOf(p), { proposal: p, why: '' });
  for (const w of plan.waiting) out.set(keyOf(w.proposal), w);
  return out;
}

/**
 * Why a row can never be put in by hand from their sheet, whatever a person
 * decides: Ibtekar and NSA settle against a credit wallet, so a ticket keyed
 * in moves that balance twice; a row the check held back for its own reason
 * stays held. '' when a person may decide.
 */
export function neverByHand(p: PendingTicket): string {
  if (settlesOnStatement(p.source)) return p.heldBackWhy || STATEMENT_WHY();
  if (p.heldBack) return p.heldBackWhy || 'Held back.';
  return '';
}

export function waitingReasons(plan: SheetAddPlan): { why: string; count: number }[] {
  const by = new Map<string, number>();
  for (const w of plan.waiting) by.set(w.why, (by.get(w.why) ?? 0) + 1);
  return [...by].map(([why, count]) => ({ why, count }))
    .sort((a, b) => b.count - a.count || a.why.localeCompare(b.why));
}

/**
 * Why each finding can or cannot be recorded, keyed by its document.
 *
 * The same plan, arranged for a screen that shows one row at a time. A row
 * that cannot go in should say so BEFORE anybody presses anything — a button
 * that is pressed and then explains itself is a button that wasted a click,
 * and on a list of two hundred that is two hundred wasted clicks.
 *
 * '' means ready. A key missing altogether means the finding proposes
 * nothing at all.
 */
export function addabilityByKey(
  findings: Finding[], opts: PlanOptions,
): Map<string, string> {
  const plan = planSheetAdd(findings, opts);
  const out = new Map<string, string>();
  for (const p of plan.ready) out.set(keyOf(p), '');
  for (const w of plan.waiting) out.set(keyOf(w.proposal), w.why);
  for (const p of plan.alreadyHeld) out.set(keyOf(p), 'Already in the books.');
  return out;
}

/** The key a finding is listed under, so a row can look itself up. */
export const findingKey = (f: { serial?: string; pnr?: string; verdict?: string }) =>
  keyOf({ ticketNo: f.serial, pnr: f.pnr, transactionType: f.verdict === 'REFUND_NOT_IN_LEDGER' ? 'REFUND' : '' });
