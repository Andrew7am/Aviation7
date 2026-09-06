import React, { useEffect, useMemo, useState } from 'react';
import { AuditService, AuditRecord, AppUser } from '../services/AuditService';
import { Search, Download, ShieldCheck, ShieldOff, Users, Activity, Undo2 } from 'lucide-react';
import { undoableAction, undoneAuditId } from '../core/helpers/undoableAction';
import * as XLSX from 'xlsx';

const ACTION_COLORS: Record<string, string> = {
  EDIT_TICKET:   'bg-blue-100 text-blue-700',
  DELETE:        'bg-red-100 text-red-700',
  DELETE_VENDOR: 'bg-red-100 text-red-700',
  ADD_VENDOR:    'bg-emerald-100 text-emerald-700',
  EDIT_VENDOR:   'bg-amber-100 text-amber-700',
  IMPORT:        'bg-violet-100 text-violet-700',
  MANUAL_ENTRY:  'bg-cyan-100 text-cyan-700',
  UPDATE_REQ:    'bg-blue-100 text-blue-700',
  BULK_UPDATE_REQ: 'bg-indigo-100 text-indigo-700',
  UPDATE_CLOSED: 'bg-teal-100 text-teal-700',
  BULK_UPDATE_CLOSED: 'bg-teal-100 text-teal-700',
  TOPUP:         'bg-emerald-100 text-emerald-700',
};

/** A single entity reads as itself; a list of them reads as a count. */
function entityLabel(entity: string): string {
  if (!entity) return '—';
  const n = entity.split(',').filter(s => s.trim()).length;
  return n > 1 ? `${n} tickets` : entity;
}

