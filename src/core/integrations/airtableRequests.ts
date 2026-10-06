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
 * Never over a request already there, never from a row naming two
 * requests, never from a held booking, and never on a guess between two.
 */
import { teamSerials } from '../parsers/teamSheet';
import { docKey } from './airtableNotices';

export interface ReqSource { serials: string[]; emd: string; pnr: string; req_num: string; status: string }
export interface MissingReq { id: string; ticketNo: string; pnr: string }
export interface ReqFill { id: string; ticketNo: string; req: string; how: 'ticket number' }

const one = (req: string) => {
  const parts = (req || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts.length ? 'TWO' : '';
};
const held = (s: string) => /hold/i.test(s || '');

export function requestsFor(missing: MissingReq[], rows: ReqSource[]): ReqFill[] {
  const byDoc = new Map<string, Set<string>>();
  for (const r of rows) {
    if (held(r.status)) continue;
    const req = one(r.req_num);
    if (!req) continue;
    for (const d of [...r.serials, ...teamSerials(r.emd || '').map(x => x.serial)]) {
      const k = docKey(d);
      if (!k) continue;
      if (!byDoc.has(k)) byDoc.set(k, new Set());
      byDoc.get(k)!.add(req);
    }
  }
  const out: ReqFill[] = [];
  for (const t of missing) {
    const s = byDoc.get(docKey(t.ticketNo));
    if (s && s.size === 1 && !s.has('TWO')) out.push({ id: t.id, ticketNo: t.ticketNo, req: [...s][0], how: 'ticket number' });
  }
  return out;
}
