import React from 'react';

/**
 * Every status in every table, one way.
 *
 * A soft chip: a pale tint behind, the same colour deeper for the words, a
 * hairline ring of it round the edge, the words in ordinary case at 11px.
 * It reads at a glance without shouting - the screens had 10px bold capitals
 * in six slightly different colourings for the same meaning.
 *
 * The colour carries the meaning, and the same meaning has the same colour
 * on every screen:
 *   success - done, sound: Closed, Tax invoice held, OK, Final
 *   warning - waiting, short: Part closed, Not closed, Low, Hold
 *   danger  - wrong, owed: Overdraft, No invoice, Invoice total wrong
 *   neutral - cancelled, no effect: Void, Total only, Ours only
 *   info    - what a document is: Issue, Refund, EMD, ADM, credit note
 * The words always say it too, so the colour is never the only signal.
 */
export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const TONE: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
};

const BASE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-mini leading-4 font-medium ring-1 ring-inset';

/** The classes of a badge, for a button or a span that must stay one. */
export const badgeClass = (tone: Tone) => `${BASE} ${TONE[tone]}`;

export const StatusBadge: React.FC<{
  tone: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}> = ({ tone, children, title, className = '' }) => (
  <span className={`${badgeClass(tone)} ${className}`} title={title}>{children}</span>
);

/** A ticket's status as the ledger stores it (ISSUE, REFUND, TKTT...) -> the
 *  badge's tone and words. BSP's own four-letter codes stay as BSP writes
 *  them; plain words are written as words. */
const TICKET_STATUS: Record<string, [Tone, string]> = {
  ISSUE: ['info', 'Issue'], REFUND: ['info', 'Refund'], FUND: ['success', 'Top-up'],
  VOID: ['neutral', 'Void'], HOLD: ['warning', 'Hold'], ADM: ['info', 'ADM'], ACM: ['info', 'ACM'],
  TKTT: ['info', 'TKTT'], RFND: ['info', 'RFND'], CANN: ['neutral', 'CANN'], CANX: ['neutral', 'CANX'],
  RFNX: ['neutral', 'RFNX'], EMDS: ['info', 'EMD'],
};
export function ticketStatus(status: string): [Tone, string] {
  return TICKET_STATUS[(status || '').toUpperCase()] ?? ['neutral', status || '—'];
}
