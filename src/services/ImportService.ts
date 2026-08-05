import { supabase, fetchAllRows } from '../utils/supabase';

export interface ImportRecord {
  id:          string;
  userId:      string;
  vendor:      string;
  reportName:  string;
  parserName:  string;
  confidence:  number;
  totalRows:   number;
  imported:    number;
  updated:     number;
  topups:      number;
  failed:      number;
  warnings:    number;
  duration:    number;   // ms
  importedAt:  string;
}

export interface AuditEntry {
  id:         string;
  userId:     string;
  action:
    | 'IMPORT' | 'MANUAL_ENTRY'
    | 'UPDATE_REQ' | 'BULK_UPDATE_REQ'
    | 'UPDATE_CLOSED' | 'BULK_UPDATE_CLOSED'
    | 'EDIT_TICKET' | 'DELETE'
    | 'TOPUP' | 'ADD_VENDOR' | 'EDIT_VENDOR' | 'DELETE_VENDOR';
  entity:     string;   // ticketNo / vendorName / etc
  detail:     string;
  performedAt: string;
}

export interface ErrorEntry {
  id:        string;
  userId:    string;
  vendor:    string;
  rowNumber: number;
  rawData:   string;
  error:     string;
  importId:  string;
  loggedAt:  string;
}

type ImportHistoryRow = {
  id: string; user_id: string; vendor: string; report_name: string | null;
  parser_name: string | null; confidence: number | null; total_rows: number;
  imported: number; updated: number; topups: number; failed: number;
  warnings: number; duration_ms: number; imported_at: string;
};

type ErrorLogRow = {
  id: string; user_id: string; vendor: string | null; row_number: number | null;
  raw_data: string | null; error: string | null; import_id: string | null; logged_at: string;
};

const rowToImportRecord = (r: ImportHistoryRow): ImportRecord => ({
  id: r.id, userId: r.user_id, vendor: r.vendor, reportName: r.report_name ?? '',
  parserName: r.parser_name ?? '', confidence: r.confidence ?? 0, totalRows: r.total_rows,
  imported: r.imported, updated: r.updated, topups: r.topups, failed: r.failed,
  warnings: r.warnings, duration: r.duration_ms, importedAt: r.imported_at,
});

const rowToErrorEntry = (r: ErrorLogRow): ErrorEntry => ({
  id: r.id, userId: r.user_id, vendor: r.vendor ?? '', rowNumber: r.row_number ?? 0,
  rawData: r.raw_data ?? '', error: r.error ?? '', importId: r.import_id ?? '', loggedAt: r.logged_at,
});

export class ImportService {
  private userId: string;

  constructor(userId: string) { this.userId = userId; }

  async saveImportRecord(record: Omit<ImportRecord, 'id' | 'userId' | 'importedAt'>): Promise<string> {
    const id = `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await supabase.from('import_history').insert({
      id,
      user_id: this.userId,
      vendor: record.vendor,
      report_name: record.reportName,
      parser_name: record.parserName,
      confidence: record.confidence,
      total_rows: record.totalRows,
      imported: record.imported,
      updated: record.updated,
      topups: record.topups,
      failed: record.failed,
      warnings: record.warnings,
      duration_ms: record.duration,
    });
    if (error) throw new Error(error.message);
    return id;
  }

  async saveErrors(importId: string, vendor: string, errors: { row: number; raw: string; error: string }[]): Promise<void> {
    if (errors.length === 0) return;
    const rows = errors.map(e => ({
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      user_id: this.userId,
      vendor,
      row_number: e.row,
      raw_data: e.raw.substring(0, 300),
      error: e.error,
      import_id: importId,
    }));
    const { error } = await supabase.from('error_log').insert(rows);
    if (error) throw new Error(error.message);
  }

  /** App-level audit entry. Ticket edits and deletes are already captured by
   *  a database trigger; this covers the actions a trigger can't see as a
   *  single event — imports, top-ups, and bulk operations. Stamps the actor
   *  so the admin log always names a person, never just a user id. */
  async audit(action: AuditEntry['action'], entity: string, detail: string): Promise<void> {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('audit_log').insert({
      id,
      user_id: this.userId,
      actor_id: auth.user?.id ?? this.userId,
      actor_email: auth.user?.email ?? 'unknown',
      entity_type: 'app',
      action, entity, detail,
    });
    if (error) throw new Error(error.message);
  }

  subscribeHistory(onData: (records: ImportRecord[]) => void, maxItems = 50) {
    let cancelled = false;
    const fetchAll = async () => {
      const { data, error } = await supabase
        .from('import_history')
        .select('*')
        .order('imported_at', { ascending: false })
        .limit(maxItems);
      if (error) { console.error('import_history error', error); return; }
      if (!cancelled) onData((data as ImportHistoryRow[]).map(rowToImportRecord));
    };
    fetchAll();
    const channel = supabase
      .channel(`import-history-${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'import_history' }, fetchAll)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }

  subscribeErrors(importId: string, onData: (errors: ErrorEntry[]) => void) {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const rows = await fetchAllRows<ErrorLogRow>((from, to) =>
          supabase.from('error_log').select('*').eq('import_id', importId).range(from, to)
        );
        if (!cancelled) onData(rows.map(rowToErrorEntry));
      } catch (e) { console.error('error_log error', e); }
    };
    fetchAll();
    const channel = supabase
      .channel(`error-log-${importId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'error_log', filter: `import_id=eq.${importId}` }, fetchAll)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }
}
