import React, { useState } from 'react';
import { Plane, X } from 'lucide-react';
import type { AirlineLimit, LimitUse } from '../core/helpers/airlineLimit';

/**
 * The week's issues on an airline's IATA limit, always in the header - so
 * where the week stands can be read mid-week, not only once it nears
 * the limit. A click lists what was counted.
 */
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const LimitChip: React.FC<{ cfg: AirlineLimit; use: LimitUse }> = ({ cfg, use }) => {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, (use.used / cfg.limit) * 100);
  const bar = use.level === 'OVER' ? 'bg-red-500' : use.level === 'WARN' ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <>
      <button onClick={() => setOpen(o => !o)} title={`${cfg.airline} (${cfg.airlineCode}) on IATA this week`}
        className="flex flex-col items-stretch gap-0.5 text-white/80 hover:text-white px-1.5 py-1">
        <span className="flex items-center gap-1 text-[10px] font-mono whitespace-nowrap">
          <Plane className="w-3 h-3" />{cfg.airlineCode} <b>{fmt(use.used)}</b><span className="hidden sm:inline text-white/50"> / {fmt(cfg.limit)}</span>
        </span>
        <span className="h-1 rounded bg-white/20 overflow-hidden"><span className={`block h-full ${bar}`} style={{ width: `${pct}%` }} /></span>
      </button>

      {open && (
        <div className="follow-theme fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="absolute right-2 sm:right-16 top-14 w-[calc(100vw-1rem)] sm:w-[380px] max-h-[80vh] bg-white text-slate-800 rounded-lg shadow-2xl border border-slate-200 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
              <Plane className="w-4 h-4 text-red-600 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs font-bold">{cfg.airline} ({cfg.airlineCode}) on IATA</div>
                <div className="text-[10px] text-slate-500">Week {day(use.from)} - {day(use.to)} · weekly limit {fmt(cfg.limit)} {cfg.currency}, warning at {fmt(cfg.warnAt)}</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-4 py-3 border-b border-slate-100 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black font-mono">{fmt2(use.used)}</span>
                <span className={`text-xs font-bold ${use.level === 'OVER' ? 'text-red-600' : use.level === 'WARN' ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {use.left >= 0 ? `${fmt2(use.left)} left` : `over by ${fmt2(-use.left)}`}
                </span>
              </div>
              <div className="h-2 rounded bg-slate-100 overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${pct}%` }} /></div>
              <div className="text-[10px] text-slate-500">
                {use.docs} document{use.docs === 1 ? '' : 's'} · {fmt2(use.fromBooks)} in our books
                {use.fromSheet > 0 && <> · {fmt2(use.fromSheet)} on the team's Airtable, not yet in a BSP report</>}
              </div>
            </div>
            <div className="overflow-y-auto">
              {use.items.length === 0
                ? <div className="px-4 py-6 text-xs text-slate-400 text-center">Nothing issued this week yet.</div>
                : <table className="w-full text-[11px]">
                    <tbody>
                      {use.items.map(i => (
                        <tr key={`${i.from}${i.ticketNo}`} className="border-b border-slate-50">
                          <td className="px-4 py-1.5 font-mono">{i.ticketNo}</td>
                          <td className="px-2 py-1.5 text-slate-500">{day(i.date)}</td>
                          <td className="px-2 py-1.5 text-[9px] text-slate-400">{i.from === 'SHEET' ? 'Airtable' : 'BSP'}</td>
                          <td className="px-4 py-1.5 text-right font-mono">{fmt2(i.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
