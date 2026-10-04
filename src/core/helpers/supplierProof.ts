/**
 * Whether a supplier has vouched for a row.
 *
 * A row read from a supplier's own report - BSP's billing, RTS's sales
 * report, a vendor statement - is the supplier saying so. A row typed from
 * the team's sheet, or by hand, is somebody saying the supplier will. Those
 * look identical in the ledger, which is how 7,025.00 on 5513408117 sat in
 * the books as an RTS refund that RTS's report never carried.
 *
 * So a row recorded from their sheet or by hand, for a supplier that reports
 * its business, is UNCONFIRMED until a report of that supplier carries the
 * same document at the same amount - which then confirms it. A purchase on
 * an airline's own website has no supplier report to wait for; it is never
 * unconfirmed.
 */
import type { Ticket } from '../../types';
import { ticketMatchKey } from './ticketIdentity';

/** Recorded from their sheet or typed by hand, not read from a supplier. */
export const fromSheetOrHand = (t: Pick<Ticket, 'reportName'>): boolean =>
  /^(team sheet|manual entry)/i.test((t.reportName || '').trim());

/** Nothing will ever report these; their sheet or the receipt is the record. */
const NO_SUPPLIER_REPORT = /^airline website$/i;

/** From their sheet or by hand, for a supplier that reports, and not yet
 *  carried by any of its reports - at whatever amount, 0.00 included: a
 *  "reissue at no charge" from their sheet is exactly what a supplier's
 *  report may sell at 650.00. */
export function awaitsSupplier(t: Ticket): boolean {
  if (!fromSheetOrHand(t)) return false;
  if (NO_SUPPLIER_REPORT.test((t.source || '').trim())) return false;
  return !(t.confirmedBy || '').trim();
}

/** Still waiting for the supplier to vouch for money in it. A row at 0.00
 *  moves no money and is not flagged - though a report can still correct it. */
export function unconfirmed(t: Ticket): boolean {
  return awaitsSupplier(t) && (t.amount || 0) !== 0;
}

const dir = (t: Ticket) => ((t.amount || 0) < 0 ? 'R' : 'S');
const sameMoney = (a: Ticket, b: Ticket) => {
  const x = Math.abs(a.originalAmount ?? a.amount ?? 0), y = Math.abs(b.amount ?? 0);
  return Math.abs(x - y) < 0.01 || Math.abs(Math.abs(a.totalDoc ?? 0) - Math.abs(b.totalDoc ?? 0)) < 0.01 && (a.totalDoc ?? 0) !== 0;
};

export interface Confirmation { id: string; ticketNo: string; by: string }
export interface Disagreement { ours: Ticket; report: Ticket }
/** A row from their sheet or by hand, put right to the supplier's figure. */
export interface Correction {
  id: string; ticketNo: string; by: string;
  was: { amount: number; totalDoc: number; commission: number; transactionType: string };
  amount: number; totalDoc: number; commission: number;
}

/**
 * Which disagreements the supplier settles on its own.
 *
 * Their sheet is the team's account of a sale; the supplier's report is the
 * sale. Where the two disagree on a row we recorded from their sheet, the
 * supplier's figure goes in - 5512878158 to 166 went in at 0.00 as reissues
 * at no charge from their sheet, and RTS sells each at 650.00.
 *
 * Not where the currency differs: 20,140.00 SAR against RTS's 20.00 AED is
 * not a figure to copy across but a question for a person. And not where
 * the supplier differs, because then the report's row goes in as a ticket of
 * its own and correcting ours as well would count it twice.
 */
export function correctionsFrom(differ: Disagreement[], by: string): { correct: Correction[]; ask: Disagreement[] } {
  const correct: Correction[] = [], ask: Disagreement[] = [];
  for (const d of differ) {
    const sameCurrency = (d.ours.originalCurrency ? '' : (d.ours.currency || '')).toUpperCase()
      === (d.report.currency || '').toUpperCase();
    const sameSupplier = (d.ours.source || '').trim().toLowerCase() === (d.report.source || '').trim().toLowerCase();
    if (!sameCurrency || !sameSupplier) { ask.push(d); continue; }
    correct.push({
      id: d.ours.id, ticketNo: d.ours.ticketNo, by,
      was: { amount: d.ours.amount, totalDoc: d.ours.totalDoc ?? 0, commission: d.ours.commission ?? 0,
             transactionType: d.ours.transactionType || '' },
      amount: d.report.amount, totalDoc: d.report.totalDoc ?? Math.abs(d.report.amount), commission: d.report.commission ?? 0,
    });
  }
  return { correct, ask };
}

/**
 * What an incoming supplier report says about rows we recorded from their
 * sheet or by hand: the ones it carries at the same amount (confirmed) and
 * the ones it carries at a different amount (to look at). Matched on the
 * document and its direction - a sale never vouches for a refund.
 */
export function confirmationsFrom(incoming: Ticket[], existing: Ticket[], reportName: string)
  : { confirm: Confirmation[]; differ: Disagreement[] } {
  const waiting = new Map<string, Ticket[]>();
  for (const t of existing) {
    if (!awaitsSupplier(t)) continue;
    const k = `${ticketMatchKey(t.ticketNo || '')}|${dir(t)}`;
    if (!waiting.has(k)) waiting.set(k, []);
    waiting.get(k)!.push(t);
  }
  const confirm: Confirmation[] = [];
  const differ: Disagreement[] = [];
  const seen = new Set<string>();
  for (const r of incoming) {
    const k = `${ticketMatchKey(r.ticketNo || '')}|${dir(r)}`;
    for (const ours of waiting.get(k) ?? []) {
      if (seen.has(ours.id)) continue;
      seen.add(ours.id);
      if (sameMoney(ours, r)) confirm.push({ id: ours.id, ticketNo: ours.ticketNo, by: reportName });
      else differ.push({ ours, report: r });
    }
  }
  return { confirm, differ };
}
