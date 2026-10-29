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
  AIRTABLE_API_ON, AIRTABLE_BASE, AIRTABLE_TICKETS_TABLE, AIRTABLE_NAME_TABLES, normalize, diffRecord, rowsToCsv,
  type AirtableRecord, type AirtableTicketRow, type FieldChange, type NameMap,
} from '../core/integrations/airtable';
import { noticesFor, missingRefunds, refundProposals, splitRequests, ledgerIndex, docKey, type LedgerLite, type Notice } from '../core/integrations/airtableNotices';
import { parseTeamSheet } from '../core/parsers/teamSheet';
import { compareTeamSheet, reqParts } from '../core/helpers/teamSheetCompare';
import { planSheetAdd } from '../core/helpers/addFromSheet';
import { pendingRow } from '../core/helpers/pendingRow';
import { requestsFor, pnrVendorOfRow } from '../core/integrations/airtableRequests';
import { detailsFor } from '../core/integrations/airtableDetails';
import { matchExport } from '../core/integrations/airtableCsv';
import type { Ticket } from '../types';

const STATE_ID = 'aviation_tickets';
// Their request column is looked up from a linked table, and changing it does
// not move a row's Last Modified time - so only a full read sees it. Every ten
// minutes rather than every hour: KSAML482 -> KSAML2325 sat unseen for an hour.
/* Every six hours, not ten minutes. A full run reads their whole table and
   our whole ledger - about 6 MB out of the database - and at 144 a day it
   alone was some 860 MB a day: on 21 Oct 2026 the project passed Supabase's
   5 GB egress quota and was shut off. What changed in between is read
   without it (see `scope` below). */
const FULL_EVERY_MS = 6 * 60 * 60 * 1000;

