import React, { useEffect, useMemo, useState } from 'react';
import { Store, Gauge, BellRing, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { AppSettingsService, type LoadedSettings, type RequestAlertSetting } from '../services/AppSettingsService';
import { BUILTIN_SOURCES } from '../core/config/sources';
import { type VendorSetting, type VendorCurrencyCode } from '../core/config/appSettings';
import { type AirlineLimit } from '../core/helpers/airlineLimit';

/**
 * What an admin changes here rather than in the code (1 Nov 2026): the
 * vendors and their currencies, an airline's weekly limit on IATA, and the
 * request alerts. Each section saves on its own and says so in the Activity
 * log.
 */
const svc = new AppSettingsService();
const CURRENCIES: VendorCurrencyCode[] = ['SAR', 'AED', 'USD', 'EUR'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// The built-in rule, before anything set here: dirhams for these, riyals for the rest.
const AED_BUILTIN = /(iata|rts|gold medal|goldmedal|flyadeal dxb|air arabia|airarabia|flydubai|fly dubai|riyadh air|riyadhair|turkish|emirates|websales)/i;
const builtinCurrency = (name: string): VendorCurrencyCode => (AED_BUILTIN.test(name) ? 'AED' : 'SAR');

const input = 'border border-slate-200 rounded px-2 py-1 text-xs bg-white text-slate-800 focus:outline-none focus:border-blue-400';
const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider disabled:opacity-50';

const Section: React.FC<{ icon: React.ReactNode; title: string; note: string; action?: React.ReactNode; children: React.ReactNode }> =
  ({ icon, title, note, action, children }) => (
  <section className="bg-white border border-slate-200 rounded-lg shadow-sm">
    <header className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
      <div>
        <div className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1.5">{icon} {title}</div>
        <div className="text-[10px] text-slate-400 mt-0.5">{note}</div>
      </div>
      {action}
    </header>
    <div className="p-4">{children}</div>
  </section>
);

export const AdminSettings: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [loaded, setLoaded] = useState<LoadedSettings | null>(null);
  const [alerts, setAlerts] = useState<RequestAlertSetting[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState('');

  const reload = async () => {
    try {
      const [s, a] = await Promise.all([svc.load(), svc.requestAlerts()]);
      setLoaded(s); setAlerts(a); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void reload(); }, []);

  const run = async (key: string, what: string, fn: () => Promise<void>) => {
    setBusy(key); setError(''); setSaved('');
    try { await fn(); setSaved(what); await reload(); onChanged?.(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  if (!loaded) return <div className="text-xs text-slate-400">{error || 'Loading settings…'}</div>;
  return (
    <div className="space-y-6">
      {error && <div className="rounded px-3 py-2 bg-red-50 border border-red-200 text-[11px] text-red-700">{error}</div>}
      {saved && <div className="rounded px-3 py-2 bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800">Saved: {saved}</div>}
      <Vendors loaded={loaded} busy={busy === 'vendors'} onSave={(list, detail) => run('vendors', 'vendors and currencies', async () => {
        await svc.saveVendors(list, loaded); await svc.audit('Vendors', detail);
      })} />
      <Limits loaded={loaded} busy={busy === 'limits'} onSave={(list, detail) => run('limits', 'weekly limit', async () => {
        await svc.saveAirlineLimits(list, loaded); await svc.audit('Weekly limit', detail);
      })} />
      <Alerts alerts={alerts} busy={busy} onSave={(a, isNew, changed) => run(`alert:${a.id}`, `alert ${a.reqNum}`, async () => {
        await svc.saveRequestAlert(a, isNew, changed);
        await svc.audit(a.reqNum.toUpperCase(), `${isNew ? 'Alert added' : 'Alert changed'}: ${fmt(a.threshold)} ${a.currency} -> ${a.recipients.join(', ')}`);
      })} onDelete={a => run(`alert:${a.id}`, `alert ${a.reqNum} removed`, async () => {
        await svc.deleteRequestAlert(a.id); await svc.audit(a.reqNum, `Alert removed (${fmt(a.threshold)} ${a.currency})`);
      })} />
    </div>
  );
};

/* ── vendors ─────────────────────────────────────────────────────────── */
const Vendors: React.FC<{ loaded: LoadedSettings; busy: boolean; onSave: (v: VendorSetting[], detail: string) => void }> =
  ({ loaded, busy, onSave }) => {
  const builtin = useMemo(() => BUILTIN_SOURCES.filter(s => s !== 'Airline Website'), []);
  const isBuiltin = (n: string) => builtin.some(b => b.toLowerCase() === n.trim().toLowerCase());
  // Every built-in vendor, at its currency as set here or by the rule, then the ones added here.
  const initial = useMemo(() => [
    ...builtin.map(name => ({ name, currency: loaded.vendors.find(v => v.name.toLowerCase() === name.toLowerCase())?.currency ?? builtinCurrency(name) })),
    ...loaded.vendors.filter(v => !isBuiltin(v.name)),
  ], [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState(initial);
  const [name, setName] = useState('');
  const [cur, setCur] = useState<VendorCurrencyCode>('SAR');
  useEffect(() => setRows(initial), [initial]);

  // Saved: the vendors added here, and a built-in one only where its currency was changed.
  const toSave = rows.filter(r => !isBuiltin(r.name) || r.currency !== builtinCurrency(r.name));
  const dirty = JSON.stringify(toSave) !== JSON.stringify(loaded.vendors);
  const add = () => {
    const n = name.trim();
    if (!n || rows.some(r => r.name.toLowerCase() === n.toLowerCase())) return;
    setRows([...rows, { name: n, currency: cur }]); setName('');
  };
  return (
    <Section icon={<Store className="w-3.5 h-3.5" />} title="Vendors and their currencies"
      note="A vendor added here appears in every vendor list. Each vendor's tickets are kept in its currency - a change applies to tickets recorded or edited from now on."
      action={<button disabled={!dirty || busy} onClick={() => onSave(toSave, toSave.map(v => `${v.name} ${v.currency}`).join(', ') || 'built-in rule only')}
        className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save</button>}>
      <table className="w-full text-xs">
        <thead><tr className="text-[9px] uppercase text-slate-400 text-left"><th className="py-1">Vendor</th><th>Currency</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className="border-t border-slate-100">
              <td className="py-1.5 font-mono text-slate-700">{r.name}{isBuiltin(r.name) && <span className="ml-2 text-[9px] text-slate-400">built in</span>}</td>
              <td><select className={input} value={r.currency}
                onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, currency: e.target.value as VendorCurrencyCode } : x))}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></td>
              <td className="text-right">{!isBuiltin(r.name) && (
                <button title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 mt-3 items-center">
        <input className={`${input} flex-1`} placeholder="New vendor name, as it should read everywhere" value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <select className={input} value={cur} onChange={e => setCur(e.target.value as VendorCurrencyCode)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
        <button onClick={add} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}><Plus className="w-3 h-3" /> Add</button>
      </div>
    </Section>
  );
};

/* ── weekly limits ───────────────────────────────────────────────────── */
const Limits: React.FC<{ loaded: LoadedSettings; busy: boolean; onSave: (l: AirlineLimit[], detail: string) => void }> =
  ({ loaded, busy, onSave }) => {
  const [rows, setRows] = useState<AirlineLimit[]>(loaded.airlineLimits);
  useEffect(() => setRows(loaded.airlineLimits), [loaded]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(loaded.airlineLimits);
  const dayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  // The week is counted from any date on its first day: the latest one on or before today.
  const fromDay = (day: number) => {
    const t = new Date(); t.setUTCHours(0, 0, 0, 0);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() - day + 7) % 7));
    return t.toISOString().slice(0, 10);
  };
  const set = (i: number, patch: Partial<AirlineLimit>) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <Section icon={<Gauge className="w-3.5 h-3.5" />} title="Weekly limit on IATA"
      note="What an airline lets the agency issue in a week on its BSP account. The header shows how much is used; it turns amber at the warning and red at the limit."
      action={<button disabled={!dirty || busy || rows.some(r => !(r.limit > 0) || !(r.warnAt > 0) || r.warnAt > r.limit)}
        onClick={() => onSave(rows, rows.map(r => `${r.airline}: ${fmt(r.limit)} ${r.currency}, warn at ${fmt(r.warnAt)}, week from ${DAYS[dayOf(r.weekFrom)]}`).join('; '))}
        className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save</button>}>
      {rows.map((r, i) => (
        <div key={r.airlineCode} className="flex flex-wrap gap-4 items-end text-xs">
          <div><div className="text-[9px] uppercase text-slate-400 mb-1">Airline</div><div className="font-mono font-bold text-slate-700 py-1">{r.airline} ({r.airlineCode})</div></div>
          <label><div className="text-[9px] uppercase text-slate-400 mb-1">Limit ({r.currency})</div>
            <input type="number" min={0} className={`${input} w-32`} value={r.limit} onChange={e => set(i, { limit: Number(e.target.value) })} /></label>
          <label><div className="text-[9px] uppercase text-slate-400 mb-1">Warn at</div>
            <input type="number" min={0} className={`${input} w-32`} value={r.warnAt} onChange={e => set(i, { warnAt: Number(e.target.value) })} /></label>
          <label><div className="text-[9px] uppercase text-slate-400 mb-1">The week starts on</div>
            <select className={input} value={dayOf(r.weekFrom)} onChange={e => set(i, { weekFrom: fromDay(Number(e.target.value)) })}>
              {DAYS.map((d, k) => <option key={d} value={k}>{d}, midnight</option>)}</select></label>
          {r.warnAt > r.limit && <div className="text-[10px] text-red-600">The warning must be at or below the limit.</div>}
        </div>
      ))}
    </Section>
  );
};

/* ── request alerts ──────────────────────────────────────────────────── */
type Draft = Pick<RequestAlertSetting, 'id' | 'reqNum' | 'threshold' | 'currency' | 'recipients'>;
const Alerts: React.FC<{ alerts: RequestAlertSetting[]; busy: string;
  onSave: (a: Draft, isNew: boolean, changedFigure: boolean) => void; onDelete: (a: RequestAlertSetting) => void }> =
  ({ alerts, busy, onSave, onDelete }) => {
  const blank = (): Draft => ({ id: `alert_${Date.now()}`, reqNum: '', threshold: 0, currency: 'AED', recipients: [] });
  const [adding, setAdding] = useState<Draft | null>(null);
  return (
    <Section icon={<BellRing className="w-3.5 h-3.5" />} title="Request alerts"
      note="When a request's net - after commission and refunds - reaches the figure, the people named get one email. Checked on every upload and import. A changed figure is checked and emailed afresh."
      action={<button onClick={() => setAdding(blank())} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}><Plus className="w-3 h-3" /> Add alert</button>}>
      <div className="space-y-3">
        {alerts.map(a => <AlertRow key={a.id} a={a} busy={busy === `alert:${a.id}`} onSave={onSave} onDelete={onDelete} />)}
        {adding && <AlertRow a={{ ...adding, lastTotal: null, reachedAt: null, emailedAt: null, lastError: null }} isNew
          busy={busy === `alert:${adding.id}`} onSave={(d, n, c) => { onSave(d, n, c); setAdding(null); }} onCancel={() => setAdding(null)} />}
        {!alerts.length && !adding && <div className="text-xs text-slate-400">No alerts.</div>}
      </div>
    </Section>
  );
};

const AlertRow: React.FC<{ a: RequestAlertSetting; isNew?: boolean; busy: boolean;
  onSave: (a: Draft, isNew: boolean, changedFigure: boolean) => void; onDelete?: (a: RequestAlertSetting) => void; onCancel?: () => void }> =
  ({ a, isNew = false, busy, onSave, onDelete, onCancel }) => {
  const [req, setReq] = useState(a.reqNum);
  const [threshold, setThreshold] = useState(a.threshold);
  const [currency, setCurrency] = useState(a.currency);
  const [to, setTo] = useState(a.recipients.join(', '));
  const recipients = to.split(/[,;\s]+/).filter(Boolean);
  const changedFigure = req.trim().toUpperCase() !== a.reqNum || threshold !== a.threshold || currency !== a.currency;
  const dirty = isNew || changedFigure || recipients.join(',') !== a.recipients.join(',');
  const valid = !!req.trim() && threshold > 0 && recipients.length > 0 && recipients.every(r => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));
  const state = a.emailedAt ? `Emailed ${a.emailedAt.slice(0, 10)}` : a.reachedAt ? `Reached - not emailed${a.lastError ? `: ${a.lastError}` : ''}`
    : a.lastTotal != null ? 'Not reached yet' : isNew ? 'New' : 'Not checked yet';
  return (
    <div className="border border-slate-100 rounded p-3 flex flex-wrap gap-3 items-end text-xs">
      <label><div className="text-[9px] uppercase text-slate-400 mb-1">Request</div>
        <input className={`${input} w-32 font-mono uppercase`} value={req} onChange={e => setReq(e.target.value)} /></label>
      <label><div className="text-[9px] uppercase text-slate-400 mb-1">Figure</div>
        <input type="number" min={0} className={`${input} w-36`} value={threshold || ''} onChange={e => setThreshold(Number(e.target.value))} /></label>
      <label><div className="text-[9px] uppercase text-slate-400 mb-1">Currency</div>
        <select className={input} value={currency} onChange={e => setCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="flex-1 min-w-[16rem]"><div className="text-[9px] uppercase text-slate-400 mb-1">Email to (comma between)</div>
        <input className={`${input} w-full`} value={to} onChange={e => setTo(e.target.value)} /></label>
      <div className="flex gap-2">
        <button disabled={!dirty || !valid || busy} onClick={() => onSave({ id: a.id, reqNum: req, threshold, currency, recipients }, isNew, changedFigure)}
          className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save</button>
        {onCancel && <button onClick={onCancel} className={`${btn} bg-slate-100 text-slate-600`}>Cancel</button>}
        {onDelete && <button disabled={busy} onClick={() => { if (confirm(`Remove the alert on ${a.reqNum}?`)) onDelete(a); }}
          className="text-slate-400 hover:text-red-600 p-1" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>
      <div className="w-full text-[10px] text-slate-400">
        {state}{a.lastTotal != null && <> · now {fmt(a.lastTotal)} {a.currency} net</>}
      </div>
    </div>
  );
};
