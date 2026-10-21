/**
 * How much of an airline's weekly sales limit on IATA has been used.
 *
 * Emirates (176) lets the agency issue up to 300,000 AED a week on its IATA
 * (BSP) account. The weeks run seven days from Wednesday 21 Oct 2026, the
 * day the user set this up, so each one is Wednesday to Tuesday.
 *
 * Only what was issued counts - tickets and EMDs, at their full fare. A
 * refund does not give any of the week back, a void was never billed and an
 * On Hold row was never issued.
 *
 * The BSP report reaches our books days after the ticket is issued, so the
 * books alone would warn late. Their Airtable records an IATA ticket within
 * minutes: a row of theirs whose ticket is not in our books yet is counted
 * from their sheet, at its net cost. Once the report brings it in, our
 * figure replaces theirs.
 */
import { ticketMatchKey } from './ticketIdentity';

export interface AirlineLimit {
  airlineCode: string;
  airline: string;
  limit: number;
  warnAt: number;
  currency: string;
  /** The first day of the first week (local). */
  weekFrom: string;
}

export const EMIRATES_IATA: AirlineLimit = {
  airlineCode: '176', airline: 'Emirates', limit: 300_000, warnAt: 290_000, currency: 'AED', weekFrom: '2026-10-21',
};

export interface BookRow { ticketNo: string; source?: string; airlineCode?: string; status?: string; date?: string; amount: number; totalDoc?: number }
export interface SheetRow { serials: string[]; status: string | null; portal: string | null; airline: string | null; net_cost: number | null; issued_at: string | null }

export interface LimitUse {
  from: string;
  to: string;
  used: number;
  fromBooks: number;
  fromSheet: number;
  docs: number;
  left: number;
  level: 'OK' | 'WARN' | 'OVER';
}

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** A moment as the agency's calendar date (UTC+3). */
export const localDate = (iso: string) => ymd(new Date(iso).getTime() + 3 * 3600_000);

/** The week, Wednesday to Tuesday, that a local date falls in. */
export function limitWeek(today: string, weekFrom: string): { from: string; to: string } {
  const start = Date.parse(`${weekFrom}T00:00:00Z`);
  const n = Math.floor((Date.parse(`${today}T00:00:00Z`) - start) / (7 * DAY));
  const from = start + n * 7 * DAY;
  return { from: ymd(from), to: ymd(from + 6 * DAY) };
}

const SHEET_ISSUED = /^(issued|reissue)$/i;

export function limitUse(cfg: AirlineLimit, books: BookRow[], sheet: SheetRow[], today: string): LimitUse {
  const { from, to } = limitWeek(today, cfg.weekFrom);
  const inWeek = (d?: string | null) => !!d && d >= from && d <= to;
  const iata = books.filter(t => t.source === 'IATA BSP' && t.airlineCode === cfg.airlineCode);
  const held = new Set(iata.map(t => ticketMatchKey(t.ticketNo)).filter(Boolean));
  let fromBooks = 0, fromSheet = 0, docs = 0;
  for (const t of iata) {
    if ((t.status !== 'ISSUE' && t.status !== 'EMDS') || t.amount <= 0 || !inWeek(t.date)) continue;
    fromBooks += t.totalDoc || t.amount; docs++;
  }
  for (const r of sheet) {
    if (!SHEET_ISSUED.test(r.status ?? '') || !/IATA/i.test(r.portal ?? '') || (r.airline ?? '').trim().toLowerCase() !== cfg.airline.toLowerCase()) continue;
    if (!r.issued_at || !inWeek(localDate(r.issued_at)) || !r.net_cost || r.net_cost <= 0) continue;
    if (!r.serials.length || r.serials.some(s => held.has(ticketMatchKey(s)))) continue;
    fromSheet += r.net_cost; docs++;
  }
  const used = Math.round((fromBooks + fromSheet) * 100) / 100;
  return { from, to, used, fromBooks, fromSheet, docs, left: Math.round((cfg.limit - used) * 100) / 100,
    level: used >= cfg.limit ? 'OVER' : used >= cfg.warnAt ? 'WARN' : 'OK' };
}
