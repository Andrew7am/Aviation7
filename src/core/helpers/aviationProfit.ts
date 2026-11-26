import type { Ticket } from '../../types';
import { ticketMatchKey, isBookingRef, BOOKING_DAYS_APART } from './ticketIdentity';
import { teamSerials } from '../parsers/teamSheet';
import { pnrVendorOfRow, pnrVendorOfTicket } from '../integrations/airtableRequests';
import { awaitsSupplier } from './supplierProof';

/**
 * What the aviation team made on a ticket: the cost they quoted operations,
 * less what the supplier charged us.
 *
 * From 9 Nov 2026 their Airtable "Net Cost" is no longer the real cost but
 * the one they give operations - the ticket bought at 1,000 is quoted at
 * 1,100, and the 100 is theirs. The real cost is the supplier's, and only
 * this system holds it. Before that date their Net Cost was the real cost,
 * near enough, so nothing earlier is counted.
 *
 * A ticket counts once the supplier has vouched for our figure. A row added
 * from their sheet or by hand still carries their quoted cost, which would
 * read as no profit at all, so it waits. Refunds are left out for now: a
 * fare the client agreed was non-refundable is a question for later.
 */
import { PROFIT_FROM } from '../config/profit';
export { PROFIT_FROM };

export interface ProfitSheetRow {
  record_id: string; serials: string[]; pnr: string; status: string; req_num: string;
  net_cost: number | null; currency: string; issued_at: string | null; team_member: string;
  portal?: string; airline?: string; ticket_cell?: string; emd?: string;
  /** Their Refund Amount: what operations was given back. */
  refund_amount?: number | null;
}

export type ProfitState = 'COUNTED' | 'AWAITING_SUPPLIER' | 'NOT_IN_BOOKS' | 'TWO_CURRENCIES';

/** One of our tickets behind a line, as our books have it: its own currency
 *  and request, so a line can be laid beside the file's ticket list. */
export interface OurPart { id: string; ticketNo: string; req: string; currency: string; amount: number; commission: number;
  /** A purchase in dollars or euros, kept in our books in dirhams: what it was before. */
  origCurrency?: string; origAmount?: number }
export const ourPart = (t: Ticket, fallback = ''): OurPart => ({ id: t.id, ticketNo: t.ticketNo || t.pnr || '', req: t.reqNum || '',
  currency: (t.currency || fallback).toUpperCase(), amount: Number(t.amount) || 0, commission: Number(t.commission) || 0,
  ...(t.originalCurrency && t.originalAmount ? { origCurrency: t.originalCurrency.toUpperCase(), origAmount: Number(t.originalAmount) } : {}) });

export interface ProfitLine {
  key: string; req: string; member: string; issued: string; cell: string; pnr: string;
  docs: string[]; quoted: number; currency: string;
  /** What the supplier charged us, in the quoted currency. */
  cost: number | null;
  profit: number | null;
  /** The supplier's commission on our tickets, in the quoted currency: the
   *  fare was cost + commission. Null where nothing was compared. */
  commission?: number | null;
  state: ProfitState;
  /** Our cost was in another currency and converted at the peg. */
  converted: boolean;
  /** Their one row priced each of its tickets, not the whole cell. */
  perTicket?: boolean;
  /** Our tickets behind it, where they were found. */
  ours?: OurPart[];
  /** TWO_CURRENCIES because their own rows are in two currencies. */
  mixedSheet?: boolean;
}

/** SAR, AED and USD are pegged: 1 USD = 3.75 SAR = 3.6725 AED. */
const TO_SAR: Record<string, number> = { SAR: 1, AED: 3.75 / 3.6725, USD: 3.75 };
export const toCurrency = (v: number, from: string, to: string): number | null => {
  const f = TO_SAR[(from || '').toUpperCase()], t = TO_SAR[(to || '').toUpperCase()];
  return f && t ? (v * f) / t : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Their issue time, as the Riyadh calendar day it fell on. */
export const riyadhDay = (iso: string | null | undefined) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '' : new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
};
const nearDay = (a: string, b: string) => {
  const x = Date.parse(a), y = Date.parse(String(b || '').slice(0, 10));
  return !Number.isNaN(x) && !Number.isNaN(y) && Math.abs(x - y) / 86_400_000 <= BOOKING_DAYS_APART;
};

