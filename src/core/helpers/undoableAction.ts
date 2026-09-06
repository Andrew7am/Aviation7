import type { AuditRecord } from '../../services/AuditService';

/**
 * Which logged actions can be taken back, and what taking them back means.
 *
 * Only the close/reopen actions qualify today. They are the ones that record
 * the ticket IDS they touched and a state that is its own opposite, so the
 * reversal is exact rather than inferred. An import or a manual entry names no
 * way back — undoing those means deciding what to do with money already
 * reconciled against them, which is a person's call, not a button's.
 *
 * Anything not listed here shows no Undo button at all. A greyed-out one on
 * every row would suggest the feature is broken rather than deliberately
 * narrow.
 */

/** Marks the audit row an undo reverses, so the same mistake cannot be undone
 *  twice — and so the log reads as a pair rather than two unrelated events. */
export const UNDO_OF = '— undo of ';

export interface Undoable {
  /** Tickets the original action touched. */
  ids: string[];
  /** What that action set them to. Undo moves them off this value, and only
   *  the rows still sitting at it. */
  from: boolean;
  /** What undo puts them back to. */
  to: boolean;
  /** Said to the user before anything is written. */
  question: string;
}

/** True when this row is itself an undo of something. */
export const isUndoEntry = (r: AuditRecord): boolean => r.detail.includes(UNDO_OF);

/** The id of the audit row this one undid, or '' when it is not an undo. */
export function undoneAuditId(r: AuditRecord): string {
  const i = r.detail.indexOf(UNDO_OF);
  return i < 0 ? '' : r.detail.slice(i + UNDO_OF.length).trim();
}

/**
 * What undoing this row would do, or null when it cannot be undone.
 *
 * The state to restore comes from the detail the action wrote about itself —
 * "Closed" means it closed them, so undo reopens them.
 */
export function undoableAction(r: AuditRecord): Undoable | null {
  if (r.action !== 'UPDATE_CLOSED' && r.action !== 'BULK_UPDATE_CLOSED') return null;
  if (isUndoEntry(r)) return null;

  const ids = r.entity.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return null;

  // "Not Closed" has to be tested first: it contains "Closed".
  const setTo = /not closed/i.test(r.detail) ? false
              : /closed/i.test(r.detail)     ? true
              : null;
  if (setTo === null) return null;

  const what = ids.length === 1 ? 'this ticket' : `these ${ids.length} tickets`;
  return {
    ids, from: setTo, to: !setTo,
    question: setTo
      ? `Reopen ${what}? Any that someone has since reopened already are left alone.`
      : `Close ${what} again? Any that someone has since closed already are left alone.`,
  };
}
