/**
 * Money changed on a ticket after somebody closed it.
 *
 * Closing a ticket means the figure was settled with the client. A change to
 * the money afterwards is sometimes exactly right — Ibtekar's statement bills
 * ten riyals the ledger did not have, and the ledger should agree with what
 * will be paid — but it is never a change the client has seen. So it should
 * never happen silently.
 *
 * It has been happening silently. Eleven such edits are in the log, seven of
 * them one morning, each adding the ten-riyal fee to a ticket closed days
 * before. Nothing on screen said so.
 *
 * WHY THIS IS WORKED OUT RATHER THAN READ
 *
 * The two events are logged under different names for the same ticket. A
 * close records the ticket's id — a bulk close records a list of them — and
 * the undo feature depends on that, so it cannot change. An edit records the
 * ticket's number. Neither can be joined to the other directly, so the ids
 * are resolved through the ledger first. A ticket since deleted cannot be
 * resolved, and that is fine: it is not on the screen to be flagged.
 *
 * A reopen cancels a close. A ticket closed, reopened and edited, then closed
 * again, was edited while open — which is what reopening is for.
 */

export interface AuditEvent {
  action: string;
  entity: string;
  detail: string;
  /** ISO timestamp. Compared as a string, which is chronological for ISO. */
  performedAt: string;
  actorEmail?: string;
}

export interface MoneyChange {
  at: string;
  detail: string;
  by: string;
}

export interface ChangedAfterClose {
  /** When the ticket was last closed. */
  closedAt: string;
  /** Every money edit made since, oldest first. */
  changes: MoneyChange[];
}

const MONEY = /\b(amount|commission|total_?doc|totalDoc)\b/i;
const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);

/** Did this close/reopen entry close, or reopen? */
export function closes(detail: string): boolean | null {
  const d = (detail || '').trim();
  if (/^not closed/i.test(d)) return false;
  if (/^closed/i.test(d)) return true;
  return null;
}

/**
 * Tickets whose money moved after their last close, keyed by ticket id.
 *
 * `tickets` resolves both sides: id for the close, document number for the
 * edit. Only the id and ticket number are needed.
 */
export function changedAfterClose(
  events: AuditEvent[],
  tickets: { id: string; ticketNo: string; amount?: number }[],
): Map<string, ChangedAfterClose> {
  const byId = new Map(tickets.map(t => [t.id, t]));
  const idsBySerial = new Map<string, string[]>();
  for (const t of tickets) {
    const k = serial(t.ticketNo);
    if (!k) continue;
    if (!idsBySerial.has(k)) idsBySerial.set(k, []);
    idsBySerial.get(k)!.push(t.id);
  }

  // Oldest first, so the latest close is what is left standing.
  const ordered = [...events].sort((a, b) => a.performedAt.localeCompare(b.performedAt));

  const closedAt = new Map<string, string>();
  const out = new Map<string, ChangedAfterClose>();

  for (const e of ordered) {
    if (e.action === 'UPDATE_CLOSED' || e.action === 'BULK_UPDATE_CLOSED') {
      const state = closes(e.detail);
      if (state === null) continue;
      for (const raw of e.entity.split(',')) {
        const id = raw.trim();
        if (!byId.has(id)) continue;
        if (state) closedAt.set(id, e.performedAt);
        else {
          /* Reopening is exactly the permission to change it. What was
             flagged before the reopen stays flagged — it happened — but
             nothing after it counts against the next close. */
          closedAt.delete(id);
        }
      }
      continue;
    }

    if (e.action !== 'EDIT_TICKET' || !MONEY.test(e.detail || '')) continue;
    /* Only a change that says what the figure WAS as well as what it became.
       The database's own trigger writes those, and writes them only when a
       value actually moves — not once in the log does its "before" equal
       its "after". The app's "Edited: amount=2872" line is written every
       time a cell is opened and closed, changed or not: thirty-five of its
       sixty-two amount lines moved nothing, and one ticket read CHANGED 3
       for three glances at a figure nobody altered. Every real change has a
       trigger line beside it, so leaving the app's lines out loses nothing. */
    if (!movedFrom(e.detail)) continue;
    /* An edit is logged by document number, and one number can name two
       rows — an issue and the refund against it. The sign of the figure the
       edit left behind says which: an issue is positive, a refund negative,
       and an edit to one never turns it into the other. Where the edit names
       no figure, or the sign does not settle it, every row is checked. */
    const candidates = idsBySerial.get(serial(e.entity)) ?? (byId.has(e.entity) ? [e.entity] : []);
    const after = resultingAmount(e.detail);
    const bySign = after === null || candidates.length < 2 ? candidates
      : candidates.filter(id => Math.sign(byId.get(id)?.amount ?? 0) === Math.sign(after));
    for (const id of bySign.length ? bySign : candidates) {
      if (!id) continue;
      const at = closedAt.get(id);
      if (!at || e.performedAt <= at) continue;
      if (!out.has(id)) out.set(id, { closedAt: at, changes: [] });
      const list = out.get(id)!.changes;
      const change = { at: e.performedAt, detail: e.detail, by: e.actorEmail || 'system' };
      /* One edit, logged twice. The database's own trigger writes
         "amount: 1000.5 -> 1011" and the app writes "Edited: amount=1011"
         for the same change, a second apart. Counted as two, every edit
         would read as a ticket changed twice. The trigger's line is kept,
         because it carries what the figure was as well as what it became. */
      const prev = list[list.length - 1];
      if (prev && sameMoment(prev.at, change.at)) {
        if (!hasBefore(prev.detail) && hasBefore(change.detail)) list[list.length - 1] = change;
        continue;
      }
      list.push(change);
    }
  }
  return out;
}

/** The amount an edit left behind: "amount: 1000.5 -> 1011" or "amount=1011". */
function resultingAmount(detail: string): number | null {
  const hit = /amount\s*(?::\s*[-\d.,]+\s*->\s*|=\s*)(-?[\d.,]+)/i.exec(detail || '');
  if (!hit) return null;
  const n = Number(hit[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Within a few seconds: the two writers of one edit are never further apart. */
function sameMoment(a: string, b: string): boolean {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return Math.abs(ta - tb) <= 5_000;
}

/** A "before -> after" whose two sides differ: a change, not a glance. */
function movedFrom(detail: string): boolean {
  const pairs = [...(detail || '').matchAll(/:\s*(-?[\d.,]*)\s*->\s*(-?[\d.,]*)/g)];
  if (!pairs.length) return false;
  return pairs.some(([, a, b]) => {
    const x = Number(a.replace(/,/g, '')), y = Number(b.replace(/,/g, ''));
    return a.trim() !== b.trim() && !(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.005);
  });
}

/** "amount: 1000.5 -> 1011" says what it was; "Edited: amount=1011" does not. */
const hasBefore = (detail: string) => /->/.test(detail || '');
