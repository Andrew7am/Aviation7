import type { Ticket } from '../../types';

/** One realtime event as a change to the list: a row in whole, or the id of one that went. */
export type TicketChange = { kind: 'UPSERT'; ticket: Ticket } | { kind: 'DELETE'; id: string } | null;

/**
 * The list after a burst of realtime events, applied in the order they came.
 *
 * A row that changed is replaced where it stands, a new one is added at the
 * end, and a deleted one goes - the same list a full read would give, without
 * reading 6,000 rows to learn that one route was filled in.
 */
export function applyTicketChanges(prev: Ticket[], changes: TicketChange[]): Ticket[] {
  if (!changes.length) return prev;
  const byId = new Map(prev.map(t => [t.id, t]));
  for (const c of changes) {
    if (!c) continue;
    if (c.kind === 'DELETE') byId.delete(c.id);
    else byId.set(c.ticket.id, c.ticket);
  }
  return [...byId.values()];
}
