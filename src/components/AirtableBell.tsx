import React, { useMemo, useState } from 'react';
import { Bell, RefreshCw, X, Check, Loader2, AlertTriangle } from 'lucide-react';
import type { AirtableNotice, SyncState } from '../services/AirtableService';

/**
 * What changed on the aviation team's Airtable, waiting for a person.
 *
 * Every notice says what accepting it does, and nothing happens until
 * somebody accepts. Names and cabins come in numbers, so they can be taken
 * together; a request moved, a ticket bought online, are read one at a time.
 */
const KIND: Record<string, { label: string; accept: string; tone: string }> = {
  REQ_CHANGED:   { label: 'Request changed',   accept: 'Move ours',        tone: 'bg-purple-100 text-purple-800' },
  ONLINE_TICKET: { label: 'Bought online',     accept: 'Open in To Review', tone: 'bg-blue-100 text-blue-800' },
  NOT_IN_BOOKS:  { label: 'Not in our books',  accept: 'Open in To Review', tone: 'bg-red-100 text-red-800' },
  NAME:          { label: 'Passenger name',    accept: 'Fill in',          tone: 'bg-emerald-100 text-emerald-800' },
  CABIN:         { label: 'Cabin',             accept: 'Fill in',          tone: 'bg-emerald-100 text-emerald-800' },
  REFUND:        { label: 'Refunded on theirs', accept: 'Seen',            tone: 'bg-amber-100 text-amber-800' },
  VOID:          { label: 'Voided on theirs',  accept: 'Seen',             tone: 'bg-red-100 text-red-800' },
  PRICE:         { label: 'Cost changed',      accept: 'Seen',             tone: 'bg-slate-100 text-slate-700' },
};
const ORDER = ['NOT_IN_BOOKS', 'ONLINE_TICKET'];
/** The only notices that ask for a decision: a ticket on their sheet that is
 *  in nobody's books - add it or not. Names, cabins, routes and requests are
 *  filled on their own; the rest is on the Airtable page, for information. */
export const NEEDS_APPROVAL = new Set(ORDER);

const ago = (iso?: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export const AirtableBell: React.FC<{
  notices: AirtableNotice[];
  sync: SyncState | null;
  canEdit: boolean;
  onAccept: (list: AirtableNotice[]) => Promise<void>;
  onDismiss: (list: AirtableNotice[]) => Promise<void>;
  onSyncNow: () => Promise<void>;
}> = ({ notices, sync, canEdit, onAccept, onDismiss, onSyncNow }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [err, setErr] = useState('');
  const openOnes = useMemo(() => notices.filter(n => n.state === 'OPEN' && NEEDS_APPROVAL.has(n.kind)), [notices]);
  const groups = useMemo(() => ORDER.map(k => [k, openOnes.filter(n => n.kind === k)] as const).filter(([, l]) => l.length), [openOnes]);
  const stale = sync?.lastOkAt ? Date.now() - new Date(sync.lastOkAt).getTime() > 10 * 60000 : true;

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr('');
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };

  return (
    <>
      <button onClick={() => setOpen(o => !o)} title="Airtable - changes on the team's sheet"
        className="relative text-white/70 hover:text-white p-1.5">
        <Bell className="w-4 h-4" />
        {openOnes.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {openOnes.length > 99 ? '99+' : openOnes.length}
          </span>
        )}
        {stale && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-amber-400" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="absolute right-2 sm:right-4 top-14 w-[calc(100vw-1rem)] sm:w-[440px] max-h-[80vh] bg-white text-slate-800 rounded-lg shadow-2xl border border-slate-200 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <Bell className="w-4 h-4 text-purple-600" />
              <div className="flex-1">
                <div className="text-xs font-bold">Team's Airtable</div>
                <div className={`text-[10px] ${sync?.lastError ? 'text-red-600' : stale ? 'text-amber-600' : 'text-slate-500'}`}>
                  {sync?.lastError ? `Last sync failed: ${sync.lastError.slice(0, 80)}`
                    : `Synced ${ago(sync?.lastOkAt)} · ${sync?.recordCount ?? '—'} tickets · every 2 minutes`}
                </div>
              </div>
              <button onClick={() => act('sync', onSyncNow)} disabled={busy === 'sync'} title="Sync now"
                className="text-[10px] font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-purple-50">
                {busy === 'sync' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Sync now
              </button>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-4 h-4" /></button>
            </div>
            {err && <div className="px-4 py-2 text-[11px] text-red-700 bg-red-50 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{err}</div>}

            <div className="overflow-auto flex-1">
              {!groups.length && <div className="px-4 py-8 text-center text-xs text-slate-400">Nothing waiting. A ticket on their sheet that is not in our books shows here.</div>}
              {groups.map(([k, list]) => (
                <div key={k} className="border-b border-slate-100">
                  <div className="px-4 py-2 bg-slate-50 flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KIND[k]?.tone ?? ''}`}>{KIND[k]?.label ?? k}</span>
                    <span className="text-[10px] text-slate-400">{list.length}</span>
                    <span className="flex-1" />
                    {canEdit && list.length > 1 && !NEEDS_APPROVAL.has(k) && (
                      <button onClick={() => act(`all-${k}`, () => onAccept(list))} disabled={!!busy}
                        className="text-[10px] font-bold text-emerald-700 hover:underline">
                        {busy === `all-${k}` ? 'Working…' : `${KIND[k]?.accept ?? 'Accept'} - all ${list.length}`}
                      </button>
                    )}
                  </div>
                  {list.map(n => (
                    <div key={n.id} className="px-4 py-2.5 border-t border-slate-50">
                      <div className="text-[11px] font-bold text-slate-700 leading-snug">{n.title}</div>
                      {n.detail && <div className="text-[11px] text-slate-500 leading-snug mt-0.5">{n.detail}</div>}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-slate-400">{ago(n.createdAt)}{n.reqNum ? ` · ${n.reqNum}` : ''}</span>
                        <span className="flex-1" />
                        {canEdit && (
                          <>
                            <button onClick={() => act(n.id, () => onDismiss([n]))} disabled={!!busy}
                              className="text-[10px] text-slate-400 hover:text-red-600">Dismiss</button>
                            <button onClick={() => act(n.id, () => onAccept([n]))} disabled={!!busy}
                              className="text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded hover:bg-emerald-700 flex items-center gap-1">
                              {busy === n.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              {KIND[n.kind]?.accept ?? 'Accept'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