export function aviationProfit(rows: ProfitSheetRow[], ledger: Ticket[], from = PROFIT_FROM, to = '',
  /** Documents the supplier voided: never billed, so no cost and no profit. */
  voided: Iterable<string> = [],
  /** Sales later refunded count too: their row turned "Cancelled/Refunded",
   *  its Net Cost still what operations was charged (KSAML1145, 26 Nov 2026).
   *  For a file's money, where the refund is taken off after it. */
  opts: { refunded?: boolean } = {}): ProfitLine[] {
  const gone = new Set([...voided].map(ticketMatchKey).filter(Boolean));
  const docsOf = (r: ProfitSheetRow) => [...new Set([...r.serials, ...teamSerials(r.emd || '').map(x => x.serial)]
    .map(ticketMatchKey).filter(k => k && !isBookingRef(k)))];
  const isSale = (r: ProfitSheetRow) => /^(issued|reissue)$/i.test((r.status || '').trim());
  /* A refund on a row of its own beside the Issued row is only the refund;
     the row itself turned to a refund is the sale as well. */
  const onSaleRows = new Set(rows.filter(isSale).flatMap(docsOf));
  const refundedSale = (r: ProfitSheetRow) => !!opts.refunded && /cancel|refund/i.test(r.status || '')
    && docsOf(r).length > 0 && !docsOf(r).some(d => onSaleRows.has(d));
  const priced = rows.filter(r => (isSale(r) || refundedSale(r)) && (r.net_cost ?? 0) > 0)
    .filter(r => { const d = riyadhDay(r.issued_at); return d >= from && (!to || d <= to); });

  /* One ticket can sit on two of their rows - an Issued row at the fare and a
     Reissue row at the change fee - so rows naming the same document are one
     booking, and their costs are added before ours is taken off. */
  const parent = priced.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  /* A flydubai or flyadeal booking for two is often two rows of theirs and one
     sale of ours (Y4TG8S: 1,960 + 1,960 against 3,920): rows of one vendor's
     booking, issued the same day, are one booking too. */
  const bookingKey = (r: ProfitSheetRow) => {
    const v = pnrVendorOfRow(r);
    return v && !docsOf(r).length ? `${v}:${(r.pnr || '').toUpperCase().trim()}:${riyadhDay(r.issued_at)}` : '';
  };
  priced.forEach((r, i) => {
    const keys = [...docsOf(r), bookingKey(r)].filter(Boolean);
    for (const d of keys) { const o = owner.get(d); if (o === undefined) owner.set(d, i); else parent[find(i)] = find(o); }
  });
  const groups = new Map<number, ProfitSheetRow[]>();
  priced.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), r]); });

  const bySerial = new Map<string, Ticket[]>();
  for (const t of ledger) {
    if ((t.status || '').toUpperCase() === 'FUND' || (t.amount || 0) <= 0) continue;
    const k = ticketMatchKey(t.ticketNo || '');
    if (k) bySerial.set(k, [...(bySerial.get(k) ?? []), t]);
  }

  const out: ProfitLine[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    const currencies = [...new Set(g.map(r => (r.currency || '').toUpperCase()))];
    const currency = currencies[0] || '';
    const docs = [...new Set(g.flatMap(docsOf))].filter(d => !gone.has(d));
    if (!docs.length && g.some(r => docsOf(r).length)) continue;   // every document of it voided
    let ours = docs.flatMap(d => bySerial.get(d) ?? []);
    /* flydubai and flyadeal have no ticket number: their booking, on a sale
       of that vendor within a week of the row. */
    if (!docs.length) {
      const v = pnrVendorOfRow(first);
      const pnrs = (first.pnr || '').toUpperCase().split(/[|,/\s]+/).filter(Boolean);
      if (v) ours = [...bySerial.values()].flat().filter(t => pnrVendorOfTicket(t.source) === v
        && pnrs.some(p => (t.pnr || t.ticketNo || '').toUpperCase() === p) && nearDay(riyadhDay(first.issued_at), t.date || ''));
    }
    ours = [...new Map(ours.map(t => [t.id, t])).values()];
    let quoted = r2(g.reduce((n, r) => n + (r.net_cost ?? 0), 0));
    const base = {
      key: g.map(r => r.record_id).join('+'), req: [...new Set(g.map(r => r.req_num).filter(Boolean))].join(', '),
      member: (first.team_member || '').trim() || '(no name)', issued: riyadhDay(first.issued_at),
      cell: g.map(r => (r.ticket_cell || '').replace(/\s+/g, ' ').trim()).join(' + ').slice(0, 80), pnr: first.pnr || '',
      docs: docs.length ? docs : ours.map(t => t.ticketNo), quoted, currency,
    };
    const parts = ours.map(t => ourPart(t, currency));
    if (currencies.length > 1) { out.push({ ...base, cost: null, profit: null, state: 'TWO_CURRENCIES', converted: false, mixedSheet: true }); continue; }
    if (!ours.length) { out.push({ ...base, cost: null, profit: null, state: 'NOT_IN_BOOKS', converted: false }); continue; }
    if (ours.some(awaitsSupplier)) { out.push({ ...base, cost: null, profit: null, state: 'AWAITING_SUPPLIER', converted: false, ours: parts }); continue; }
    let converted = false, cost = 0, comm = 0, ok = true;
    /** One of ours in the quoted currency; null where it cannot be converted. */
    const inQuoted = (t: Ticket, v: number) => {
      const cur = (t.currency || currency).toUpperCase();
      return cur === currency ? v : toCurrency(v, cur, currency);
    };
    for (const t of ours) {
      const v = inQuoted(t, t.amount || 0);
      if (v === null) { ok = false; break; }
      cost += v; comm += inQuoted(t, t.commission || 0) ?? 0;
      if ((t.currency || currency).toUpperCase() !== currency) converted = true;
    }
    if (!ok) { out.push({ ...base, cost: null, profit: null, state: 'TWO_CURRENCIES', converted: false, ours: parts }); continue; }
    /* One row, several tickets: its cost is sometimes the whole cell and
       sometimes each ticket's (UAEVP771: 860.00 on a row of four tickets at
       860.00 each). The reading nearer what the supplier charged is taken. */
    let perTicket = false;
    if (g.length === 1 && docs.length > 1) {
      const each = r2(quoted * docs.length);
      if (Math.abs(each - cost) < Math.abs(quoted - cost)) { quoted = each; perTicket = true; }
    } else if (g.length > 1) {
      /* The same, row by row, when the booking has other rows too: UAEVP771's
         17,920.00 on a row of three tickets is each ticket's, and the EMD rows
         added after it for each passenger joined the three into one booking. */
      let q = 0;
      for (const r of g) {
        const own = [...new Set(r.serials.map(ticketMatchKey).filter(k => k && !isBookingRef(k) && !gone.has(k)))];
        const v = r.net_cost ?? 0;
        if (own.length > 1) {
          const mine = ours.filter(t => own.includes(ticketMatchKey(t.ticketNo || '')));
          const c = mine.reduce((n, t) => n + (inQuoted(t, t.amount || 0) ?? 0), 0);
          if (mine.length && Math.abs(v * own.length - c) < Math.abs(v - c)) { q += v * own.length; perTicket = true; continue; }
        }
        q += v;
      }
      quoted = r2(q);
    }
    out.push({ ...base, quoted, cost: r2(cost), commission: r2(comm), profit: r2(quoted - cost), state: 'COUNTED', converted, perTicket, ours: parts });
  }
  return out.sort((a, b) => b.issued.localeCompare(a.issued) || a.req.localeCompare(b.req));
}

export interface ProfitTotal { key: string; tickets: number; profit: Record<string, number>; inSar: number; losses: number }

/** Counted lines added up by member, request or month, per currency and in riyals. */
export function profitBy(lines: ProfitLine[], keyOf: (l: ProfitLine) => string): ProfitTotal[] {
  const m = new Map<string, ProfitTotal>();
  for (const l of lines) {
    if (l.state !== 'COUNTED' || l.profit === null) continue;
    const k = keyOf(l);
    const e = m.get(k) ?? { key: k, tickets: 0, profit: {}, inSar: 0, losses: 0 };
    e.tickets += Math.max(1, l.docs.length);
    e.profit[l.currency] = r2((e.profit[l.currency] ?? 0) + l.profit);
    e.inSar = r2(e.inSar + (toCurrency(l.profit, l.currency, 'SAR') ?? 0));
    if (l.profit < -0.005) e.losses++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.inSar - a.inSar);
}