export const ActivityLog: React.FC<{
  currentUserId: string;
  /** Reverses one logged action. Only the close/reopen entries offer it —
   *  see undoableAction. */
  onUndo?: (entry: AuditRecord) => Promise<void>;
}> = ({ currentUserId, onUndo }) => {
  const [rows, setRows]       = useState<AuditRecord[]>([]);
  const [users, setUsers]     = useState<AppUser[]>([]);
  const [search, setSearch]   = useState('');
  const [actorFilter, setActorFilter]   = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [tab, setTab]         = useState<'activity' | 'people'>('activity');
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState('');

  useEffect(() => {
    const unsub = AuditService.subscribeAudit(r => { setRows(r); setLoading(false); });
    AuditService.listUsers().then(setUsers).catch(console.error);
    return unsub;
  }, []);

  const actors  = useMemo(() => ['ALL', ...Array.from(new Set(rows.map(r => r.actorEmail)))], [rows]);
  const actions = useMemo(() => ['ALL', ...Array.from(new Set(rows.map(r => r.action)))], [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (actorFilter !== 'ALL'  && r.actorEmail !== actorFilter) return false;
    if (actionFilter !== 'ALL' && r.action !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.entity} ${r.detail} ${r.actorEmail} ${r.action}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, search, actorFilter, actionFilter]);

  /** Per-person tally — answers "who changed things and who didn't". */
  const perActor = useMemo(() => {
    const counts = new Map<string, { edits: number; deletes: number; other: number; last: string }>();
    for (const u of users) counts.set(u.email, { edits: 0, deletes: 0, other: 0, last: '' });
    for (const r of rows) {
      const cur = counts.get(r.actorEmail) ?? { edits: 0, deletes: 0, other: 0, last: '' };
      if (r.action.startsWith('EDIT') || r.action.includes('UPDATE')) cur.edits++;
      else if (r.action.startsWith('DELETE')) cur.deletes++;
      else cur.other++;
      if (!cur.last || r.performedAt > cur.last) cur.last = r.performedAt;
      counts.set(r.actorEmail, cur);
    }
    return counts;
  }, [rows, users]);

  /** Actions already taken back. Their own reversal names them, so the button
   *  can retire itself instead of offering to redo the mistake. */
  const undone = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) { const id = undoneAuditId(r); if (id) s.add(id); }
    return s;
  }, [rows]);

  const runUndo = async (r: AuditRecord) => {
    const u = undoableAction(r);
    if (!u || !onUndo) return;
    if (!confirm(u.question)) return;
    setUndoing(r.id);
    try { await onUndo(r); }
    catch (e) { alert(`Could not undo: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setUndoing(''); }
  };

  const changeRole = async (u: AppUser) => {
    const next = u.role === 'admin' ? 'member' : 'admin';
    if (u.id === currentUserId && next === 'member') {
      if (!confirm('Remove your own admin access? You will lose the Activity Log.')) return;
    }
    await AuditService.setRole(u.id, next);
    setUsers(await AuditService.listUsers());
  };

  const exportLog = () => {
    const data = filtered.map(r => ({
      'When':    new Date(r.performedAt).toLocaleString(),
      'Who':     r.actorEmail,
      'Action':  r.action,
      'Type':    r.entityType,
      'Entity':  r.entity,
      'Details': r.detail,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Activity');
    XLSX.writeFile(wb, 'Activity_Log.xlsx');
  };

  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="flex flex-col h-full bg-slate-100">
      <div className="px-6 py-4 bg-white border-b border-slate-200 shrink-0 flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Activity &amp; Access — Admin Only</h2>
        <div className="flex gap-1">
          <button onClick={() => setTab('activity')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase rounded border transition-colors ${tab === 'activity' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`}>
            <Activity className="w-3 h-3" /> Activity ({rows.length})
          </button>
          <button onClick={() => setTab('people')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase rounded border transition-colors ${tab === 'people' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`}>
            <Users className="w-3 h-3" /> People ({users.length})
          </button>
        </div>
      </div>

      {tab === 'activity' && (
        <>
          <div className="px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input type="text" placeholder="Search ticket, detail, person..." value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-7 pr-2 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-mono w-56 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <select value={actorFilter} onChange={e => setActorFilter(e.target.value)}
              className="px-2 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold uppercase focus:outline-none">
              {actors.map(a => <option key={a} value={a}>{a === 'ALL' ? 'All people' : a}</option>)}
            </select>
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
              className="px-2 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold uppercase focus:outline-none">
              {actions.map(a => <option key={a} value={a}>{a === 'ALL' ? 'All actions' : a}</option>)}
            </select>
            <span className="text-[10px] font-mono text-slate-400">{filtered.length} entries</span>
            <button onClick={exportLog}
              className="ml-auto px-2 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 flex items-center gap-1">
              <Download className="w-3 h-3" /> Export
            </button>
          </div>

          <div className="flex-1 mx-4 my-4 bg-white border border-slate-200 rounded-lg overflow-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                  {['When', 'Who', 'Action', 'Type', 'Entity', 'What changed', ''].map((c, i) => (
                    <th key={c || `c${i}`} className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-xs font-mono">
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtWhen(r.performedAt)}</td>
                    <td className="px-3 py-2 text-slate-700 font-sans">{r.actorEmail}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold ${ACTION_COLORS[r.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-[10px]">{r.entityType || '—'}</td>
                    {/* A bulk action lists every id it touched. Printed in
                        full, sixty of them push the rest of the row off the
                        screen — including the Undo button. The count is what
                        is readable; the ids stay one hover away. */}
                    <td className="px-3 py-2 font-bold text-slate-700 max-w-[220px] truncate"
                        title={r.entity}>
                      {entityLabel(r.entity)}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-[10px] max-w-[420px]">{r.detail || '—'}</td>
                    {/* Undo sits on the row that did the thing, so taking it
                        back is one click from seeing it — not a screen away. */}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {undone.has(r.id) ? (
                        <span className="text-[9px] font-sans font-bold text-slate-400 px-1.5 py-0.5 rounded bg-slate-100"
                              title="Already taken back — the entry below this one is the reversal.">
                          UNDONE
                        </span>
                      ) : undoableAction(r) && onUndo ? (
                        <button onClick={() => runUndo(r)} disabled={undoing === r.id}
                          title="Put these tickets back the way they were"
                          className="px-2 py-1 rounded text-[9px] font-sans font-bold uppercase border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-40 flex items-center gap-1 ml-auto">
                          <Undo2 className="w-3 h-3" />
                          {undoing === r.id ? 'Undoing…' : 'Undo'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-sans text-sm">
                    {loading ? 'Loading…' : 'No activity recorded yet. Edits and deletions will appear here.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'people' && (
        <div className="flex-1 mx-4 my-4 bg-white border border-slate-200 rounded-lg overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                {['Email', 'Role', 'Edits', 'Deletions', 'Other', 'Last activity', ''].map(c => (
                  <th key={c} className="px-4 py-2 text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-xs">
              {users.map(u => {
                const s = perActor.get(u.email) ?? { edits: 0, deletes: 0, other: 0, last: '' };
                const inactive = s.edits + s.deletes + s.other === 0;
                return (
                  <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-sans font-bold text-slate-700">
                      {u.email}{u.id === currentUserId && <span className="ml-1.5 text-[9px] text-blue-500">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${u.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-blue-600">{s.edits || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-red-600">{s.deletes || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{s.other || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-400 text-[10px]">
                      {s.last ? fmtWhen(s.last) : <span className="text-slate-300">never — no changes made</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => changeRole(u)}
                        className={`px-2 py-1 rounded text-[9px] font-bold uppercase border flex items-center gap-1 ml-auto transition-colors ${
                          u.role === 'admin'
                            ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
                            : 'border-violet-200 text-violet-700 hover:bg-violet-50'
                        }`}>
                        {u.role === 'admin' ? <><ShieldOff className="w-3 h-3" /> Revoke admin</> : <><ShieldCheck className="w-3 h-3" /> Make admin</>}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-sans text-sm">No registered users yet.</td></tr>
              )}
            </tbody>
          </table>
          <p className="px-4 py-3 text-[10px] text-slate-400 font-mono border-t border-slate-100">
            Everyone who signs in can view and edit the tickets. Only admins see this screen.
          </p>
        </div>
      )}
    </div>
  );
};