export interface SyncResult {
  mode: 'full' | 'incremental' | 'csv' | 'local';
  fetched: number; changedRecords: number; fieldChanges: number; added: number; deleted: number;
  notices: number; onlineQueued: number; reqFilled: number; detailsFilled: number; ms: number;
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
  /** Fill requests, names, cabins and routes now - after an import. */
  fillNow?: boolean;
  /** Their CSV export's rows, read instead of the API (airtableCsv.ts) -
   *  for while the API cannot be used. */
  csvRows?: Record<string, string>[];
}): Promise<SyncResult & { preview?: { notices: Notice[]; online: string[]; changes?: unknown } }> {
  const t0 = Date.now();
  const db = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  // Not the linked names (48 KB): only a read of the API wants them.
  const { data: st } = await db.from('airtable_sync_state').select('cursor, last_full_at, last_ok_at').eq('id', STATE_ID).maybeSingle();
  const now = new Date();
  let full = env.forceFull || !st?.cursor || !st?.last_full_at
    || now.getTime() - new Date(st.last_full_at).getTime() > FULL_EVERY_MS;
  const dry = !!env.dryRun;
  if (!dry) await db.from('airtable_sync_state').upsert({ id: STATE_ID, last_run_at: now.toISOString() });

  try {
    // Linked records by name. Kept between runs; read again on the hourly
    // full run, or the moment a record links to one we have not seen.
    let names: Record<string, string> = {};
    const csv = !!env.csvRows;
    // Read from our copy alone: the API is off, or could not be read.
    let local = !csv && !AIRTABLE_API_ON;
    let apiDown = '';
    let recs: unknown[] = [];
    let rows: AirtableTicketRow[];
    const before = new Map<string, AirtableTicketRow & { deleted?: boolean }>();
    if (csv) {
      /* Their export instead of the API: every row matched to the record we
         hold. An export of the whole table is a full run - what it lacks is
         gone; a part of it changes only what it carries. */
      const held = await selectAll<AirtableTicketRow & { deleted: boolean }>(db, 'airtable_tickets', '*');
      for (const r of held) before.set(r.record_id, r);
      const m = matchExport(env.csvRows!, held.map(r => ({ ...r, net_cost: r.net_cost == null ? null : Number(r.net_cost),
        refund_amount: r.refund_amount == null ? null : Number(r.refund_amount) })), now.toISOString());
      rows = m.rows;
      full = m.whole;
    } else if (local) {
      rows = []; full = false;
    } else try {
      const { data: kept } = await db.from('airtable_sync_state').select('names').eq('id', STATE_ID).maybeSingle();
      names = (kept?.names as Record<string, string>) ?? {};
      if (full || !Object.keys(names).length) names = await fetchNames(env.airtableToken);

      // A little overlap with the last run: a record saved in the same second
      // as the cursor is read twice rather than missed, and reads as unchanged.
      const since = st?.cursor ? new Date(new Date(st.cursor).getTime() - 5000).toISOString() : '';
      const got = await airtable(env.airtableToken, AIRTABLE_TICKETS_TABLE,
        full ? {} : { filterByFormula: `IS_AFTER(LAST_MODIFIED_TIME(), DATETIME_PARSE('${since}'))` });
      if (!full && got.some(r => usesUnknownLink(r, names))) names = await fetchNames(env.airtableToken);
      const nameMap: NameMap = new Map(Object.entries(names));
      recs = got;
      rows = got.map(r => normalize(r, nameMap));
      const ids0 = rows.map(r => r.record_id);
      if (full) for (const r of await selectAll<AirtableTicketRow & { deleted: boolean }>(db, 'airtable_tickets', '*')) before.set(r.record_id, r);
      else for (let i = 0; i < ids0.length; i += 200) {
        const { data, error } = await db.from('airtable_tickets').select('*').in('record_id', ids0.slice(i, i + 200));
        if (error) throw new Error(error.message);
        for (const r of data ?? []) before.set(r.record_id, r as AirtableTicketRow);
      }
    } catch (e) {
      /* Their API cannot be read (since 26 Oct 2026 the token is 401). A run
         somebody asked for - after an import, or Sync now - still fills what
         our copy of their table, from the last export uploaded, can fill:
         requests, names, cabins and routes, as the API run did. The schedule's
         own runs still stop here: nothing has changed for them to read. */
      apiDown = e instanceof Error ? e.message : String(e);
      if (!env.fillNow || !/^Airtable |fetch failed/i.test(apiDown)) throw e;
      rows = []; full = false; before.clear(); local = true;
    }
    const ids = rows.map(r => r.record_id);

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

    /* Between full runs only the rows that changed are looked at, against
       only the tickets they name - by number, as a refund application, or by
       booking - rather than the whole ledger and their whole table (4.5 MB a
       time, 69 times on a busy day). The whole-table questions - a split
       request closing, a ticket filling from a row that did not change - wait
       for the full run. */
    const scope = full ? null : {
      serials: [...new Set(changedRows.flatMap(r => r.serials ?? []).filter(Boolean))],
      pnrs: [...new Set(changedRows.flatMap(r => String(r.pnr || '').toUpperCase().split(/[|,/\s]+/)).filter(Boolean))],
    };
    const LEDGER_COLS = 'id, ticket_no, pnr, req_num, passenger_name, cabin_class, source, amount, status, currency, date, commission, total_doc, airline_code, transaction_type, closed, related_ticket, original_currency, original_amount, fx_rate, report_name, confirmed_by, user_id';
    const ledgerIn = async (cols: string, extra?: (q: any) => any) => {
      const seen = new Map<string, Record<string, any>>();
      const pick = async (col: string, vals: string[]) => {
        for (let i = 0; i < vals.length; i += 150) {
          let q = db.from('tickets').select(cols).in(col, vals.slice(i, i + 150));
          if (extra) q = extra(q);
          const { data, error } = await q;
          if (error) throw new Error(`tickets: ${error.message}`);
          for (const t of (data ?? []) as unknown as Record<string, any>[]) seen.set(t.id, t);
        }
      };
      await pick('ticket_no', scope!.serials);
      await pick('related_ticket', scope!.serials);
      await pick('pnr', scope!.pnrs);
      return [...seen.values()];
    };

    // What it means for our books - only worth the ledger read when something moved.
    let notices: Notice[] = [], onlineQueued = 0;
    if (changedRows.length || full) {
      const ledger = full ? await selectAll<Record<string, any>>(db, 'tickets', LEDGER_COLS) : await ledgerIn(LEDGER_COLS);
      const lite: LedgerLite[] = ledger.map(t => ({ id: t.id, ticketNo: t.ticket_no, pnr: t.pnr, reqNum: t.req_num ?? '',
        passengerName: t.passenger_name ?? '', cabinClass: t.cabin_class ?? '', source: t.source, amount: Number(t.amount ?? 0),
        status: t.status, currency: t.currency, relatedTicket: t.related_ticket ?? undefined, airlineCode: t.airline_code ?? '' }));
      // Names and cabins are offered from any row read; requests, refunds,
      // voids and prices only from what changed.
      notices = noticesFor(full ? rows : changedRows, changes, ledgerIndex(lite));

      // Bought online and in nobody's books: to To Review, like the check would.
      const all = full ? rows : changedRows;
      // Refunds on their sheet we do not hold, read off the sheet as it stands:
      // they add a refunded row rather than change the old one.
      notices.push(...missingRefunds(all, ledgerIndex(lite)));
      // Sold on one request, refunded on another - and closed once they agree.
      const splits = splitRequests(all, lite);
      notices.push(...splits);
      // Settled only on a full run: a run that looked at a few rows cannot
      // say a split elsewhere is gone.
      if (!dry && full) {
        const still = new Set(splits.map(n => n.dedupe_key));
        const { data: openSplits } = await db.from('airtable_notifications').select('id, dedupe_key').eq('kind', 'REQ_SPLIT').eq('state', 'OPEN');
        const settled = (openSplits ?? []).filter(n => !still.has(n.dedupe_key)).map(n => n.id);
        if (settled.length) await db.from('airtable_notifications')
          .update({ state: 'ACCEPTED', decided_by: 'Airtable sync', decided_at: new Date().toISOString() }).in('id', settled);
      }
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
      const voids = await selectAll<{ ticket_no: string; pnr: string | null }>(db, 'void_tickets', 'ticket_no, pnr');
      const chains = await selectAll<{ ticket_no: string; replaced_ticket: string }>(db, 'ticket_exchanges', 'ticket_no, replaced_ticket');
      const voided = new Set(voids.map(v => docKey(v.ticket_no)));
      const report = compareTeamSheet(sheet, tickets, [], {}, {
        voided: voids.map(v => v.ticket_no), voidRecords: voids.map(v => ({ ticketNo: v.ticket_no, pnr: v.pnr ?? '' })), chains: chains.map(c => ({ ticketNo: c.ticket_no, replacedTicket: c.replaced_ticket })) });
      // Every ticket of theirs that is in nobody's books waits for a person
      // in To Review: the one decision this integration asks of anybody.
      const online = report.findings.filter(f => f.verdict === 'NOT_IN_LEDGER'
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
        for (const p of fresh) {
          const web = p.source === 'Airline Website';
          notices.push({
            kind: web ? 'ONLINE_TICKET' : 'NOT_IN_BOOKS', dedupe_key: `${web ? 'ONLINE' : 'MISSING'}|${p.dedupe}`, record_id: '',
            ticket_no: p.ticketNo || p.pnr || '', ticket_ids: [], req_num: p.reqNum,
            title: `${web ? 'Bought online' : 'Not in our books'}: ${p.ticketNo || p.pnr} · ${p.amount ? `${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${p.currency}` : 'no price on their sheet'} · ${p.reqNum || 'no request'}`,
            detail: `On their sheet from ${p.theirPortal || p.source || 'their portal'} and not in our books. Waiting in To Review - add it or reject it.`,
            payload: { dedupe: p.dedupe } });
        }
      }
    }
    /* Refunds on their sheet that our books lack wait in To Review too, not
       only in the bell: "Seen" there closed the notice and left the refund in
       nobody's list. Each waits until the supplier's report brings it. */
    const refundsMissing = refundProposals(notices, '', () => crypto.randomUUID());
    if (refundsMissing.length) {
      const known = new Set<string>();
      const keys = refundsMissing.map(p => p.dedupe);
      for (let i = 0; i < keys.length; i += 200) {
        const { data } = await db.from('pending_tickets').select('dedupe').in('dedupe', keys.slice(i, i + 200));
        for (const r of data ?? []) known.add(r.dedupe);
      }
      const fresh = refundsMissing.filter(p => !known.has(p.dedupe));
      if (fresh.length && !dry) {
        const { data: who } = await db.from('tickets').select('user_id').not('user_id', 'is', null).limit(1);
        const owner = who?.[0]?.user_id ?? '';
        const { error } = await db.from('pending_tickets').insert(fresh.map(p => pendingRow(p, owner)));
        if (error) throw new Error(`pending_tickets: ${error.message}`);
      }
      onlineQueued += fresh.length;
    }
    const preview = dry ? { notices, online: notices.filter(n => n.kind === 'ONLINE_TICKET').map(n => n.title), changes: [...changes].slice(0, 40) } : undefined;
    for (let i = 0; i < notices.length && !dry; i += 500) {
      const { error } = await db.from('airtable_notifications').upsert(notices.slice(i, i + 500), { onConflict: 'dedupe_key', ignoreDuplicates: true });
      if (error) throw new Error(`airtable_notifications: ${error.message}`);
    }

    /* Tickets of ours with no request take the one their sheet gives -
       every run, so a ticket imported from a supplier report gets it within
       two minutes, and one the team only adds to their sheet later gets it
       the moment they do. Fill only, and said in the activity log. */
    let reqFilled = 0, detailsFilled = 0;
    const fillNow = full || changedRows.length > 0 || !!env.fillNow;
    /* Read from our copy alone, which has not moved since the last run that
       wrote it - and that run filled everything it could. Only a ticket
       arrived since can take something now. */
    const onlySince = local ? st?.last_ok_at as string | undefined : undefined;
    const arrivedSince = (q: any) => onlySince ? q.gt('created_at', onlySince) : q;
    type LiveRow = { serials: string[]; ticket_cell: string; pnr: string; req_num: string; status: string; client_name: string; cabin: string; portal: string; airline: string; sheet_row: Record<string, string> };
    let liveRows: LiveRow[] | null = null;
    // On a full run their whole table was just read; on any other, read our copy.
    // After an import (fill=1) our copy of their whole table; between full
    // runs, only what just changed.
    /* Of each row's sheet, only the three cells the fills read: the whole
       sheet is 2.5 MB of the 2.8 a read of the table costs. */
    const liveAll = async () => liveRows ??= full ? rows as unknown as LiveRow[]
      : !env.fillNow ? changedRows as unknown as LiveRow[]
      : (await selectAll<LiveRow & { emd: string | null; origin: string | null; dest: string | null }>(db, 'airtable_tickets',
        'serials, ticket_cell, pnr, req_num, status, client_name, cabin, portal, airline, emd:sheet_row->>"EMD Number", '
        + 'origin:sheet_row->>"Origin Airports (from Aviation Quotations)", dest:sheet_row->>"Destination Airports (from Aviation Quotations)"',
        q => q.eq('deleted', false)))
        .map(({ emd, origin, dest, ...r }) => ({ ...r, sheet_row: { 'EMD Number': emd ?? '',
          'Origin Airports (from Aviation Quotations)': origin ?? '', 'Destination Airports (from Aviation Quotations)': dest ?? '' } }));
    // The log lines, written together at the end rather than one round trip each.
    const auditRows: Record<string, unknown>[] = [];
    const audit = async (owner: string | undefined, entity: string, detail: string) => { auditRows.push({
      id: crypto.randomUUID(), user_id: owner, action: 'UPDATE_REQ', entity, entity_type: 'ticket',
      actor_email: 'Airtable sync', detail, performed_at: new Date().toISOString() }); };

    // Names, cabins and routes we lack, filled from the row that names the
    // same document. Nobody is asked; nothing already there is touched.
    if (fillNow) {
      type Lacking = { id: string; ticket_no: string; passenger_name: string | null; cabin_class: string | null; route: string | null; user_id: string; pnr: string | null; source: string | null };
      const LACK_COLS = 'id, ticket_no, passenger_name, cabin_class, route, user_id, pnr, source';
      const lackingOnly = (q: any) => arrivedSince(q).neq('status', 'FUND').or('passenger_name.is.null,passenger_name.eq.,cabin_class.is.null,cabin_class.eq.,route.is.null,route.eq.');
      const lacking = (full || env.fillNow
        ? await selectAll<Lacking>(db, 'tickets', LACK_COLS, lackingOnly)
        : await ledgerIn(LACK_COLS, lackingOnly)) as Lacking[];
      if (lacking.length) {
        const fills = detailsFor(lacking.map(t => ({ id: t.id, ticketNo: t.ticket_no ?? '', passengerName: t.passenger_name ?? '',
          cabinClass: t.cabin_class ?? '', route: t.route ?? '', pnr: t.pnr ?? '', source: t.source ?? '' })), await liveAll());
        const owner = lacking.find(t => t.user_id)?.user_id;
        for (const f of fills) {
          if (dry) { detailsFilled++; continue; }
          const { data: upd, error } = await db.from('tickets').update({ [f.field]: f.value })
            .eq('id', f.id).or(`${f.field}.is.null,${f.field}.eq.`).select('id');
          /* A blank left blank costs nothing; a whole sync stopped over one
             costs every notice and request behind it - 17 Oct, one Premium
             Economy cabin the database would not take held them all. */
          if (error) { console.warn(`detail fill skipped: ${f.ticketNo} ${f.field}=${f.value}: ${error.message}`); continue; }
          if (!upd?.length) continue;
          detailsFilled++;
          await audit(owner, f.ticketNo, `${f.field === 'passenger_name' ? 'Passenger name' : f.field === 'cabin_class' ? 'Cabin' : 'Route'} ${f.value} from the team's Airtable`);
        }
      }
      // Names and cabins were notices once; they are filled now, so the old ones are closed.
      if (!dry) await db.from('airtable_notifications').update({ state: 'ACCEPTED', decided_by: 'Airtable sync', decided_at: new Date().toISOString() })
        .in('kind', ['NAME', 'CABIN']).eq('state', 'OPEN');
    }

    /* A request change that is no longer what their sheet says. The team
       moved fourteen rows to KSAML482 by mistake and back to KSAML2325 an
       hour later; the KSAML482 notices stayed open, and accepting them
       would have filed our tickets where nobody meant them to go. A notice
       whose row now says something else is withdrawn; one whose tickets of
       ours already sit under its request is done. Every run. */
    if (!dry) {
      const { data: reqOpen } = await db.from('airtable_notifications').select('id, record_id, payload')
        .eq('kind', 'REQ_CHANGED').eq('state', 'OPEN');
      if (reqOpen?.length) {
        const ids = [...new Set(reqOpen.map(n => n.record_id).filter(Boolean))];
        const { data: now } = await db.from('airtable_tickets').select('record_id, req_num, deleted').in('record_id', ids);
        const reqOf = new Map((now ?? []).map(r => [r.record_id, r.deleted ? '' : (r.req_num ?? '')]));
        const oursIds = [...new Set(reqOpen.flatMap(n => ((n.payload?.ours ?? []) as { id: string }[]).map(o => o.id)))];
        const { data: oursNow } = oursIds.length ? await db.from('tickets').select('id, req_num').in('id', oursIds) : { data: [] as { id: string; req_num: string }[] };
        const oursReq = new Map((oursNow ?? []).map(t => [t.id, t.req_num ?? '']));
        const stale: string[] = [], done: string[] = [];
        for (const n of reqOpen) {
          const to = reqParts(String(n.payload?.to ?? ''));
          const sheetNow = reqParts(reqOf.get(n.record_id) ?? '');
          if (!to.length || !to.some(k => sheetNow.includes(k))) { stale.push(n.id); continue; }
          const ours = ((n.payload?.ours ?? []) as { id: string }[]).filter(o => oursReq.has(o.id));
          if (ours.length && ours.every(o => reqParts(oursReq.get(o.id) ?? '').some(k => to.includes(k)))) done.push(n.id);
        }
        const at = new Date().toISOString();
        if (stale.length) await db.from('airtable_notifications').update({ state: 'DISMISSED', decided_by: 'Airtable sync', decided_at: at }).in('id', stale);
        if (done.length) await db.from('airtable_notifications').update({ state: 'ACCEPTED', decided_by: 'Airtable sync', decided_at: at }).in('id', done);
      }
    }

    /* A refund we were told about has arrived - or their sheet no longer
       refunds it: the notice is answered. Every run, like the waiting
       tickets below, because the answer comes from a supplier's report. */
    if (!dry) {
      const { data: openRefunds } = await db.from('airtable_notifications').select('id, ticket_no, record_id')
        .eq('kind', 'REFUND_MISSING').eq('state', 'OPEN');
      if (openRefunds?.length) {
        const nos = [...new Set(openRefunds.map(n => n.ticket_no))];
        const { data: lines } = await db.from('tickets').select('ticket_no, related_ticket, amount').lt('amount', 0)
          .or([...nos.map(n => `ticket_no.ilike.%${n}`), `related_ticket.in.(${nos.join(',')})`].join(','));
        // Under its own number, or as an application naming it.
        const credited = new Set((lines ?? []).flatMap(t => [docKey(t.ticket_no), t.related_ticket ? docKey(t.related_ticket) : '']));
        const { data: still } = await db.from('airtable_tickets').select('serials, status').eq('deleted', false)
          .overlaps('serials', nos);
        const refundedThere = new Set((still ?? []).filter(r => /refund/i.test(r.status ?? '')).flatMap(r => r.serials ?? []));
        const now = new Date().toISOString();
        const came = openRefunds.filter(n => credited.has(docKey(n.ticket_no))).map(n => n.id);
        const gone = openRefunds.filter(n => !credited.has(docKey(n.ticket_no)) && !refundedThere.has(n.ticket_no)).map(n => n.id);
        if (came.length) await db.from('airtable_notifications').update({ state: 'ACCEPTED', decided_by: 'Airtable sync', decided_at: now }).in('id', came);
        if (gone.length) await db.from('airtable_notifications').update({ state: 'DISMISSED', decided_by: 'Airtable sync', decided_at: now }).in('id', gone);
      }
    }

    /* A ticket waiting in To Review because it was in nobody's books, that
       has since arrived with a supplier's report: its question is answered.
       The proposal is closed, and its notice with it. */
    /* Every run, because the question goes stale fast: 4862343305 was raised
       as missing at 15:10, the team voided it at 18:12, and it sat in the bell
       overnight after it was in our Voids. A waiting ticket is closed the
       moment its question is answered - it arrived, or it was voided. */
    if (!dry) {
      const { data: waiting } = await db.from('pending_tickets').select('id, ticket_no, pnr, their_portal, their_cell, dedupe, amount, currency, their_cost, req_num, their_req')
        .eq('origin', 'AIRTABLE').eq('state', 'PENDING');
      if (waiting?.length) {
        const nos = [...new Set(waiting.map(w => w.ticket_no).filter(Boolean))];
        /* Arrived means the document it waits for: a sale waits for a sale.
           4862405611 waited as a sale of 816.50 and was closed "arrived" when
           only its refund came in - the sale is still not in our books. */
        const { data: arrived } = await db.from('tickets').select('ticket_no, amount').in('ticket_no', nos);
        const sold = new Set((arrived ?? []).filter(t => Number(t.amount) > 0).map(t => docKey(t.ticket_no)));
        const credited = new Set((arrived ?? []).filter(t => Number(t.amount) < 0).map(t => docKey(t.ticket_no)));
        const arrivedFor = (w: { ticket_no: string; amount: number | string | null }) =>
          Number(w.amount) < 0 ? credited.has(docKey(w.ticket_no)) : sold.has(docKey(w.ticket_no));
        // flyadeal and flydubai arrive under the PNR - their reports have no ticket number.
        const f3 = waiting.filter(w => pnrVendorOfRow({ portal: w.their_portal }) && w.pnr);
        const f3Pnrs = [...new Set(f3.flatMap(w => String(w.pnr).toUpperCase().split(/[|,/\s]+/).filter(Boolean)))];
        const { data: f3Held } = f3Pnrs.length
          ? await db.from('tickets').select('pnr').or('source.ilike.%flyadeal%,source.ilike.%flydubai%').in('pnr', f3Pnrs)
          : { data: [] as { pnr: string }[] };
        const heldPnr = new Set((f3Held ?? []).map(t => String(t.pnr).toUpperCase()));
        const done = waiting.filter(w => arrivedFor(w)
          || (f3.includes(w) && String(w.pnr).toUpperCase().split(/[|,/\s]+/).some(p => heldPnr.has(p))));
        const close = async (list: typeof waiting, state: 'CONFIRMED' | 'REJECTED', note: string, noticeState: 'ACCEPTED' | 'DISMISSED') => {
          if (!list.length) return;
          await db.from('pending_tickets').update({ state, review_note: note }).in('id', list.map(w => w.id));
          await db.from('airtable_notifications').update({ state: noticeState, decided_by: 'Airtable sync', decided_at: new Date().toISOString() })
            .in('dedupe_key', list.flatMap(w => [`ONLINE|${w.dedupe}`, `MISSING|${w.dedupe}`])).eq('state', 'OPEN');
        };
        await close(done, 'CONFIRMED', "Arrived with the supplier's report", 'ACCEPTED');

        // Voided - in our Voids, or on their sheet now - so there is nothing to add.
        const rest = waiting.filter(w => !done.includes(w));
        const keys = [...new Set(rest.map(w => docKey(w.ticket_no)).filter(Boolean))];
        if (keys.length) {
          const { data: inVoids } = await db.from('void_tickets').select('ticket_no').in('ticket_no', keys);
          const { data: theirs } = await db.from('airtable_tickets').select('serials, status, net_cost, currency, req_num').overlaps('serials', keys).eq('deleted', false);
          const voided = new Set((inVoids ?? []).map(v => docKey(v.ticket_no)));
          // Void on their sheet only when every row of theirs naming it says so.
          const theirStatus = new Map<string, string[]>();
          for (const r of theirs ?? []) for (const k of r.serials ?? []) theirStatus.set(k, [...(theirStatus.get(k) ?? []), r.status ?? '']);
          /* A purchase on an airline's site has no ticket number: their row
             reads "0" and it waits here under its PNR. ZF7WSS was voided on
             their sheet and stayed open, because only numbers were looked
             up. Their rows with no number are found by the PNR they carry. */
          const byPnr = rest.filter(w => !theirStatus.has(docKey(w.ticket_no)) && w.pnr);
          if (byPnr.length) {
            const pnrs = [...new Set(byPnr.flatMap(w => String(w.pnr).toUpperCase().split(/[|,/\s]+/).filter(Boolean)))];
            const { data: online } = await db.from('airtable_tickets').select('pnr, status, serials')
              .eq('deleted', false).or(pnrs.map(p => `pnr.ilike.%${p}%`).join(','));
            for (const w of byPnr) {
              const mine = String(w.pnr).toUpperCase().split(/[|,/\s]+/).filter(Boolean);
              const rows = (online ?? []).filter(r => !(r.serials ?? []).length
                && String(r.pnr ?? '').toUpperCase().split(/[|,/\s]+/).some(p => mine.includes(p)));
              if (rows.length) theirStatus.set(docKey(w.ticket_no), rows.map(r => r.status ?? ''));
            }
          }
          const voidOnTheirs = (k: string) => (theirStatus.get(k) ?? []).length > 0 && theirStatus.get(k)!.every(st => /void/i.test(st));
          await close(rest.filter(w => voided.has(docKey(w.ticket_no))), 'REJECTED', 'Voided - it is in our Voids. Nothing to add.', 'DISMISSED');
          await close(rest.filter(w => !voided.has(docKey(w.ticket_no)) && voidOnTheirs(docKey(w.ticket_no))), 'REJECTED',
            'Voided on their sheet. Nothing to add.', 'DISMISSED');

          /* The row that raised it is no longer on their sheet as it was
             written. 8TFECR had its PNR in the ticket column; the team swapped
             the two back to 065-4862343273 / 8TFECR, a ticket we hold - and the
             question about "8TFECR" stayed open. A row they corrected is asked
             about afresh, under what it says now, by the next comparison. */
          const open2 = rest.filter(w => !voided.has(docKey(w.ticket_no)) && !voidOnTheirs(docKey(w.ticket_no)));
          const cells = [...new Set(open2.map(w => (w.their_cell || w.ticket_no || '').trim()).filter(Boolean))];
          const { data: byCell } = cells.length
            ? await db.from('airtable_tickets').select('ticket_cell').in('ticket_cell', cells).eq('deleted', false)
            : { data: [] as { ticket_cell: string }[] };
          const stillCell = new Set((byCell ?? []).map(r => (r.ticket_cell || '').trim()));
          const gone = open2.filter(w => !theirStatus.has(docKey(w.ticket_no)) && !stillCell.has((w.their_cell || w.ticket_no || '').trim()));
          await close(gone, 'REJECTED', 'Their sheet no longer has this row as it was written - corrected or removed. Asked again under what it says now, if anything is missing.', 'DISMISSED');

          /* Still waiting, and their row has moved since it was raised - the
             team put 4862343317's currency right, AED to SAR. The waiting row
             follows their sheet for as long as nobody here has touched its
             figure; a figure somebody corrected is theirs, and stays. */
          for (const w of open2.filter(x => !gone.includes(x))) {
            const rowsFor = (theirs ?? []).filter(r => (r.serials ?? []).includes(docKey(w.ticket_no)) && !/void|hold/i.test(r.status ?? ''));
            if (rowsFor.length !== 1) continue;
            const r = rowsFor[0];
            const untouched = w.their_cost == null || Math.abs(Math.abs(Number(w.amount)) - Math.abs(Number(w.their_cost))) < 0.005;
            if (!untouched) continue;
            const patch: Record<string, unknown> = {};
            if (r.currency && r.currency !== w.currency) patch.currency = r.currency;
            if (r.net_cost != null && Math.abs(Number(r.net_cost) - Math.abs(Number(w.amount))) >= 0.005) {
              patch.amount = Math.sign(Number(w.amount) || 1) * Math.abs(Number(r.net_cost));
              patch.total_doc = Math.abs(Number(r.net_cost));
              patch.their_cost = Number(r.net_cost);
            }
            if (r.req_num && !r.req_num.includes(',') && r.req_num !== (w.req_num || '')) { patch.req_num = r.req_num; patch.their_req = r.req_num; }
            if (!Object.keys(patch).length) continue;
            await db.from('pending_tickets').update(patch).eq('id', w.id);
            const amt = Math.abs(Number(patch.amount ?? w.amount));
            const cur = String(patch.currency ?? w.currency);
            const req = String(patch.req_num ?? w.req_num ?? '') || 'no request';
            await db.from('airtable_notifications').update({
              title: `Not in our books: ${w.ticket_no} · ${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${cur} · ${req}` })
              .eq('dedupe_key', `MISSING|${w.dedupe}`).eq('state', 'OPEN');
          }
        }
      }
    }

    const { data: miss, error: missErr } = fillNow
      ? await arrivedSince(db.from('tickets').select('id, ticket_no, pnr, status, user_id, source').or('req_num.is.null,req_num.eq.').neq('status', 'FUND'))
      : { data: [], error: null };
    if (missErr) throw new Error(`tickets: ${missErr.message}`);
    if (miss?.length) {
      const live = await liveAll();
      const fills = requestsFor(
        miss.map(t => ({ id: t.id, ticketNo: t.ticket_no ?? '', pnr: t.pnr ?? '', source: t.source ?? '', status: t.status ?? '' })),
        live.map(r => ({ serials: r.serials ?? [], emd: r.sheet_row?.['EMD Number'] ?? '', pnr: r.pnr ?? '', req_num: r.req_num ?? '',
          status: r.status ?? '', portal: r.portal ?? '', airline: r.airline ?? '' })));
      const owner = miss.find(t => t.user_id)?.user_id;
      for (const f of fills) {
        if (dry) { reqFilled++; continue; }
        const { data: upd, error } = await db.from('tickets').update({ req_num: f.req })
          .eq('id', f.id).or('req_num.is.null,req_num.eq.').select('id');
        if (error) throw new Error(`tickets: ${error.message}`);
        if (!upd?.length) continue;   // somebody filled it in the meantime
        reqFilled++;
        await audit(owner, f.ticketNo, `Request ${f.req} from the team's Airtable (matched by ${f.how})`);
      }
    }

    for (let i = 0; i < auditRows.length && !dry; i += 500) {
      const { error } = await db.from('audit_log').insert(auditRows.slice(i, i + 500));
      if (error) throw new Error(`audit_log: ${error.message}`);
    }

    const newest = [st?.cursor, ...rows.map(r => r.last_modified), ...rows.map(r => r.created_at)]
      .filter(Boolean).map(x => new Date(x as string).getTime()).reduce((a, b) => Math.max(a, b), 0);
    const { count } = await db.from('airtable_tickets').select('record_id', { count: 'exact', head: true }).eq('deleted', false);
    /* An export moves no cursor and resets the full run: when the API is back,
       its first read is of the whole table, which settles the records the
       export could only name by their content. */
    // From our copy alone: a failing API says so; one switched off is no failure.
    if (!dry && local) await db.from('airtable_sync_state').upsert({ id: STATE_ID, last_run_at: stamp, last_error: apiDown || null });
    else if (!dry) await db.from('airtable_sync_state').upsert(csv ? {
      id: STATE_ID, last_full_at: null, last_run_at: stamp, last_ok_at: new Date().toISOString(),
      last_error: null, record_count: count ?? null, last_changed: changedRows.length,
    } : {
      id: STATE_ID, cursor: newest ? new Date(newest).toISOString() : now.toISOString(),
      last_full_at: full ? stamp : st?.last_full_at, last_run_at: stamp, last_ok_at: new Date().toISOString(),
      last_error: null, record_count: count ?? null, last_changed: changedRows.length, names,
    });
    return { mode: csv ? 'csv' : local ? 'local' : full ? 'full' : 'incremental', fetched: csv ? rows.length : recs.length, changedRecords: changes.size, fieldChanges: log.length,
      added, deleted, notices: notices.length, onlineQueued, reqFilled, detailsFilled, ms: Date.now() - t0, preview };
  } catch (e) {
    if (!dry) await db.from('airtable_sync_state').upsert({ id: STATE_ID, last_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
