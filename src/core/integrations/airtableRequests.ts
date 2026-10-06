/**
 * The request a ticket of ours belongs to, read off the team's Airtable.
 *
 * Supplier reports carry no request - RTS's has no column for it, Ibtekar's
 * paste none either - so a ticket imported from one arrives with none and
 * sits in Needs Action until somebody types it. Their sheet already says it.
 * So: a ticket of ours with no request takes theirs, when their sheet says
 * it with one voice -
 *
 *   by number  every row of theirs naming the document (ticket column, or
 *              the EMD column for an EMD) carries the same single request;
 *   by booking failing that, every issued row of theirs on its PNR does -
 *              ZWE5AG's nine passengers, written as one cell for two of them,
 *              are all UAEVP420.
 *
 * Never over a request already there, never from a row that names two
 * requests, never from a held booking, and never on a guess between two.
 */
import { teamSerials } from '../parsers/teamSheet';
import { docKey } from './airtableNotices';

export interface ReqSource { serials: string[]; emd: string; pnr: string; req_num: string; status: string }
export interface MissingReq { id: string; ticketNo: string; pnr: string }
export interface ReqFill { id: string; ticketNo: string; req: string; how: 'ticket number' | 'booking PNR' }

const pnrParts = (p: string) => (p || '').toUpperCase().split(/[|,/\s]+/).filter(Boolean);
const one = (req: string) => {
  const parts = (req || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts.length ? 'TWO' : '';
};
const held = (s: string) => /hold/i.test(s || '');

export function requestsFor(missing: MissingReq[], rows: ReqSource[]): ReqFill[] {
  const byDoc = new Map<string, Set<string>>();
  const byPnr = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(v);
  };
  for (const r of rows) {
    if (held(r.status)) continue;
    const req = one(r.req_num);
    if (!req) continue;
    const docs = [...r.serials, ...teamSerials(r.emd || '').map(d => d.serial)];
    for (const d of docs) add(byDoc, docKey(d), req);
    for (const p of pnrParts(r.pnr)) add(byPnr, p, req);
  }
  const settled = (s?: Set<string>) => (s && s.size === 1 && !s.has('TWO') ? [...s][0] : '');

  const out: ReqFill[] = [];
  for (const t of missing) {
    const byNumber = settled(byDoc.get(docKey(t.ticketNo)));
    if (byNumber) { out.push({ id: t.id, ticketNo: t.ticketNo, req: byNumber, how: 'ticket number' }); continue; }
    // A document their sheet names at all, under two requests, is not
    // settled by its booking either.
    if (byDoc.has(docKey(t.ticketNo))) continue;
    const pnrs = pnrParts(t.pnr);
    const reqs = new Set(pnrs.flatMap(p => [...(byPnr.get(p) ?? [])]));
    const byBooking = pnrs.length && reqs.size === 1 && !reqs.has('TWO') ? [...reqs][0] : '';
    if (byBooking) out.push({ id: t.id, ticketNo: t.ticketNo, req: byBooking, how: 'booking PNR' });
  }
  return out;
}
