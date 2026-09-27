import type { Ticket } from '../../types';
import { missingDate } from './missingDate';

/**
 * A cancelled document, as the import should file it.
 *
 * Every parser already recognises its vendor's cancellation words and the
 * import already separates those rows out — it just threw them away. This is
 * the one step that was missing: what to keep of a row that carries no money.
 *
 * The de-duplication key is (document, supplier, period), so the period is
 * the field that decides whether re-importing the same file records the same
 * cancellation twice. Only BSP states one. For everyone else the document's
 * own month stands in: it is stable across re-imports of the same file, it
 * is what the ratio is grouped by anyway, and it is never empty for a row
 * that has a date. A row with no date at all falls back to the report it
 * came from, because two undated cancellations from one report are the same
 * import and should not both be counted.
 */

export interface VoidRecord {
  ticketNo: string;
  airlineCode: string;
  pnr: string;
  passengerName: string;
  date: string;
  source: string;
  period: string;
  currency: string;
  faceValue: number | null;
  rawStatus: string;
  reportName: string;
  note: string;
}

/* The same test the ledger uses. 1970-01-01 passes any shape check and says
   nothing — it is what a blank becomes after a trip through a number — and a
   void filed under it would sit in a period fifty-six years before the
   business existed and be counted in that year's ratio. */
const iso = (d: string) => (missingDate(d) ? '' : (d || '').trim().slice(0, 10));

/** BSP writes its period into the report name: "…_260804_Agent_Billing". */
const bspPeriod = (report: string) => report.match(/_(\d{6})_/)?.[1] ?? '';

export function periodFor(t: Ticket, reportName: string): string {
  const stated = bspPeriod(reportName || '');
  if (stated) return stated;
  const d = iso(t.date || '');
  if (d) return d.slice(0, 7);
  return (reportName || '').trim().slice(0, 64);
}

export function voidFromTicket(t: Ticket, reportName = ''): VoidRecord {
  return {
    ticketNo: (t.ticketNo || '').trim(),
    airlineCode: t.airlineCode || '',
    pnr: t.pnr || '',
    passengerName: t.passengerName || '',
    date: iso(t.date || ''),
    source: (t.source || '').trim(),
    period: periodFor(t, reportName),
    currency: t.currency || '',
    /* What the document would have been worth. A parser that already zeroed
       a void leaves nothing here, which is honest — the figure is context,
       never a balance, and an invented one would be worse than none. */
    faceValue: Math.abs(t.totalDoc ?? 0) || Math.abs(t.amount ?? 0) || null,
    rawStatus: (t.status || 'VOID').toUpperCase(),
    reportName: reportName || t.reportName || '',
    note: '',
  };
}

/**
 * The rows worth keeping, de-duplicated within the batch.
 *
 * A supplier's export lists the same cancellation on more than one line
 * often enough — a conjunction, a reissue cancelled in two coupons — and
 * the database would reject the second of them. Better to agree with the
 * database here than to send it something it has to refuse.
 *
 * A row with no document number at all is dropped: it cannot be counted
 * against anything, and cannot be found again.
 */
export function voidsFromImport(rows: Ticket[], reportName = ''): VoidRecord[] {
  const seen = new Set<string>();
  const out: VoidRecord[] = [];
  for (const t of rows) {
    const v = voidFromTicket(t, reportName);
    if (!v.ticketNo || !v.source) continue;
    const key = `${v.ticketNo}|${v.source}|${v.period}`.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
