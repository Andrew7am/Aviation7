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

const keyOf = (t: { ticketNo?: string; pnr?: string }) =>
  ticketMatchKey(t.ticketNo || '') || (t.ticketNo || '').toUpperCase()
  || (t.pnr || '').toUpperCase();

export function planSheetAdd(
  findings: Finding[], { newId, userId, tickets }: PlanOptions,
): SheetAddPlan {
  const held = new Set<string>();
  for (const t of tickets) {
    const k = keyOf(t);
    if (k) held.add(k);
  }

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
    const why = whyNotConfirmable(proposal);
    if (why) { plan.waiting.push({ proposal, why }); continue; }
    plan.ready.push(proposal);
    if (k) held.add(k);
  }
  return plan;
}

/** The reasons rows are waiting, commonest first — for the one line the
 *  screen has room for. */
export function waitingReasons(plan: SheetAddPlan): { why: string; count: number }[] {
  const by = new Map<string, number>();
  for (const w of plan.waiting) by.set(w.why, (by.get(w.why) ?? 0) + 1);
  return [...by].map(([why, count]) => ({ why, count }))
    .sort((a, b) => b.count - a.count || a.why.localeCompare(b.why));
}
