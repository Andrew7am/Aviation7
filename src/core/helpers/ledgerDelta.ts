/**
 * The ledger held on the device, brought up to date with what changed.
 *
 * `changed` is every row whose updated_at is past the cursor (less a minute's
 * overlap), `gone` every id deleted since. A row read in this same pass
 * exists now, whatever the log says of an earlier delete of that id. The
 * cursor only moves forward, and only to times the server gave.
 */
export interface HeldLedger<R extends { id: string; updated_at?: string | null }> {
  byId: Map<string, R>;
  cursor: string;
  fullAt: number;
}

const later = (a: string, b?: string | null) => (b && b > a ? b : a);

export function cursorOf(rows: { updated_at?: string | null }[]): string {
  return rows.reduce((m, r) => later(m, r.updated_at), '');
}

export function applyDelta<R extends { id: string; updated_at?: string | null }>(
  held: HeldLedger<R>, changed: R[], gone: { id: string; deleted_at: string }[],
): HeldLedger<R> {
  const byId = new Map(held.byId);
  let cursor = held.cursor;
  const here = new Set<string>();
  for (const r of changed) { byId.set(r.id, r); here.add(r.id); cursor = later(cursor, r.updated_at); }
  for (const g of gone) { if (!here.has(g.id)) byId.delete(g.id); cursor = later(cursor, g.deleted_at); }
  return { byId, cursor, fullAt: held.fullAt };
}

/** Where to read changes from: the cursor less the overlap. */
export function changedSince(cursor: string, overlapMs = 60_000): string {
  return new Date(new Date(cursor).getTime() - overlapMs).toISOString();
}
