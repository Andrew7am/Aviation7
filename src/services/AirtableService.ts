import { supabase, fetchAllRows } from '../utils/supabase';

/**
 * The team's Airtable as the app sees it: the live copy the server keeps,
 * how fresh it is, and the notices waiting for a person. The app never
 * talks to Airtable itself - the token lives on the server.
 */
export interface SyncState {
  lastOkAt: string | null; lastRunAt: string | null; lastError: string | null;
  recordCount: number | null; lastChanged: number | null;
}

export interface AirtableNotice {
  id: string; kind: string; dedupeKey: string; recordId: string | null; ticketNo: string | null;
  ticketIds: string[]; reqNum: string | null; title: string; detail: string | null;
  payload: Record<string, any>; state: 'OPEN' | 'ACCEPTED' | 'DISMISSED'; createdAt: string;
  decidedBy: string | null; decidedAt: string | null;
}

export interface LiveRecord {
  record_id: string; ticket_cell: string; serials: string[]; pnr: string; status: string; req_num: string;
  net_cost: number | null; currency: string; refund_amount: number | null; issued_at: string | null;
  client_name: string; cabin: string; portal: string; airline: string; team_member: string;
  old_ticket: string; last_modified: string | null;
}

export interface ChangeRow {
  id: number; record_id: string; ticket_cell: string | null; field: string;
  old_value: string | null; new_value: string | null; changed_at: string;
}

const notice = (r: any): AirtableNotice => ({
  id: r.id, kind: r.kind, dedupeKey: r.dedupe_key, recordId: r.record_id, ticketNo: r.ticket_no,
  ticketIds: r.ticket_ids ?? [], reqNum: r.req_num, title: r.title, detail: r.detail, payload: r.payload ?? {},
  state: r.state, createdAt: r.created_at, decidedBy: r.decided_by, decidedAt: r.decided_at,
});

export class AirtableService {
  /** Their rows, as their export would print them, oldest first. */
  async liveSheetRows(): Promise<Record<string, string>[]> {
    const rows = await fetchAllRows<{ sheet_row: Record<string, string> }>((from, to) =>
      supabase.from('airtable_tickets').select('sheet_row, created_at')
        .eq('deleted', false).order('created_at', { ascending: true }).range(from, to));
    return rows.map(r => r.sheet_row);
  }

  /** Their tickets as the sync keeps them - every field we read, no sheet row. */
  async liveRecords(): Promise<LiveRecord[]> {
    const rows = await fetchAllRows<any>((from, to) =>
      supabase.from('airtable_tickets')
        .select('record_id, ticket_cell, serials, pnr, status, req_num, net_cost, currency, refund_amount, issued_at, client_name, cabin, portal, airline, team_member, old_ticket, last_modified')
        .eq('deleted', false).order('issued_at', { ascending: false, nullsFirst: false }).range(from, to));
    return rows.map(r => ({ ...r, net_cost: r.net_cost == null ? null : Number(r.net_cost),
      refund_amount: r.refund_amount == null ? null : Number(r.refund_amount), serials: r.serials ?? [] }));
  }

  /** What moved on their side, newest first. */
  async changes(limit = 1000): Promise<ChangeRow[]> {
    const { data, error } = await supabase.from('airtable_changes')
      .select('id, record_id, ticket_cell, field, old_value, new_value, changed_at')
      .order('changed_at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as ChangeRow[];
  }

  async state(): Promise<SyncState | null> {
    const { data, error } = await supabase.from('airtable_sync_state')
      .select('last_ok_at, last_run_at, last_error, record_count, last_changed').eq('id', 'aviation_tickets').maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { lastOkAt: data.last_ok_at, lastRunAt: data.last_run_at, lastError: data.last_error,
      recordCount: data.record_count, lastChanged: data.last_changed } : null;
  }

  /** Ask the server to sync now, as the signed-in user. */
  async syncNow(): Promise<{ fetched: number; changedRecords: number; notices: number }> {
    const { data } = await supabase.auth.getSession();
    const r = await fetch('/api/airtable/sync', {
      method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Sync failed (${r.status})`);
    return j;
  }

  /** Open notices, and the ones decided in the last week for reference. */
  async notices(): Promise<AirtableNotice[]> {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const rows = await fetchAllRows<any>((from, to) =>
      supabase.from('airtable_notifications').select('*')
        .or(`state.eq.OPEN,decided_at.gte.${since}`).order('created_at', { ascending: false }).range(from, to));
    return rows.map(notice);
  }

  async decide(ids: string[], state: 'ACCEPTED' | 'DISMISSED', by: string): Promise<void> {
    const { error } = await supabase.from('airtable_notifications')
      .update({ state, decided_by: by, decided_at: new Date().toISOString() }).in('id', ids);
    if (error) throw new Error(error.message);
  }
}
