/**
 * The request a ticket of ours belongs to, read off the team's Airtable -
 * by its number, and only by its number.
 *
 * Supplier reports carry no request, so a ticket imported from one arrives
 * with none. Their sheet says it - when their sheet names that ticket. A
 * ticket of ours their sheet does not name is the very thing the agency is
 * looking for: one they forgot, to be sent back to them to add. Borrowing
 * the request from the rest of its booking would file it quietly and hide
 * exactly that, which is what happened to ZWE5AG's eleven tickets. So:
 *
 *   every row of theirs naming the document - in the ticket column, or the
 *   EMD column for an EMD - carries the same single request: it is taken.
 *
 *   a refund takes it only from a refund row. Their sheet showing the sale
 *   alone means the refund was never written there - H692FC was refunded
 *   on 13 Oct, their sheet still shows only its sale, and the refund took
 *   the sale's KSAML2706, so it never reached Missing Req to be sent back.
 *
 * Never over a request already there, never from a row naming two
 * requests, never from a held booking, and never on a guess between two.
 */
import { teamSerials } from '../parsers/teamSheet';
import { docKey } from './airtableNotices';

export interface ReqSource { serials: string[]; emd: string; pnr: string; req_num: string; status: string; portal?: string; airline?: string }
/** `source` matters for two vendors: flyadeal's and flydubai's reports carry
 *  no ticket number, so we hold their tickets under the PNR and match them by it. */
export interface MissingReq { id: string; ticketNo: string; pnr: string; source?: string; status?: string }
export interface ReqFill { id: string; ticketNo: string; req: string; how: 'ticket number' | 'flyadeal PNR' | 'flydubai PNR' }

/** A flyadeal row of theirs, and a flyadeal ticket of ours. */
export const isFlyadealRow = (r: { portal?: string; airline?: string }) =>
  /flyadeal/i.test(r.airline || '') || /^\s*f3\b/i.test(r.portal || '');
export const isFlyadealTicket = (source?: string) => /flyadeal/i.test(source || '');
/** flydubai the same (the user, 25 Oct 2026): held under the PNR, matched by it. */
export const isFlydubaiRow = (r: { portal?: string; airline?: string }) =>
  /fly\s*dubai/i.test(r.airline || '') || /fly\s*dubai|^\s*fz\b/i.test(r.portal || '');
export const isFlydubaiTicket = (source?: string) => /fly\s*dubai/i.test(source || '');
/** Which PNR-matched vendor a row or ticket is, as a key prefix - so a
 *  flyadeal PNR never answers for a flydubai ticket. */
export const pnrVendorOfRow = (r: { portal?: string; airline?: string }) => (isFlyadealRow(r) ? 'F3' : isFlydubaiRow(r) ? 'FZ' : '');
export const pnrVendorOfTicket = (source?: string) => (isFlyadealTicket(source) ? 'F3' : isFlydubaiTicket(source) ? 'FZ' : '');
const pnrParts = (p: string) => (p || '').toUpperCase().split(/[|,/\s]+/).filter(Boolean);

const one = (req: string) => {
  const parts = (req || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts.length ? 'TWO' : '';
};
const held = (s: string) => /hold/i.test(s || '');
/** Their "Cancelled/Refunded"; our REFUND. */
const refundRow = (status: string) => /refund/i.test(status || '');
const refundOurs = (status?: string) => /refund/i.test(status || '');

type Side = { sale: string[]; refund: string[] };
const add = (m: Map<string, Side>, k: string, refund: boolean, req: string) => {
  const e = m.get(k) ?? { sale: [], refund: [] };
  (refund ? e.refund : e.sale).push(req);
  m.set(k, e);
};
/** The rows a ticket of ours may take its request from. A refund: refund
 *  rows only. A sale: its sale rows - or, where the team turned the one row
 *  to Cancelled/Refunded rather than adding one, that row. */
const rowsFor = (e: Side | undefined, refund: boolean) =>
  !e ? [] : refund ? e.refund : e.sale.length ? e.sale : e.refund;
const single = (reqs: string[]) => {
  const s = new Set(reqs);
  return s.size === 1 && !s.has('TWO') ? [...s][0] : '';
};

export function requestsFor(missing: MissingReq[], rows: ReqSource[]): ReqFill[] {
  /* The same document under two requests: its sale on one row, its refund
     on another. 5513427844 is sold under KSAML2325 and refunded on a row the
     team filed under KSAFM2466. A refund takes its refund row's request; a
     sale, its sale row's. */
  const byDoc = new Map<string, Side>();
  const byPnr = new Map<string, Side>();
  for (const r of rows) {
    if (held(r.status)) continue;
    const req = one(r.req_num);
    if (!req) continue;
    const refund = refundRow(r.status);
    const v = pnrVendorOfRow(r);
    if (v) for (const p of pnrParts(r.pnr)) add(byPnr, `${v}:${p}`, refund, req);
    for (const d of new Set([...r.serials, ...teamSerials(r.emd || '').map(x => x.serial)].map(docKey).filter(Boolean)))
      add(byDoc, d, refund, req);
  }
  /* Rows are not counted against documents: a flyadeal row of theirs may
     hold a booking and its change together - V6MKFS's one row of 1,198 SAR
     is our two sales of 918.71 and 254.65 AED. */
  const out: ReqFill[] = [];
  for (const t of missing) {
    const refund = refundOurs(t.status);
    const byNo = single(rowsFor(byDoc.get(docKey(t.ticketNo)), refund));
    if (byNo) { out.push({ id: t.id, ticketNo: t.ticketNo, req: byNo, how: 'ticket number' }); continue; }
    const v = pnrVendorOfTicket(t.source);
    if (!v) continue;
    const f = single(pnrParts(t.pnr || t.ticketNo).flatMap(p => rowsFor(byPnr.get(`${v}:${p}`), refund)));
    if (f) out.push({ id: t.id, ticketNo: t.ticketNo, req: f, how: v === 'F3' ? 'flyadeal PNR' : 'flydubai PNR' });
  }
  return out;
}
