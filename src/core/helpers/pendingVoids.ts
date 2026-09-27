import type { PendingTicket } from '../../types';

/**
 * Which rows waiting for review are documents that were cancelled.
 *
 * The review queue is built from their team sheet, and their sheet lists a
 * ticket as live until somebody updates it. Nobody always does. So a row can
 * sit there looking like a supplier who has not billed us yet, when in fact
 * the document was voided months ago and no supplier is ever going to.
 *
 * Confirming one writes a ticket into the ledger for a document that does
 * not exist — money against nothing, in a request's cost, in a vendor's
 * balance. Twelve of the hundred and three waiting are exactly this, worth
 * 58,438 between them.
 *
 * Matching is on the document alone, not the supplier. A ticket bought
 * through RTS and cancelled by BSP is one document cancelled once, and
 * requiring both sides to agree on the vendor would miss it.
 */

export interface VoidedDoc {
  ticketNo: string;
  source: string;
  period?: string;
  date?: string;
}

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);

export interface VoidMatch {
  /** The cancelled document, as the register holds it. */
  voided: VoidedDoc;
}

/** Cancelled documents by serial, for a screen to look a row up in. */
export function voidIndex(voids: VoidedDoc[]): Map<string, VoidedDoc> {
  const m = new Map<string, VoidedDoc>();
  for (const v of voids) {
    const k = serial(v.ticketNo);
    // The first is kept: a document cancelled twice is still one
    // cancellation, and which record names it does not change the answer.
    if (k && !m.has(k)) m.set(k, v);
  }
  return m;
}

/** The cancellation for this proposal, if there is one. */
export function voidFor(
  p: { ticketNo?: string; pnr?: string }, index: Map<string, VoidedDoc>,
): VoidedDoc | undefined {
  const k = serial(p.ticketNo || '');
  return k ? index.get(k) : undefined;
}

export interface QueueVoidReport {
  matched: { proposal: PendingTicket; voided: VoidedDoc }[];
  /** What confirming all of them would have put into the books. */
  value: number;
  currencies: string[];
}

export function voidsInQueue(
  pending: PendingTicket[], voids: VoidedDoc[],
): QueueVoidReport {
  const index = voidIndex(voids);
  const matched: QueueVoidReport['matched'] = [];
  for (const proposal of pending) {
    if (proposal.state !== 'PENDING') continue;
    const voided = voidFor(proposal, index);
    if (voided) matched.push({ proposal, voided });
  }
  /* Their figure, not ours: we hold nothing for these, so their sheet's
     cost is the only number there is — and it is what would have been
     written had somebody pressed confirm. */
  const value = Math.round(matched.reduce(
    (n, r) => n + Math.abs(r.proposal.theirCost ?? r.proposal.amount ?? 0), 0) * 100) / 100;
  return {
    matched, value,
    currencies: [...new Set(matched.map(r => r.proposal.currency || '').filter(Boolean))].sort(),
  };
}
