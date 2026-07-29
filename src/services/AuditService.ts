import { supabase } from '../utils/supabase';

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
