/**
 * What a change on the team's Airtable means for our books.
 *
 * Every notice waits for a person. None of them writes on its own: a request
 * moved on their side may be their mistake, and a supplier's figure is still
 * the one that is paid. What a notice carries is exactly what accepting it
 * would do, so the person reads the change and the consequence together.
 *
 *   REQ_CHANGED  their request on a ticket we hold moved     -> move ours
 *   REFUND       their sheet refunded a ticket we hold        -> look; the supplier's report credits it
 *   VOID         their sheet voided a ticket we hold          -> look
 *   PRICE        their cost on a ticket we hold changed       -> look; the supplier's figure stands
 *
 * Names and cabins are offered only where the row is one passenger for
 * certain - one document, or a conjunction pair - because their row carries
 * one name and a cell of six tickets is six people.
 */
import type { AirtableTicketRow, FieldChange } from './airtable';
import { reqParts } from '../helpers/teamSheetCompare';
import { cleanPax } from '../parsers/shared';

export type NoticeKind = 'REQ_CHANGED' | 'NAME' | 'CABIN' | 'REFUND' | 'VOID' | 'PRICE' | 'ONLINE_TICKET' | 'NOT_IN_BOOKS';

export interface Notice {
  kind: NoticeKind;
  dedupe_key: string;
  record_id: string;
  ticket_no: string;
  ticket_ids: string[];
  req_num: string;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

export interface LedgerLite {
  id: string; ticketNo: string; pnr?: string; reqNum?: string; passengerName?: string;
  cabinClass?: string; source?: string; amount?: number; status?: string; currency?: string;
}

/** A document's key: the ten-digit serial, or the reference itself (a PNR). */
export const docKey = (t: string) => {
  const d = (t || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : (t || '').replace(/\s+/g, '').toUpperCase();
};

export function ledgerIndex(ledger: LedgerLite[]): Map<string, LedgerLite[]> {
  const m = new Map<string, LedgerLite[]>();
  for (const t of ledger) {
    const k = docKey(t.ticketNo);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return m;
}

/** One passenger for certain: one document, or two consecutive serials
 *  written as a conjunction ("176-5512845110-11"). */
export function onePassenger(r: AirtableTicketRow): boolean {
  if (r.serials.length === 1) return true;
  if (r.serials.length !== 2) return false;
  const [a, b] = r.serials.map(Number);
  return Number.isFinite(a) && b - a === 1 && /\d{10}-\d{1,2}\b/.test(r.ticket_cell.replace(/\s+/g, ''));
}

const PLACEHOLDER = /NOT FOUND|^CLIENT NAME|^UNKNOWN|^GROUP\b|^N\/?A$|^CC$|^TBA$|^TBC$/;
export function usableName(raw: string): string {
  const n = cleanPax(raw || '').toUpperCase().replace(/\s+/g, ' ').trim()
    .replace(/^(MR|MRS|MS|MISS|MSTR|DR)\s+|\s+(MR|MRS|MS|MISS|MSTR)$/g, '').trim();
  return n.length >= 3 && !PLACEHOLDER.test(n) && /[A-Z]/.test(n) ? n : '';
}

const CABINS: [RegExp, string][] = [[/premium/i, 'PREMIUM ECONOMY'], [/first/i, 'FIRST'], [/business/i, 'BUSINESS'], [/economy/i, 'ECONOMY']];
export function usableCabin(raw: string): string {
  if (!raw || /;|,|\band\b/i.test(raw) || /couldn|determin|unknown/i.test(raw)) return '';
  return CABINS.find(([re]) => re.test(raw))?.[1] ?? '';
}

const money = (v: string) => (v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * The notices one sync raises: from what changed on each record, and - for
 * names and cabins - from what a record now offers that we lack.
 */
export function noticesFor(
  rows: AirtableTicketRow[], changes: Map<string, FieldChange[]>, ledger: Map<string, LedgerLite[]>,
): Notice[] {
  const out: Notice[] = [];
  for (const r of rows) {
    const ours = r.serials.flatMap(s => ledger.get(docKey(s)) ?? []);
    if (!ours.length) continue;
    const label = r.ticket_cell.replace(/\s+/g, ' ').slice(0, 60) || r.pnr;
    const base = { record_id: r.record_id, ticket_no: label, req_num: r.req_num };
    const ch = changes.get(r.record_id) ?? [];
    const changed = (f: keyof AirtableTicketRow) => ch.find(c => c.field === f);

    // Their request moved: offer to move the tickets of ours not already under it.
    const req = changed('req_num');
    if (req && r.req_num) {
      const want = new Set(reqParts(r.req_num));
      const move = ours.filter(t => !reqParts(t.reqNum).some(k => want.has(k)));
      if (move.length) out.push({ ...base, kind: 'REQ_CHANGED',
        dedupe_key: `REQ|${r.record_id}|${r.req_num}`,
        ticket_ids: move.map(t => t.id),
        title: `Request changed on their sheet: ${req.old || '(none)'} → ${r.req_num}`,
        detail: `${label}: ours is under ${[...new Set(move.map(t => t.reqNum || '(none)'))].join(', ')}. Accept to move ${move.length} ticket${move.length === 1 ? '' : 's'} of ours to ${r.req_num}.`,
        payload: { from: req.old, to: r.req_num, ours: move.map(t => ({ id: t.id, ticketNo: t.ticketNo, reqNum: t.reqNum })) } });
    }

    // Names and cabins are not notices: they are filled from the row by its
    // number, with nobody asked (airtableDetails).

    const st = changed('status');
    if (st && /refund/i.test(r.status)) out.push({ ...base, kind: 'REFUND',
      dedupe_key: `REFUND|${r.record_id}|${r.refund_amount ?? ''}`,
      ticket_ids: ours.map(t => t.id),
      title: `Refunded on their sheet: ${label}${r.refund_amount != null ? ` · ${money(String(r.refund_amount))} ${r.currency}` : ''}`,
      detail: `Their sheet now says ${r.status}. The supplier's report is what credits it - check it has, or follow up.`,
      payload: { status: r.status, refund: r.refund_amount } });
    else if (changed('refund_amount') && r.refund_amount != null) out.push({ ...base, kind: 'REFUND',
      dedupe_key: `REFUND|${r.record_id}|${r.refund_amount}`,
      ticket_ids: ours.map(t => t.id),
      title: `Refund amount changed on their sheet: ${label} · ${money(changed('refund_amount')!.old)} → ${money(String(r.refund_amount))} ${r.currency}`,
      detail: `The supplier's report is what credits it - compare with it.`,
      payload: { refund: r.refund_amount } });
    if (st && /void/i.test(r.status) && ours.some(t => (t.amount || 0) > 0)) out.push({ ...base, kind: 'VOID',
      dedupe_key: `VOID|${r.record_id}`,
      ticket_ids: ours.map(t => t.id),
      title: `Voided on their sheet: ${label}`,
      detail: `We hold it as a sale. Check the supplier voided it too, and record it in Voids if so.`,
      payload: { status: r.status } });
    const price = changed('net_cost');
    if (price && r.net_cost != null) out.push({ ...base, kind: 'PRICE',
      dedupe_key: `PRICE|${r.record_id}|${r.net_cost}`,
      ticket_ids: ours.map(t => t.id),
      title: `Cost changed on their sheet: ${label} · ${money(price.old)} → ${money(String(r.net_cost))} ${r.currency}`,
      detail: `We hold ${ours.map(t => `${money(String(t.amount ?? 0))} ${t.currency || ''}`.trim()).join(' / ')}. The supplier's figure is the one paid - nothing changes unless you correct it.`,
      payload: { from: price.old, to: r.net_cost } });
  }
  return out;
}
