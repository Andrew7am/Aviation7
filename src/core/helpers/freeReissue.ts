/**
 * A reissue at no charge, filed where its original is.
 *
 * BSP prints it with no fare, no passenger and no PNR - "157 TKTT
 * 5512369347 ... 0.00, +RTDN 5512369256, EX" - because it has nothing to say
 * about them. Kept as a ledger row at 0 that would be a permanent "Missing
 * REQ" and a "Not Closed" nobody can close; which is why they were once
 * dropped altogether. Filed under the ticket it replaces - its request, its
 * PNR, its passenger, and closed when that is closed - it is simply the
 * next document in that booking.
 *
 * Walks back through a chain: 1930576249 replaces 5512760098, which replaces
 * 5512760094, which replaces 5512760083 - the one the books hold.
 */
import type { Ticket } from '../../types';
import { ticketMatchKey } from './ticketIdentity';

export interface ReissueLink { ticketNo: string; replacedTicket: string }

export function fileUnderOriginal<T extends Ticket>(rows: T[], known: Ticket[], links: ReissueLink[]): T[] {
  const back = new Map<string, string>();
  for (const l of links) {
    const a = ticketMatchKey(l.ticketNo || ''), b = ticketMatchKey(l.replacedTicket || '');
    if (a && b && a !== b) back.set(a, b);
  }
  const bySerial = new Map<string, Ticket>();
  const remember = (t: Ticket) => {
    const k = ticketMatchKey(t.ticketNo || '');
    if (!k) return;
    const prev = bySerial.get(k);
    // The sale says the most about a booking; a refund row can lack the PNR.
    if (!prev || ((t.amount || 0) > 0 && (prev.amount || 0) <= 0) || (!prev.reqNum && t.reqNum)) bySerial.set(k, t);
  };
  known.forEach(remember);
  rows.forEach(remember);

  const origin = (serial: string): Ticket | undefined => {
    const seen = new Set([serial]);
    let cur = back.get(serial);
    while (cur && !seen.has(cur)) {
      const t = bySerial.get(cur);
      if (t && (t.reqNum || '').trim()) return t;
      seen.add(cur);
      cur = back.get(cur);
    }
    return undefined;
  };

  return rows.map(r => {
    if ((r.transactionType || '').toUpperCase() !== 'REISSUE' || (r.amount || 0) !== 0) return r;
    const o = origin(ticketMatchKey(r.ticketNo || ''));
    if (!o) return r;
    return {
      ...r,
      reqNum: (r.reqNum || '').trim() || o.reqNum,
      pnr: r.pnr || o.pnr,
      passengerName: r.passengerName || o.passengerName,
      closed: r.closed || !!o.closed,
    };
  });
}
