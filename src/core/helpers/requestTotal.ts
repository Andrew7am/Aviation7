/**
 * What has been issued on a request: tickets and EMDs, at their full fare.
 * A refund does not take any of it back, a void was never billed, an On Hold
 * row was never issued.
 *
 * Our books are the record; a row on their Airtable whose ticket is not in
 * our books yet is counted from their sheet, so a total near a figure is seen
 * before the supplier's report arrives. Only the alert's currency is added -
 * dirhams are never summed with riyals.
 */
import { ticketMatchKey } from './ticketIdentity';
import { reqTokensOf } from './reqTokens';

export interface TotalBook { ticketNo: string; status?: string | null; amount: number; totalDoc?: number | null; currency?: string | null; reqNum?: string | null }
export interface TotalSheet { serials: string[]; status: string | null; net_cost: number | null; currency: string | null; req_num: string | null }

const SHEET_ISSUED = /^(issued|reissue)$/i;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function requestIssued(req: string, currency: string, books: TotalBook[], sheet: TotalSheet[]) {
  const want = req.trim().toUpperCase();
  const mine = books.filter(t => reqTokensOf(t.reqNum || '').includes(want));
  const held = new Set(mine.map(t => ticketMatchKey(t.ticketNo)).filter(Boolean));
  let fromBooks = 0, fromSheet = 0, docs = 0;
  for (const t of mine) {
    if ((t.status !== 'ISSUE' && t.status !== 'EMDS') || t.amount <= 0) continue;
    if ((t.currency || '').toUpperCase() !== currency) continue;
    fromBooks += t.totalDoc || t.amount; docs++;
  }
  for (const r of sheet) {
    if (!reqTokensOf(r.req_num || '').includes(want) || !SHEET_ISSUED.test(r.status ?? '')) continue;
    if ((r.currency || '').toUpperCase() !== currency || !r.net_cost || r.net_cost <= 0) continue;
    if (!r.serials.length || r.serials.some(s => held.has(ticketMatchKey(s)))) continue;
    fromSheet += r.net_cost; docs++;
  }
  return { total: r2(fromBooks + fromSheet), fromBooks: r2(fromBooks), fromSheet: r2(fromSheet), docs };
}
