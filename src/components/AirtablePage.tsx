import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Loader2, Search, Download, CheckCircle2, AlertTriangle, ArrowRight, Table2 } from 'lucide-react';
import type { Ticket } from '../types';
import { AirtableService, type AirtableNotice, type SyncState, type LiveRecord, type ChangeRow } from '../services/AirtableService';
import { docKey } from '../core/integrations/airtableNotices';
import { teamFixes, FIX_LABEL, NUMBERED_SOURCES, type FixKind } from '../core/integrations/airtableFixes';
import { portalSource } from '../core/config/teamPortals';

/**
 * The aviation team's Airtable, in one place.
 *
 * The bell says what needs a decision; this is everything behind it: how
 * fresh the copy is, every notice and what became of it, every field they
 * changed, their tickets as they are now against ours, and what they have to
 * put right on their side.
 */
type Tab = 'overview' | 'notices' | 'changes' | 'tickets' | 'fixes';

const fmt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const ago = (iso?: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const xlsx = () => import('xlsx');

const KIND_LABEL: Record<string, string> = {
  REQ_CHANGED: 'Request changed', ONLINE_TICKET: 'Bought online', NAME: 'Passenger name', CABIN: 'Cabin',
  REFUND: 'Refunded on theirs', VOID: 'Voided on theirs', PRICE: 'Cost changed', NOT_IN_BOOKS: 'Not in our books',
};
const APPROVAL = new Set(['ONLINE_TICKET', 'NOT_IN_BOOKS']);
const ACCEPT_LABEL: Record<string, string> = {
  REQ_CHANGED: 'Move ours', ONLINE_TICKET: 'Open in To Review', NOT_IN_BOOKS: 'Open in To Review', NAME: 'Fill in', CABIN: 'Fill in', REFUND: 'Seen', VOID: 'Seen', PRICE: 'Seen',
};

export const AirtablePage: React.FC<{
  tickets: Ticket[];
  notices: AirtableNotice[];
  sync: SyncState | null;
  canEdit: boolean;
  onAccept: (list: AirtableNotice[]) => Promise<void>;
  onDismiss: (list: AirtableNotice[]) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onOpenSheetCheck: () => void;
}> = ({ tickets, notices, sync, canEdit, onAccept, onDismiss, onSyncNow, onOpenSheetCheck }) => {
  const svc = useMemo(() => new AirtableService(), []);
  const [tab, setTab] = useState<Tab>('overview');
  const [records, setRecords] = useState<LiveRecord[] | null>(null);
  const [changes, setChanges] = useState<ChangeRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [noticeState, setNoticeState] = useState<'OPEN' | 'INFO' | 'DECIDED'>('OPEN');
  const [fixKind, setFixKind] = useState<FixKind | 'ALL'>('ALL');

  const load = async () => {
    try {
      const [r, c] = await Promise.all([svc.liveRecords(), svc.changes()]);
      setRecords(r); setChanges(c);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr('');
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };

  const ours = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of tickets) { const k = docKey(t.ticketNo); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
    return m;
  }, [tickets]);
  const held = (r: LiveRecord) => r.serials.some(s => ours.has(docKey(s))) || (!!r.pnr && ours.has(docKey(r.pnr)));

  const fixes = useMemo(() => records ? teamFixes(records, p => NUMBERED_SOURCES.has(portalSource(p).source)) : [], [records]);
  // Waiting for a decision: tickets of theirs in nobody's books. Everything
  // else they changed is listed for information and asks nothing.
  const openNotices = notices.filter(n => n.state === 'OPEN' && APPROVAL.has(n.kind));
  const infoNotices = notices.filter(n => n.state === 'OPEN' && !APPROVAL.has(n.kind));
  const shownNotices = noticeState === 'OPEN' ? openNotices : noticeState === 'INFO' ? infoNotices : notices.filter(n => n.state !== 'OPEN');
  const needle = q.trim().toUpperCase().replace(/\s+/g, '');
  const hit = (...xs: (string | null | undefined)[]) => !needle || xs.some(x => String(x || '').toUpperCase().replace(/\s+/g, '').includes(needle));

  const tabs: [Tab, string, number | null][] = [
    ['overview', 'Overview', null], ['notices', 'Notifications', openNotices.length],
    ['changes', 'Changes', changes?.length ?? null], ['tickets', 'Their tickets', records?.length ?? null],
    ['fixes', 'For the team to fix', fixes.length || null],
  ];
  const stale = sync?.lastOkAt ? Date.now() - new Date(sync.lastOkAt).getTime() > 10 * 60000 : true;

  const exportFixes = async () => {
    const XLSX = await xlsx();
    const rows = fixes.filter(f => fixKind === 'ALL' || f.kind === fixKind).map(f => ({
      'Problem': FIX_LABEL[f.kind], 'Ticket column': f.row.ticket_cell, 'PNR': f.row.pnr, 'Status': f.row.status,
      'Request': f.row.req_num, 'Portal': f.row.portal, 'Team member': f.row.team_member,
      'Issued': f.row.issued_at ? f.row.issued_at.slice(0, 10) : '', 'Net cost': f.row.net_cost ?? '', 'Currency': f.row.currency, 'What to fix': f.what,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'To fix');
    XLSX.writeFile(wb, 'Airtable - for the team to fix.xlsx');
  };

  return (
    <div className="p-4 space-y-3 h-full overflow-auto">
      <div className="flex items-center gap-2 flex-wrap">
        <Table2 className="w-4 h-4 text-purple-600" />
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Airtable</h2>
        <span className="text-[11px] text-slate-400">The aviation team's "Aviation Tickets", kept here two minutes old at most.</span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => { setTab(k); setQ(''); }}
            className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px ${tab === k ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}{n != null && <span className="ml-1.5 text-[10px] font-normal text-slate-400">{n}</span>}
          </button>
        ))}
      </div>
      {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 flex gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}

      {tab === 'overview' && (
        <div className="space-y-3">
          <div className={`rounded-lg border px-4 py-3 text-xs flex flex-wrap items-center gap-3
            ${sync?.lastError ? 'bg-red-50 border-red-200 text-red-800' : stale ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            {sync?.lastError ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            <span className="flex-1">
              {sync?.lastError ? <>Last sync failed: {sync.lastError}</>
                : <>Synced <b>{ago(sync?.lastOkAt)}</b> ({when(sync?.lastOkAt)}). It runs every two minutes on its own, and reads the whole table once an hour.</>}
            </span>
            <button onClick={() => act('sync', async () => { await onSyncNow(); await load(); })} disabled={busy === 'sync'}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold px-3 py-1.5 rounded hover:bg-slate-50">
              {busy === 'sync' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync now
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {([
              ['Their tickets', records?.length ?? sync?.recordCount ?? '—', 'tickets'],
              ['Issued in the last 7 days', records ? records.filter(r => r.issued_at && Date.now() - new Date(r.issued_at).getTime() < 7 * 864e5).length : '—', 'tickets'],
              ['Waiting for you', openNotices.length, 'notices'],
              ['Changes logged', changes?.length ?? '—', 'changes'],
              ['For the team to fix', fixes.length, 'fixes'],
            ] as [string, number | string, Tab][]).map(([label, v, t]) => (
              <button key={label} onClick={() => setTab(t)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-left hover:border-purple-300">
                <div className="font-mono font-black text-lg text-slate-800">{v}</div>
                <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
              </button>
            ))}
          </div>
          <button onClick={onOpenSheetCheck}
            className="flex items-center gap-2 bg-purple-600 text-white text-xs font-bold px-3 py-2 rounded hover:bg-purple-700">
            Compare with our books — Team Sheet Check, live <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {tab === 'notices' && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            {(['OPEN', 'INFO', 'DECIDED'] as const).map(s => (
              <button key={s} onClick={() => setNoticeState(s)}
                className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${noticeState === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                {s === 'OPEN' ? `Waiting for you ${openNotices.length}` : s === 'INFO' ? `For information ${infoNotices.length}` : 'Decided (last 7 days)'}
              </button>
            ))}
          </div>
          <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
            {shownNotices.map(n => (
              <div key={n.id} className="px-4 py-2.5 flex flex-wrap items-start gap-3">
                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">{KIND_LABEL[n.kind] ?? n.kind}</span>
                <div className="flex-1 min-w-[240px]">
                  <div className="text-xs font-bold text-slate-700">{n.title}</div>
                  {n.detail && <div className="text-[11px] text-slate-500">{n.detail}</div>}
                  <div className="text-[10px] text-slate-400 mt-0.5">{when(n.createdAt)}{n.state !== 'OPEN' ? ` · ${n.state.toLowerCase()} by ${n.decidedBy || '—'} ${when(n.decidedAt)}` : ''}</div>
                </div>
                {canEdit && n.state === 'OPEN' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => act(n.id, () => onDismiss([n]))} disabled={!!busy} className="text-[10px] text-slate-400 hover:text-red-600">Dismiss</button>
                    <button onClick={() => act(n.id, () => onAccept([n]))} disabled={!!busy}
                      className="text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded hover:bg-emerald-700">
                      {busy === n.id ? '…' : ACCEPT_LABEL[n.kind] ?? 'Accept'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!shownNotices.length && (
              <div className="px-4 py-8 text-center text-xs text-slate-400">Nothing here.</div>
            )}
          </div>
        </div>
      )}

      {(tab === 'changes' || tab === 'tickets' || tab === 'fixes') && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ticket, PNR, request, name…"
              className="pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded w-64 focus:outline-none focus:ring-2 focus:ring-purple-500/20" />
          </div>
          {tab === 'tickets' && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> Only issued ones with no ticket of ours by that number
              <span className="text-slate-400">— what is really missing is the comparison's answer (Overview → Team Sheet Check)</span>
            </label>
          )}
          {tab === 'fixes' && (
            <>
              <select value={fixKind} onChange={e => setFixKind(e.target.value as FixKind | 'ALL')}
                className="text-[11px] border border-slate-200 rounded px-2 py-1.5">
                <option value="ALL">Every problem ({fixes.length})</option>
                {(Object.keys(FIX_LABEL) as FixKind[]).map(k => (
                  <option key={k} value={k}>{FIX_LABEL[k]} ({fixes.filter(f => f.kind === k).length})</option>
                ))}
              </select>
              <button onClick={exportFixes} className="flex items-center gap-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded hover:bg-blue-700">
                <Download className="w-3.5 h-3.5" /> Export for the team
              </button>
            </>
          )}
          {!records && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
      )}

      {tab === 'changes' && changes && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto max-h-[70vh]">
          <table className="w-full text-left min-w-[720px] text-xs">
            <thead className="bg-slate-50 sticky top-0"><tr className="text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">When</th><th className="px-3 py-2">Ticket</th><th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Was</th><th className="px-3 py-2">Now</th></tr></thead>
            <tbody>
              {changes.filter(c => hit(c.ticket_cell, c.field, c.old_value, c.new_value)).slice(0, 500).map(c => (
                <tr key={c.id} className="border-t border-slate-50">
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{when(c.changed_at)}</td>
                  <td className="px-3 py-1.5 font-mono">{(c.ticket_cell || '').replace(/\s+/g, ' ').slice(0, 40)}</td>
                  <td className="px-3 py-1.5 font-bold text-slate-600">{c.field}</td>
                  <td className="px-3 py-1.5 text-slate-400 line-through">{c.old_value || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-800">{c.new_value || '—'}</td>
                </tr>
              ))}
              {!changes.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No changes yet - they are logged from the first sync on.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'tickets' && records && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto max-h-[70vh]">
          <table className="w-full text-left min-w-[1000px] text-xs">
            <thead className="bg-slate-50 sticky top-0"><tr className="text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">Ticket</th><th className="px-3 py-2">PNR</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Request</th><th className="px-3 py-2">Client</th><th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2">Portal</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Issued</th><th className="px-3 py-2">Ours</th></tr></thead>
            <tbody>
              {records.filter(r => (!onlyMissing || (/issued|reissue/i.test(r.status) && !held(r)))
                && hit(r.ticket_cell, r.pnr, r.req_num, r.client_name, r.team_member)).slice(0, 500).map(r => (
                <tr key={r.record_id} className="border-t border-slate-50">
                  <td className="px-3 py-1.5 font-mono whitespace-pre-line">{r.ticket_cell.slice(0, 60)}</td>
                  <td className="px-3 py-1.5 font-mono">{r.pnr}</td>
                  <td className="px-3 py-1.5">{r.status}</td>
                  <td className="px-3 py-1.5 font-mono text-purple-700">{r.req_num || '—'}</td>
                  <td className="px-3 py-1.5">{r.client_name}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(r.net_cost)} <span className="text-[9px] text-slate-400">{r.currency}</span></td>
                  <td className="px-3 py-1.5 text-slate-500">{r.portal}</td>
                  <td className="px-3 py-1.5 text-slate-500">{r.team_member}</td>
                  <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{r.issued_at ? r.issued_at.slice(0, 10) : '—'}</td>
                  <td className="px-3 py-1.5">{held(r) ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <span className="text-[10px] text-slate-400" title="No ticket of ours under this number or PNR - a conjunction coupon, a reissue or an EMD may still be held another way. The Team Sheet Check says what is really missing.">no number match</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'fixes' && records && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto max-h-[70vh]">
          <table className="w-full text-left min-w-[900px] text-xs">
            <thead className="bg-slate-50 sticky top-0"><tr className="text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">Problem</th><th className="px-3 py-2">Ticket column</th><th className="px-3 py-2">PNR</th>
              <th className="px-3 py-2">Status</th><th className="px-3 py-2">Request</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">What to fix</th></tr></thead>
            <tbody>
              {fixes.filter(f => (fixKind === 'ALL' || f.kind === fixKind) && hit(f.row.ticket_cell, f.row.pnr, f.row.req_num, f.row.team_member)).map((f, i) => (
                <tr key={`${f.row.record_id}-${f.kind}-${i}`} className="border-t border-slate-50 align-top">
                  <td className="px-3 py-1.5 font-bold text-amber-700 whitespace-nowrap">{FIX_LABEL[f.kind]}</td>
                  <td className="px-3 py-1.5 font-mono">{f.row.ticket_cell.replace(/\s+/g, ' ').slice(0, 50) || '—'}</td>
                  <td className="px-3 py-1.5 font-mono">{f.row.pnr}</td>
                  <td className="px-3 py-1.5">{f.row.status}</td>
                  <td className="px-3 py-1.5 font-mono text-purple-700">{f.row.req_num || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-500">{f.row.team_member}</td>
                  <td className="px-3 py-1.5 text-slate-600">{f.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
