import { supabase, fetchAllRows } from '../utils/supabase';

export interface AuditRecord {
  id:          string;
  actorEmail:  string;
  actorId:     string | null;
  action:      string;
  entityType:  string;
  entity:      string;
  detail:      string;
  beforeData:  Record<string, unknown> | null;
  afterData:   Record<string, unknown> | null;
  performedAt: string;
}

export interface AppUser {
  id:        string;
  email:     string;
  role:      'admin' | 'member';
  createdAt: string;
}

type AuditRow = {
  id: string; actor_id: string | null; actor_email: string | null;
  action: string; entity_type: string | null; entity: string | null;
  detail: string | null; before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null; performed_at: string;
};

const rowToAudit = (r: AuditRow): AuditRecord => ({
  id: r.id,
  actorId: r.actor_id,
  actorEmail: r.actor_email || 'system',
  action: r.action,
  entityType: r.entity_type || '',
  entity: r.entity || '',
  detail: r.detail || '',
  beforeData: r.before_data,
  afterData: r.after_data,
  performedAt: r.performed_at,
});

export class AuditService {
  /** Current user's role. Returns 'member' if the registry row is missing,
   *  so a brand-new account is never accidentally treated as an admin. */
  static async myRole(): Promise<'admin' | 'member'> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return 'member';
    const { data, error } = await supabase
      .from('app_users').select('role').eq('id', auth.user.id).maybeSingle();
    if (error || !data) return 'member';
    return data.role === 'admin' ? 'admin' : 'member';
  }

  static async listUsers(): Promise<AppUser[]> {
    const { data, error } = await supabase
      .from('app_users').select('*').order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id, email: r.email, role: r.role, createdAt: r.created_at,
    }));
  }

  /** Admin-only in practice — RLS returns nothing for non-admins rather than
   *  erroring, so the caller just sees an empty log. */
  static async listAudit(limit = 500): Promise<AuditRecord[]> {
    const { data, error } = await supabase
      .from('audit_log').select('*')
      .order('performed_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data as AuditRow[] ?? []).map(rowToAudit);
  }

  /** How many entries are older than `days`, so the screen can say what a
   *  prune would remove before it removes it. */
  static async countOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const { count, error } = await supabase
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .lt('performed_at', cutoff);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  /** Every entry older than `days`, for the copy taken before a prune. */
  static async listOlderThan(days: number): Promise<AuditRecord[]> {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const rows = await fetchAllRows<AuditRow>((from, to) =>
      supabase.from('audit_log').select('*', { count: 'exact' })
        .lt('performed_at', cutoff)
        .order('performed_at', { ascending: false })
        .range(from, to));
    return rows.map(rowToAudit);
  }

  /**
   * Delete the entries older than `days`.
   *
   * The database refuses anything inside the last seven days whatever is
   * asked for here (migration 0024), so a change made this week cannot be
   * erased in the same week. The guard below is only so the screen fails
   * with a sentence rather than a silent no-op.
   *
   * Returns how many rows went, which is the count the server actually
   * deleted rather than the estimate shown beforehand.
   */
  static async pruneOlderThan(days: number): Promise<number> {
    if (days < 7) throw new Error('The last seven days cannot be cleared.');
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const { data, error } = await supabase
      .from('audit_log').delete().lt('performed_at', cutoff).select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }

  static async setRole(userId: string, role: 'admin' | 'member'): Promise<void> {
    const { error } = await supabase.from('app_users').update({ role }).eq('id', userId);
    if (error) throw new Error(error.message);
  }

  static subscribeAudit(onData: (rows: AuditRecord[]) => void, limit = 500) {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const rows = await AuditService.listAudit(limit);
        if (!cancelled) onData(rows);
      } catch (e) { console.error('audit_log error', e); }
    };
    fetchAll();
    const channel = supabase
      .channel('audit-log')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_log' }, fetchAll)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }
}
