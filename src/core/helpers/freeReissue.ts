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

  /* Where the report names no ticket it replaces - RTS prints "reissue"
     and 0.00 and nothing else - the booking says it: the ticket on the same
     PNR for the same passenger. Only when every such ticket we hold is under
     one request; two requests on one PNR cannot say which this belongs to. */
  const key = (t: { pnr?: string; passengerName?: string }) =>
    `${(t.pnr || '').replace(/\s+/g, '').toUpperCase()}|${(t.passengerName || '').replace(/\s+/g, ' ').trim().toUpperCase()}`;
  const byBooking = new Map<string, Ticket[]>();
  for (const t of [...known, ...rows]) {
    if (!(t.pnr || '').trim() || !(t.reqNum || '').trim()) continue;
    for (const k of [key(t), key({ pnr: t.pnr })]) {
      if (!byBooking.has(k)) byBooking.set(k, []);
      byBooking.get(k)!.push(t);
    }
  }
  const byPnr = (r: Ticket): Ticket | undefined => {
    if (!(r.pnr || '').trim()) return undefined;
    const same = byBooking.get(key(r)) ?? (r.passengerName ? undefined : byBooking.get(key({ pnr: r.pnr })));
    if (!same?.length) return undefined;
    const reqs = new Set(same.map(t => t.reqNum.trim().toUpperCase()));
    if (reqs.size !== 1) return undefined;
    return same.find(t => (t.amount || 0) > 0) ?? same[0];
  };

  const origin = (serial: string, r: Ticket): Ticket | undefined => {
    const seen = new Set([serial]);
    let cur = back.get(serial);
    while (cur && !seen.has(cur)) {
      const t = bySerial.get(cur);
      if (t && (t.reqNum || '').trim()) return t;
      seen.add(cur);
      cur = back.get(cur);
    }
    return byPnr(r);
  };

  return rows.map(r => {
    if ((r.transactionType || '').toUpperCase() !== 'REISSUE' || (r.amount || 0) !== 0) return r;
    const o = origin(ticketMatchKey(r.ticketNo || ''), r);
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
