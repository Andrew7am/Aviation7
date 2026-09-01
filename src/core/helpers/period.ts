/**
 * Date-range helpers shared by the ticket list and the analytics screen.
 *
 * Dates are stored as YYYY-MM-DD throughout, so a string compare IS a date
 * compare and the month is simply the first seven characters. Nothing here
 * parses a Date except to ask how long a month is.
 */

/** Last day of a YYYY-MM month, as YYYY-MM-DD. Day 0 of the NEXT month is the
 *  last day of this one, which gets February and leap years right for free. */
export function endOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** "2026-03" -> "Mar 2026", for the month picker. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`;
}

/** Every month present in the data, newest first. */
export function monthsIn(dates: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const d of dates) if (/^\d{4}-\d{2}/.test(d || '')) seen.add((d as string).slice(0, 7));
  return [...seen].sort().reverse();
}

export interface Period { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The quick answers to "what period?".
 *
 * Ranges are built from today rather than from the data, so an empty month
 * shows as empty instead of silently sliding to the last month that happens
 * to have tickets in it — the range asked for is the range applied.
 */
export const PERIOD_PRESETS: { key: string; label: string; range: () => Period }[] = [
  { key: 'all', label: 'All time', range: () => ({ from: '', to: '' }) },
  {
    key: 'this_month', label: 'This month',
    range: () => {
      const n = new Date();
      const ym = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
      return { from: `${ym}-01`, to: endOfMonth(ym) };
    },
  },
  {
    key: 'last_month', label: 'Last month',
    range: () => {
      const n = new Date();
      const d = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return { from: `${ym}-01`, to: endOfMonth(ym) };
    },
  },
  {
    key: 'last_3', label: 'Last 3 months',
    range: () => {
      const n = new Date();
      const s = new Date(n.getFullYear(), n.getMonth() - 2, 1);
      return { from: iso(s), to: iso(n) };
    },
  },
  {
    key: 'last_12', label: 'Last 12 months',
    range: () => {
      const n = new Date();
      const s = new Date(n.getFullYear(), n.getMonth() - 11, 1);
      return { from: iso(s), to: iso(n) };
    },
  },
  {
    key: 'this_year', label: 'This year',
    range: () => {
      const y = new Date().getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

/** The YYYY-MM a from/to pair represents, or '' when it is not exactly one
 *  whole month — what the month dropdown shows as its current selection. */
export function selectedMonth(from: string, to: string): string {
  return from && to && from.slice(0, 7) === to.slice(0, 7)
    && from.endsWith('-01') && to === endOfMonth(from.slice(0, 7))
    ? from.slice(0, 7) : '';
}

/** Does this date fall inside the range? An empty bound is open-ended, and a
 *  ticket with no date is only included when no range is set at all — it
 *  cannot be shown to belong to a period it has no date for. */
export function inPeriod(date: string | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  const d = (date || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** A short human label for the active range, for headings and file names. */
export function periodLabel(from: string, to: string): string {
  if (!from && !to) return 'All time';
  const m = selectedMonth(from, to);
  if (m) return monthLabel(m);
  if (from && to) return `${from} to ${to}`;
  return from ? `from ${from}` : `up to ${to}`;
}
