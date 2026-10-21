import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { AirlineLimit, LimitUse } from '../core/helpers/airlineLimit';

/**
 * Raised across the top once an airline's IATA sales for the week reach the
 * warning mark. Closing it hides it for this week at this level only: going
 * over the limit raises it again, and so does the next week.
 */
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const LimitBanner: React.FC<{ cfg: AirlineLimit; use: LimitUse }> = ({ cfg, use }) => {
  const [closed, setClosed] = useState('');
  const key = `${use.from}:${use.level}`;
  if (use.level === 'OK' || closed === key) return null;
  const over = use.level === 'OVER';
  return (
    <div className={`shrink-0 border-b px-4 py-2 flex items-start gap-2 text-xs ${over ? 'bg-red-600 border-red-700 text-white' : 'bg-amber-100 border-amber-300 text-amber-900'}`}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        <span className="font-bold">{cfg.airline} ({cfg.airlineCode}) on IATA: </span>
        {fmt(use.used)} {cfg.currency} issued this week ({day(use.from)} - {day(use.to)}), of a {fmt(cfg.limit)} {cfg.currency} weekly limit.{' '}
        <span className="font-bold">{over ? `Over by ${fmt(-use.left)} ${cfg.currency}.` : `${fmt(use.left)} ${cfg.currency} left.`}</span>
        {use.fromSheet > 0 && <span className="opacity-80"> Includes {fmt(use.fromSheet)} {cfg.currency} on the team's Airtable not yet in a BSP report.</span>}
      </div>
      <button onClick={() => setClosed(key)} title="Hide for this week" className="opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
    </div>
  );
};
