/**
 * Every ADM in the books, and what each one is really.
 *
 * "ADM" in the ledger covers four different things, and the screen that
 * lists them has to keep them apart:
 *
 *   - an airline's debit memo: "065 ADMA 6206503067 ... 170.00", an airline
 *     charging us over a ticket it names on the +RTDN line;
 *   - an airline's credit memo, the same in reverse: ACMA 0820147238,
 *     30,699.00 back on 5512129182;
 *   - BSP's own fee (SPDR, airline 953): 22.08, 7.36, 14.72 a period, filed
 *     as "ADM" because BSP prints it under DEBIT MEMOS - and already labelled
 *     "NOT AN ADM" by hand on three of them;
 *   - a supplier's ADM passed on through its statement: NSA's, which arrive
 *     as rows filed under the request "ADM".
 *
 * A memo is money - it stays in the ledger, the balances and the requests.
 * This only gathers it, says which kind it is, and reads the ticket it is
 * about out of the books.
 */
import type { Ticket } from '../../types';
import { ticketMatchKey } from './ticketIdentity';

export type AdmKind = 'ADM' | 'ACM' | 'BSP_FEE' | 'SUPPLIER_ADM';

export const ADM_KIND_LABEL: Record<AdmKind, string> = {
  ADM: 'Airline ADM',
  ACM: 'Airline ACM (credit)',
  BSP_FEE: 'BSP fee - not an ADM',
  SUPPLIER_ADM: 'Supplier ADM',
};

export interface AdmRow {
  kind: AdmKind;
  ticket: Ticket;
  /** The ticket it is about, as the memo names it. */
  onTicket: string;
  /** That ticket's rows in our books - its sale, its refund. */
  onTicketRows: Ticket[];
  /** Why somebody should look: named ticket missing, or none named. */
  flag: string;
}

const upper = (s?: string | null) => String(s || '').toUpperCase();
const isFeeLabel = (req: string) => /NOT\s*AN\s*ADM/.test(upper(req));

/** Which kind of memo a ledger row is, or null when it is not one. */
export function admKind(t: Ticket): AdmKind | null {
  const status = upper(t.status);
  const type = upper(t.transactionType);
  const req = upper(t.reqNum).replace(/\s+/g, '');
  const memo = status === 'ADM' || status === 'ACM' || /^(ADM|ADMA|ADNT|ACMA|ACNT|SPDR|SPCR)$/.test(type);
  if (memo) {
    if (/^SP(DR|CR)$/.test(type) || t.airlineCode === '953' || isFeeLabel(t.reqNum || '')) return 'BSP_FEE';
    if (status === 'ACM' || /^AC(MA|NT)$/.test(type) || (t.amount || 0) < 0) return 'ACM';
    return 'ADM';
  }
  // A supplier passes its ADMs on as ordinary rows under the request "ADM".
  if (/^ADM(\b|-|$)/.test(req) && !isFeeLabel(t.reqNum || '')) return 'SUPPLIER_ADM';
  return null;
}

/** Every memo in the books, newest first, with the ticket it is about. */
export function admRegister(tickets: Ticket[]): AdmRow[] {
  const bySerial = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const k = ticketMatchKey(t.ticketNo || '');
    if (!k) continue;
    if (!bySerial.has(k)) bySerial.set(k, []);
    bySerial.get(k)!.push(t);
  }
  const out: AdmRow[] = [];
  for (const t of tickets) {
    const kind = admKind(t);
    if (!kind) continue;
    const onTicket = (t.relatedTicket || '').trim();
    const onTicketRows = onTicket ? (bySerial.get(ticketMatchKey(onTicket)) ?? []) : [];
    const flag = kind === 'BSP_FEE' ? ''
      : !onTicket ? (kind === 'SUPPLIER_ADM' ? '' : 'The memo names no ticket.')
      : !onTicketRows.length ? `Ticket ${onTicket} is not in our books.`
      : '';
    out.push({ kind, ticket: t, onTicket, onTicketRows, flag });
  }
  return out.sort((a, b) => String(b.ticket.date || '').localeCompare(String(a.ticket.date || '')));
}

export interface AdmVendor {
  /** Who billed it to us: IATA BSP, NSA... the ticket's source. */
  vendor: string;
  currency: string;
  count: number;
  amount: number;
  /** Through BSP the vendor is a clearing house; the airline is who raised
   *  the memo. One line per airline code, largest first. */
  airlines: { code: string; count: number; amount: number }[];
}

/** The memos by the vendor that billed them, and under it the airline. */
export function admByVendor(rows: AdmRow[]): AdmVendor[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const m = new Map<string, AdmVendor>();
  for (const r of rows) {
    const vendor = (r.ticket.source || '').trim() || 'No vendor';
    const currency = r.ticket.currency || '';
    const k = `${vendor}|${currency}`;
    const v = m.get(k) ?? { vendor, currency, count: 0, amount: 0, airlines: [] };
    v.count++; v.amount = r2(v.amount + (r.ticket.amount || 0));
    const code = (r.ticket.airlineCode || '').trim();
    const a = v.airlines.find(x => x.code === code) ?? (v.airlines.push({ code, count: 0, amount: 0 }), v.airlines[v.airlines.length - 1]);
    a.count++; a.amount = r2(a.amount + (r.ticket.amount || 0));
    m.set(k, v);
  }
  for (const v of m.values()) v.airlines.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return [...m.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** Totals per kind and currency. */
export function admTotals(rows: AdmRow[]): { kind: AdmKind; currency: string; count: number; amount: number }[] {
  const m = new Map<string, { kind: AdmKind; currency: string; count: number; amount: number }>();
  for (const r of rows) {
    const currency = r.ticket.currency || '';
    const k = `${r.kind}|${currency}`;
    const e = m.get(k) ?? { kind: r.kind, currency, count: 0, amount: 0 };
    e.count++; e.amount = Math.round((e.amount + (r.ticket.amount || 0)) * 100) / 100;
    m.set(k, e);
  }
  const order: AdmKind[] = ['ADM', 'ACM', 'SUPPLIER_ADM', 'BSP_FEE'];
  return [...m.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
