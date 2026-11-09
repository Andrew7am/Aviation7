import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { Ticket } from '../types';
import { AirtableService } from '../services/AirtableService';
import { aviationProfit, profitBy, PROFIT_FROM, type ProfitLine, type ProfitSheetRow, type ProfitState } from '../core/helpers/aviationProfit';

/**
 * The aviation team's profit: the cost they quoted operations against what
 * the supplier charged us, ticket by ticket, from 9 Nov 2026.
 */
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATE: Record<ProfitState, { label: string; tone: string }> = {
  COUNTED:           { label: 'Counted',               tone: 'bg-emerald-50 text-emerald-700' },
  AWAITING_SUPPLIER: { label: 'Waiting for supplier',  tone: 'bg-amber-50 text-amber-700' },
  NOT_IN_BOOKS:      { label: 'Not in our books yet',  tone: 'bg-slate-100 text-slate-600' },
  TWO_CURRENCIES:    { label: 'Two currencies',        tone: 'bg-red-50 text-red-700' },
};
const money = (p: Record<string, number>) => Object.entries(p).map(([c, v]) => `${fmt(v)} ${c}`).join(' · ') || '—';

export const AviationProfit: React.FC<{ tickets: Ticket[]; voidedNos: string[] }> = ({ tickets, voidedNos }) => {
  const [rows, setRows] = useState<ProfitSheetRow[] | null>(null);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState(PROFIT_FROM);
  const [to, setTo] = useState('');
  const [member, setMember] = useState('');
  const [show, setShow] = useState<ProfitState | 'LOSS' | ''>('');

  useEffect(() => {
    setRows(null); setErr('');
    new AirtableService().profitRows(from < PROFIT_FROM ? PROFIT_FROM : from).then(setRows).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [from]);

  const lines = useMemo(() => rows ? aviationProfit(rows, tickets, from < PROFIT_FROM ? PROFIT_FROM : from, to, voidedNos) : [], [rows, tickets, from, to, voidedNos]);
  const mine = useMemo(() => member ? lines.filter(l => l.member === member) : lines, [lines, member]);
  const byMember = useMemo(() => profitBy(lines, l => l.member), [lines]);
  const byReq = useMemo(() => profitBy(mine, l => l.req || '(no request)'), [mine]);
  const total = useMemo(() => profitBy(mine, () => 'all')[0], [mine]);
  const count = (s: ProfitState) => mine.filter(l => l.state === s).length;
  const losses = mine.filter(l => l.state === 'COUNTED' && (l.profit ?? 0) < -0.005);
  const list = show === 'LOSS' ? losses : show ? mine.filter(l => l.state === show) : mine;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Aviation Profit</h2>
          <p className="text-xs text-slate-500 mt-0.5">The cost the aviation team quoted operations (Net Cost on their sheet) less what the supplier charged us. Our cost is after the supplier's commission, so the commission counts to the team. Counted from {PROFIT_FROM}; refunds not yet included.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2 text-xs">
          <label className="flex flex-col">From<input type="date" min={PROFIT_FROM} value={from} onChange={e => setFrom(e.target.value || PROFIT_FROM)} className="border rounded px-2 py-1" /></label>
          <label className="flex flex-col">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1" /></label>
          <label className="flex flex-col">Team member
            <select value={member} onChange={e => setMember(e.target.value)} className="border rounded px-2 py-1 bg-white">
              <option value="">Everyone</option>
              {[...new Set(lines.map(l => l.member))].sort().map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{err}</div>}
      {!rows && !err && <div className="text-sm text-slate-400">Loading their sheet…</div>}

      {rows && (<>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {([
            ['', 'Profit', total ? money(total.profit) : '—', total ? `${fmt(total.inSar)} SAR in all` : 'nothing counted yet', 'border-emerald-200 bg-emerald-50/50'],
            ['COUNTED', 'Tickets counted', String(count('COUNTED')), 'the supplier has billed them', 'border-slate-200 bg-white'],
            ['AWAITING_SUPPLIER', 'Waiting for supplier', String(count('AWAITING_SUPPLIER')), 'in our books from their sheet or by hand', 'border-amber-200 bg-amber-50/50'],
            ['NOT_IN_BOOKS', 'Not in our books yet', String(count('NOT_IN_BOOKS')), 'counted once the supplier bills them', 'border-slate-200 bg-white'],
            ['LOSS', 'Quoted below cost', String(losses.length), 'operations were told less than it cost', 'border-red-200 bg-red-50/50'],
          ] as const).map(([k, label, value, sub, cls]) => (
            <button key={label} onClick={() => setShow(show === k ? '' : k as typeof show)}
              className={`text-left px-4 py-3 rounded-lg border ${cls} ${show === k && k ? 'ring-2 ring-slate-400' : ''}`}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="text-lg font-bold text-slate-800 font-mono mt-0.5">{value}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {[['By team member', byMember, (k: string) => setMember(member === k ? '' : k)], ['By request', byReq, null] as const].map(([title, list2, onPick]) => (
            <div key={title as string} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">{title as string}</div>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 text-[10px] uppercase"><th className="text-left px-4 py-1.5">Name</th><th className="text-right px-2">Tickets</th><th className="text-right px-2">Profit</th><th className="text-right px-4">In SAR</th></tr></thead>
                <tbody>
                  {(list2 as ReturnType<typeof profitBy>).slice(0, 40).map(t => (
                    <tr key={t.key} onClick={onPick ? () => (onPick as (k: string) => void)(t.key) : undefined}
                      className={`border-t border-slate-100 ${onPick ? 'cursor-pointer hover:bg-slate-50' : ''} ${member === t.key ? 'bg-slate-50' : ''}`}>
                      <td className="px-4 py-1.5 font-bold text-slate-700">{t.key}{t.losses ? <span className="ml-1 text-red-600 font-normal">({t.losses} below cost)</span> : null}</td>
                      <td className="text-right px-2 font-mono">{t.tickets}</td>
                      <td className="text-right px-2 font-mono">{money(t.profit)}</td>
                      <td className={`text-right px-4 font-mono font-bold ${t.inSar < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmt(t.inSar)}</td>
                    </tr>
                  ))}
                  {!(list2 as unknown[]).length && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Nothing counted yet.</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 text-[10px] uppercase border-b border-slate-100">
              {['Issued', 'Request', 'Team member', 'Ticket', 'Quoted', 'Our cost', 'Profit', 'State'].map(h =>
                <th key={h} className={`px-3 py-2 ${['Quoted', 'Our cost', 'Profit'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {list.slice(0, 500).map((l: ProfitLine) => (
                <tr key={l.key} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-mono text-slate-500">{l.issued}</td>
                  <td className="px-3 py-1.5 font-bold">{l.req || '—'}</td>
                  <td className="px-3 py-1.5">{l.member}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600" title={l.cell}>{l.docs.slice(0, 3).join(', ') || l.pnr}{l.docs.length > 3 ? ` +${l.docs.length - 3}` : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(l.quoted)} {l.currency}{l.perTicket ? <span className="text-slate-400" title="Their row priced each ticket"> ×{l.docs.length}</span> : null}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{l.cost === null ? '—' : fmt(l.cost)}{l.converted ? <span className="text-slate-400" title="Converted at the peg"> *</span> : null}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-bold ${(l.profit ?? 0) < -0.005 ? 'text-red-600' : 'text-emerald-700'}`}>{l.profit === null ? '—' : fmt(l.profit)}</td>
                  <td className="px-3 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATE[l.state].tone}`}>{STATE[l.state].label}</span></td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No tickets on their sheet from {from < PROFIT_FROM ? PROFIT_FROM : from}{to ? ` to ${to}` : ''} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
};

export default AviationProfit;
