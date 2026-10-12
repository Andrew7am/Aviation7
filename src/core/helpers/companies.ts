import type { Ticket } from '../../types';
import { reqParts } from './teamSheetCompare';
import { unconfirmed } from './supplierProof';
import { ticketCurrency } from './sourceCurrency';

/**
 * Whose ticket it is - the company it was issued for.
 *
 * Their Airtable names it on every MICE row: Nestle, Allergen, Abbott,
 * Alfasigma, STADA. A request belongs to one company (no request on their
 * sheet names two), so a ticket of ours their sheet does not list - a
 * reissue, an EMD, a refund application - is placed by its request. VIP and
 * Corporate rows name no company: the traveller is the client, and they are
 * grouped under their department.
 */
export interface CompanyRow {
  serials: string[];
  req_num: string;
  account: string;
  department: string;
  status: string;
  net_cost: number | null;
  currency: string;
  issued_at: string | null;
  pnr: string;
  ticket_cell: string;
  client_name: string;
}

export const UNASSIGNED = 'No company';

/** "Nestle", or "VIP (individuals)" for a row that names no company. */
export function companyLabel(r: Pick<CompanyRow, 'account' | 'department'>): string {
  const a = (r.account || '').trim();
  if (a) return a;
  const d = (r.department || '').trim();
  return d ? `${d} (individuals)` : UNASSIGNED;
}

const serial = (s: string) => {
  const d = (s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : (s || '').replace(/\s+/g, '').toUpperCase();
};

export interface CompanyIndex {
  bySerial: Map<string, string>; byReq: Map<string, string>;
  /** Requests a person placed under a company by hand - they win. */
  assigned: Map<string, string>;
}

/** A request placed under a company by hand: KSACO363 is Sela's, and their
 *  Airtable does not carry it at all. */
export interface CompanyAssignment { req_key: string; company: string; set_by?: string | null; set_at?: string }

export function companyIndex(rows: CompanyRow[], assignments: CompanyAssignment[] = []): CompanyIndex {
  const assigned = new Map<string, string>();
  for (const a of assignments) for (const k of reqParts(a.req_key)) if (a.company.trim()) assigned.set(k, a.company.trim());
  const bySerial = new Map<string, string>();
  const reqVotes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const label = companyLabel(r);
    if (label === UNASSIGNED) continue;
    for (const s of r.serials) if (s) bySerial.set(serial(s), label);
    for (const k of reqParts(r.req_num || '')) {
      const m = reqVotes.get(k) ?? new Map<string, number>();
      m.set(label, (m.get(label) ?? 0) + 1);
      reqVotes.set(k, m);
    }
  }
  // A request is one company's; the most rows say which, should two ever disagree.
  const byReq = new Map<string, string>();
  for (const [k, m] of reqVotes) byReq.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return { bySerial, byReq, assigned };
}

/** The company a ticket of ours was issued for, or '' when nothing says. */
export function companyOf(t: Pick<Ticket, 'ticketNo' | 'relatedTicket' | 'reqNum' | 'pnr'>, idx: CompanyIndex): string {
  return reqParts(t.reqNum || '').map(k => idx.assigned.get(k)).find(Boolean)
    || idx.bySerial.get(serial(t.ticketNo))
    || (t.relatedTicket ? idx.bySerial.get(serial(t.relatedTicket)) : undefined)
    || reqParts(t.reqNum || '').map(k => idx.byReq.get(k)).find(Boolean)
    || (t.pnr ? idx.bySerial.get(serial(t.pnr)) : undefined)
    || '';
}

export interface Money { issued: number; refunds: number; net: number }

export interface CompanySummary {
  company: string;
  requests: number;
  /** Documents in our books: sales, and refunds against them. */
  tickets: number;
  refunds: number;
  /** By currency - dirhams are never added to riyals. */
  money: Record<string, Money>;
  /** In our books from the supplier's own report or invoice. */
  billed: number;
  /** In our books only from their sheet or by hand - no supplier has billed it yet. */
  recordedOnly: number;
  /** On their sheet, issued, and in nobody's books yet. */
  notInBooks: number;
  notInBooksRows: CompanyRow[];
  closed: number;
  open: number;
  openMoney: Record<string, number>;
  lastDate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Each company's work: how much, what the suppliers have billed and what
 * not, and what is still open with the client.
 *
 * "Billed" is the supplier's billing - the ticket came in on a supplier's
 * report or invoice. A ticket recorded from their sheet or by hand is in
 * our books but not yet billed; a ticket on their sheet that is in nobody's
 * books is not billed either, and is listed so it can be found.
 */
export function companySummaries(tickets: Ticket[], rows: CompanyRow[], idx = companyIndex(rows)): CompanySummary[] {
  const by = new Map<string, CompanySummary>();
  const get = (c: string) => {
    let s = by.get(c);
    if (!s) {
      s = { company: c, requests: 0, tickets: 0, refunds: 0, money: {}, billed: 0, recordedOnly: 0, notInBooks: 0,
        notInBooksRows: [], closed: 0, open: 0, openMoney: {}, lastDate: '' };
      by.set(c, s);
    }
    return s;
  };
  const reqs = new Map<string, Set<string>>();
  const held = new Set<string>();
  for (const t of tickets) {
    if ((t.status || '').toUpperCase() === 'FUND') continue;
    const c = companyOf(t, idx);
    if (!c) continue;
    held.add(serial(t.ticketNo));
    const s = get(c);
    const a = t.amount || 0;
    const cur = ticketCurrency(t);
    const m = s.money[cur] ?? (s.money[cur] = { issued: 0, refunds: 0, net: 0 });
    if (a < 0) { s.refunds++; m.refunds = r2(m.refunds + a); } else { s.tickets++; m.issued = r2(m.issued + a); }
    m.net = r2(m.net + a);
    if (unconfirmed(t)) s.recordedOnly++; else s.billed++;
    if (t.closed) s.closed++;
    else { s.open++; s.openMoney[cur] = r2((s.openMoney[cur] ?? 0) + a); }
    if ((t.date || '') > s.lastDate) s.lastDate = t.date || '';
    for (const k of reqParts(t.reqNum || '')) {
      const set = reqs.get(c) ?? new Set<string>();
      set.add(k); reqs.set(c, set);
    }
  }
  for (const r of rows) {
    const c = reqParts(r.req_num || '').map(k => idx.assigned.get(k)).find(Boolean) || companyLabel(r);
    if (c === UNASSIGNED) continue;
    if (!/issue|reissue|refund/i.test(r.status || '') || /hold|void/i.test(r.status || '')) continue;
    const mine = r.serials.filter(Boolean);
    if (!mine.length || mine.some(x => held.has(serial(x)))) continue;
    const s = get(c);
    s.notInBooks++;
    s.notInBooksRows.push(r);
    for (const k of reqParts(r.req_num || '')) {
      const set = reqs.get(c) ?? new Set<string>();
      set.add(k); reqs.set(c, set);
    }
  }
  for (const [c, set] of reqs) get(c).requests = set.size;
  return [...by.values()].sort((a, b) => (b.tickets + b.notInBooks) - (a.tickets + a.notInBooks) || a.company.localeCompare(b.company));
}
