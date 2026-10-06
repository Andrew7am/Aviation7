/**
 * Keep the team's Airtable "Aviation Tickets" here, live.
 *
 * Every two minutes: ask Airtable for the records modified since the last
 * run, record what changed field by field, and turn those changes into
 * notices for a person. Once an hour, read the whole table instead, which
 * is how a record they deleted is noticed. Online purchases on their sheet
 * that our books do not hold go to To Review, as the Team Sheet Check would
 * send them.
 *
 * Reads Airtable only. Writes our copy of it, the change log, the notices
 * and the review queue - never a ticket. Runs with the service role, on the
 * server: the token and the key never reach a browser.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AIRTABLE_BASE, AIRTABLE_TICKETS_TABLE, AIRTABLE_NAME_TABLES, normalize, diffRecord, rowsToCsv,
  type AirtableRecord, type AirtableTicketRow, type FieldChange, type NameMap,
} from '../core/integrations/airtable';
import { noticesFor, ledgerIndex, docKey, type LedgerLite, type Notice } from '../core/integrations/airtableNotices';
import { parseTeamSheet } from '../core/parsers/teamSheet';
import { compareTeamSheet } from '../core/helpers/teamSheetCompare';
import { planSheetAdd } from '../core/helpers/addFromSheet';
import { pendingRow } from '../core/helpers/pendingRow';
import type { Ticket } from '../types';

const STATE_ID = 'aviation_tickets';
const FULL_EVERY_MS = 60 * 60 * 1000;

export interface SyncResult {
  mode: 'full' | 'incremental';
  fetched: number; changedRecords: number; fieldChanges: number; added: number; deleted: number;
  notices: number; onlineQueued: number; ms: number;
}

async function airtable(token: string, table: string, params: Record<string, string | string[]>): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = [];
  let offset = '';
  do {
    const u = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${table}`);
    u.searchParams.set('pageSize', '100');
    for (const [k, v] of Object.entries(params))
      for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, x);
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    // Airtable allows five requests a second per base; a 429 asks for 30 s.
    if (r.status === 429) { await new Promise(res => setTimeout(res, 1500)); continue; }
    const j = await r.json() as { records?: AirtableRecord[]; offset?: string; error?: unknown };
    if (!r.ok || !j.records) throw new Error(`Airtable ${r.status}: ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
    out.push(...j.records);
    offset = j.offset || '';
  } while (offset);
  return out;
}

async function fetchNames(token: string): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const [table, field] of Object.entries(AIRTABLE_NAME_TABLES))
    for (const r of await airtable(token, table, { 'fields[]': field }))
      names[r.id] = String(r.fields[field] ?? '');
  return names;
}

async function selectAll<T>(db: SupabaseClient, table: string, cols: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const usesUnknownLink = (r: AirtableRecord, names: Record<string, string>) =>
  Object.values(r.fields).some(v => Array.isArray(v) && v.some(x => typeof x === 'string' && /^rec[A-Za-z0-9]{14}$/.test(x) && !(x in names)));

export async function syncAirtable(env: {
  airtableToken: string; supabaseUrl: string; serviceKey: string; forceFull?: boolean;
  /** Work everything out, write nothing - for looking before the first run. */
  dryRun?: boolean;
}): Promise<SyncResult & { preview?: { notices: Notice[]; online: string[]; changes?: unknown } }> {
  const t0 = Date.now();
  const db = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  const { data: st } = await db.from('airtable_sync_state').select('*').eq('id', STATE_ID).maybeSingle();
  const now = new Date();
  const full = env.forceFull || !st?.cursor || !st?.last_full_at
    || now.getTime() - new Date(st.last_full_at).getTime() > FULL_EVERY_MS;
  const dry = !!env.dryRun;
  if (!dry) await db.from('airtable_sync_state').upsert({ id: STATE_ID, last_run_at: now.toISOString() });

  try {
    // Linked records by name. Kept between runs; read again on the hourly
    // full run, or the moment a record links to one we have not seen.
    let names: Record<string, string> = (st?.names as Record<string, string>) ?? {};
    if (full || !Object.keys(names).length) names = await fetchNames(env.airtableToken);

    // A little overlap with the last run: a record saved in the same second
    // as the cursor is read twice rather than missed, and reads as unchanged.
    const since = st?.cursor ? new Date(new Date(st.cursor).getTime() - 5000).toISOString() : '';
    const recs = await airtable(env.airtableToken, AIRTABLE_TICKETS_TABLE,
      full ? {} : { filterByFormula: `IS_AFTER(LAST_MODIFIED_TIME(), DATETIME_PARSE('${since}'))` });
    if (!full && recs.some(r => usesUnknownLink(r, names))) names = await fetchNames(env.airtableToken);
    const nameMap: NameMap = new Map(Object.entries(names));

    const rows = recs.map(r => normalize(r, nameMap));
    const ids = rows.map(r => r.record_id);
    const before = new Map<string, AirtableTicketRow & { deleted?: boolean }>();
    if (full) for (const r of await selectAll<AirtableTicketRow & { deleted: boolean }>(db, 'airtable_tickets', '*')) before.set(r.record_id, r);
    else for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('airtable_tickets').select('*').in('record_id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of data ?? []) before.set(r.record_id, r as AirtableTicketRow);
    }

    // What moved, field by field. The very first run has nothing to compare
    // with and records none - a change is a difference from what we held.
    const changes = new Map<string, FieldChange[]>();
    const log: Record<string, unknown>[] = [];
    let added = 0;
    for (const r of rows) {
      const old = before.get(r.record_id);
      if (!old) { added++; if (st?.cursor) log.push({ record_id: r.record_id, ticket_cell: r.ticket_cell, field: 'record', old_value: null, new_value: 'added', changed_at: r.created_at ?? now.toISOString() }); continue; }
      const d = diffRecord(old, r);
      if (!d.length) continue;
      changes.set(r.record_id, d);
      for (const c of d) log.push({ record_id: r.record_id, ticket_cell: r.ticket_cell, field: c.label, old_value: c.old, new_value: c.new, changed_at: r.last_modified ?? now.toISOString() });
    }
    const changedRows = rows.filter(r => changes.has(r.record_id) || !before.has(r.record_id));

    // Upsert what was read; on a full run, whatever is gone from their table is marked so.
    const stamp = now.toISOString();
    const upserts = (full ? rows : changedRows).map(r => ({ ...r, deleted: false, synced_at: stamp }));
    for (let i = 0; i < upserts.length && !dry; i += 500) {
      const { error } = await db.from('airtable_tickets').upsert(upserts.slice(i, i + 500));
      if (error) throw new Error(`airtable_tickets: ${error.message}`);
    }
    let deleted = 0;
    if (full && st?.cursor) {
      const seen = new Set(ids);
      const gone = [...before.values()].filter(r => !seen.has(r.record_id) && !r.deleted);
      deleted = gone.length;
      for (const g of gone) {
        if (!dry) await db.from('airtable_tickets').update({ deleted: true, synced_at: stamp }).eq('record_id', g.record_id);
        log.push({ record_id: g.record_id, ticket_cell: g.ticket_cell, field: 'record', old_value: 'present', new_value: 'deleted', changed_at: stamp });
      }
    }
    for (let i = 0; i < log.length && !dry; i += 500) {
      const { error } = await db.from('airtable_changes').insert(log.slice(i, i + 500));
      if (error) throw new Error(`airtable_changes: ${error.message}`);
    }

    // What it means for our books - only worth the ledger read when something moved.
    let notices: Notice[] = [], onlineQueued = 0;
    if (changedRows.length || full) {
      const ledger = await selectAll<Record<string, any>>(db, 'tickets',
        'id, ticket_no, pnr, req_num, passenger_name, cabin_class, source, amount, status, currency, date, commission, total_doc, airline_code, transaction_type, closed, related_ticket, original_currency, original_amount, fx_rate, report_name, confirmed_by, user_id');
      const lite: LedgerLite[] = ledger.map(t => ({ id: t.id, ticketNo: t.ticket_no, pnr: t.pnr, reqNum: t.req_num ?? '',
        passengerName: t.passenger_name ?? '', cabinClass: t.cabin_class ?? '', source: t.source, amount: Number(t.amount ?? 0),
        status: t.status, currency: t.currency }));
      // Names and cabins are offered from any row read; requests, refunds,
      // voids and prices only from what changed.
      notices = noticesFor(full ? rows : changedRows, changes, ledgerIndex(lite));

      // Bought online and in nobody's books: to To Review, like the check would.
      const all = full ? rows : (await selectAll<AirtableTicketRow>(db, 'airtable_tickets', 'record_id, sheet_row, created_at', q => q.eq('deleted', false)));
      all.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
      const csv = rowsToCsv(all.map(r => r.sheet_row), (d: any) => {
        // A tiny CSV writer: their cells hold quotes, commas and newlines.
        const q = (v: string) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        return [d.fields.map(q).join(','), ...d.data.map((r: string[]) => r.map(q).join(','))].join('\n');
      });
      const sheet = parseTeamSheet(csv).rows;
      const tickets = ledger.map(t => ({ id: t.id, ticketNo: t.ticket_no, source: t.source, date: t.date ?? '', amount: Number(t.amount ?? 0),
        commission: Number(t.commission ?? 0), totalDoc: Number(t.total_doc ?? 0), reqNum: t.req_num ?? '', pnr: t.pnr ?? '',
        airlineCode: t.airline_code ?? '', status: t.status ?? '', transactionType: t.transaction_type ?? '', currency: t.currency,
        closed: !!t.closed, relatedTicket: t.related_ticket, originalCurrency: t.original_currency, originalAmount: t.original_amount == null ? undefined : Number(t.original_amount),
        reportName: t.report_name ?? '', confirmedBy: t.confirmed_by, passengerName: t.passenger_name ?? '' })) as unknown as Ticket[];
      const voids = await selectAll<{ ticket_no: string }>(db, 'void_tickets', 'ticket_no');
      const chains = await selectAll<{ ticket_no: string; replaced_ticket: string }>(db, 'ticket_exchanges', 'ticket_no, replaced_ticket');
      const voided = new Set(voids.map(v => docKey(v.ticket_no)));
      const report = compareTeamSheet(sheet, tickets, [], {}, {
        voided: voids.map(v => v.ticket_no), chains: chains.map(c => ({ ticketNo: c.ticket_no, replacedTicket: c.replaced_ticket })) });
      const online = report.findings.filter(f => f.verdict === 'NOT_IN_LEDGER' && f.issuedFrom === 'Airline Website'
        && f.sheet?.status === 'ISSUED' && !voided.has(docKey(f.serial || f.pnr)));
      if (online.length) {
        const owner = ledger.find(t => t.user_id)?.user_id ?? '';
        const plan = planSheetAdd(online, { newId: () => crypto.randomUUID(), userId: owner, tickets });
        const proposals = [...plan.ready, ...plan.waiting.map(w => w.proposal)];
        const keys = proposals.map(p => p.dedupe);
        const known = new Set<string>();
        for (let i = 0; i < keys.length; i += 200) {
          const { data } = await db.from('pending_tickets').select('dedupe').in('dedupe', keys.slice(i, i + 200));
          for (const r of data ?? []) known.add(r.dedupe);
        }
        const fresh = proposals.filter(p => !known.has(p.dedupe));
        if (fresh.length && !dry) {
          const { error } = await db.from('pending_tickets').insert(fresh.map(p => pendingRow({ ...p, origin: 'AIRTABLE' } as any, owner)));
          if (error) throw new Error(`pending_tickets: ${error.message}`);
        }
        onlineQueued = fresh.length;
        for (const p of fresh) notices.push({
          kind: 'ONLINE_TICKET', dedupe_key: `ONLINE|${p.dedupe}`, record_id: '', ticket_no: p.ticketNo || p.pnr || '',
          ticket_ids: [], req_num: p.reqNum,
          title: `Bought online: ${p.ticketNo || p.pnr} · ${p.amount ? `${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${p.currency}` : 'no price on their sheet'} · ${p.reqNum || 'no request'}`,
          detail: `On their sheet from ${p.theirPortal || 'an airline website'} and not in our books. Waiting in To Review - add it or reject it.`,
          payload: { dedupe: p.dedupe } });
      }
    }
    const preview = dry ? { notices, online: notices.filter(n => n.kind === 'ONLINE_TICKET').map(n => n.title), changes: [...changes].slice(0, 40) } : undefined;
    for (let i = 0; i < notices.length && !dry; i += 500) {
      const { error } = await db.from('airtable_notifications').upsert(notices.slice(i, i + 500), { onConflict: 'dedupe_key', ignoreDuplicates: true });
      if (error) throw new Error(`airtable_notifications: ${error.message}`);
    }

    const newest = [st?.cursor, ...rows.map(r => r.last_modified), ...rows.map(r => r.created_at)]
      .filter(Boolean).map(x => new Date(x as string).getTime()).reduce((a, b) => Math.max(a, b), 0);
    const { count } = await db.from('airtable_tickets').select('record_id', { count: 'exact', head: true }).eq('deleted', false);
    if (!dry) await db.from('airtable_sync_state').upsert({
      id: STATE_ID, cursor: newest ? new Date(newest).toISOString() : now.toISOString(),
      last_full_at: full ? stamp : st?.last_full_at, last_run_at: stamp, last_ok_at: new Date().toISOString(),
      last_error: null, record_count: count ?? null, last_changed: changedRows.length, names,
    });
    return { mode: full ? 'full' : 'incremental', fetched: recs.length, changedRecords: changes.size, fieldChanges: log.length,
      added, deleted, notices: notices.length, onlineQueued, ms: Date.now() - t0, preview };
  } catch (e) {
    if (!dry) await db.from('airtable_sync_state').upsert({ id: STATE_ID, last_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
