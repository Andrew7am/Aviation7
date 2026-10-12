import React, { useMemo, useState } from 'react';
import { Building2, Search, ArrowLeft, Download, AlertTriangle } from 'lucide-react';
import type { Ticket } from '../types';
import {
  companyIndex, companyOf, companySummaries, type CompanyRow, type CompanySummary, type Money,
} from '../core/helpers/companies';
import { TicketTable } from './TicketTable';

const xlsx = () => import('xlsx');

/**
 * The companies the agency issues tickets for - Nestle, Allergen, Abbott,
 * Alfasigma, STADA - read off the team's Airtable, and each one's work:
 * how much, what the suppliers have billed and what not, and what is still
 * open with the client.
 *
 * VIP and Corporate tickets name no company - the traveller is the client -
 * and are grouped under their department.
 */

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyLine = (m: Record<string, number>) => {
  const parts = Object.entries(m).filter(([, v]) => Math.abs(v) >= 0.005);
  return parts.length ? parts.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ') : '—';
};
const nets = (m: Record<string, Money>) => Object.fromEntries(Object.entries(m).map(([c, x]) => [c, x.net]));

interface Props {
  tickets: Ticket[];
  rows: CompanyRow[];
  loading: boolean;
  /** Everything All Tickets is given, so a company's list behaves the same. */
  tableProps: Omit<React.ComponentProps<typeof TicketTable>, 'tickets' | 'title'>;
}

export const Companies: React.FC<Props> = ({ tickets, rows, loading, tableProps }) => {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const idx = useMemo(() => companyIndex(rows), [rows]);
  const list = useMemo(() => companySummaries(tickets, rows, idx), [tickets, rows, idx]);
  const shown = list.filter(s => s.company.toLowerCase().includes(search.trim().toLowerCase()));
  const placed = useMemo(() => tickets.filter(t => (t.status || '').toUpperCase() !== 'FUND' && companyOf(t, idx)).length, [tickets, idx]);
  const companyFn = useMemo(() => (t: Ticket) => companyOf(t, idx), [idx]);

  const exportList = async () => {
    const XLSX = await xlsx();
    const data = shown.map(s => ({
      Company: s.company, Requests: s.requests, Tickets: s.tickets, Refunds: s.refunds,
      'Net': moneyLine(nets(s.money)),
      'Billed by supplier': s.billed, 'Recorded, not billed yet': s.recordedOnly, 'On their sheet, not in our books': s.notInBooks,
      Closed: s.closed, Open: s.open, 'Open value': moneyLine(s.openMoney), 'Last ticket': s.lastDate,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [28, 9, 8, 8, 34, 10, 12, 14, 8, 8, 28, 12].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Companies');
    XLSX.writeFile(wb, `Companies_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const current = open ? list.find(s => s.company === open) : undefined;
  if (current) return (
    <CompanyDetail s={current} tickets={tickets.filter(t => companyFn(t) === current.company)}
      tableProps={{ ...tableProps, companyOf: companyFn }} onBack={() => setOpen(null)} />
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Building2 className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-bold text-slate-800">Companies</h2>
        <span className="text-xs text-slate-500">
          {loading ? 'Reading the team\'s Airtable…'
            : `${list.length} companies · ${placed.toLocaleString()} of our tickets placed by the team's Airtable`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a company"
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56" />
          </div>
          <button onClick={exportList} disabled={!shown.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-white disabled:opacity-40">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">Company</th>
              <th className="px-3 py-2 text-right">Requests</th>
              <th className="px-3 py-2 text-right">Tickets</th>
              <th className="px-3 py-2 text-left">Net</th>
              <th className="px-3 py-2 text-right" title="In our books from the supplier's own report or invoice">Billed</th>
              <th className="px-3 py-2 text-right" title="Recorded from their sheet or by hand, or on their sheet and in nobody's books">Not billed yet</th>
              <th className="px-3 py-2 text-right">Closed</th>
              <th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-left">Open value</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(s => {
              const notBilled = s.recordedOnly + s.notInBooks;
              return (
                <tr key={s.company} onClick={() => setOpen(s.company)}
                  className="border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer">
                  <td className="px-3 py-2 font-bold text-blue-700">{s.company}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.requests}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {s.tickets}{s.refunds ? <span className="text-red-500 text-[11px]"> +{s.refunds} refunds</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{moneyLine(nets(s.money))}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{s.billed}</td>
                  <td className={`px-3 py-2 text-right font-mono ${notBilled ? 'text-amber-700 font-bold' : 'text-slate-300'}`}>{notBilled || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{s.closed}</td>
                  <td className={`px-3 py-2 text-right font-mono ${s.open ? 'text-orange-600 font-bold' : 'text-slate-300'}`}>{s.open || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-orange-700">{moneyLine(s.openMoney)}</td>
                </tr>
              );
            })}
            {!loading && !shown.length && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No company matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Billed: in our books from the supplier's report or invoice. Not billed yet: recorded from the team's sheet or by
        hand, or on their sheet and in nobody's books. Closed and open are our own closure, ticket by ticket. VIP and
        Corporate tickets name no company and are grouped under their department.
      </p>
    </div>
  );
};

const Tile: React.FC<{ label: string; value: React.ReactNode; tone?: string; sub?: string }> = ({ label, value, tone, sub }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`text-xl font-bold font-mono ${tone ?? 'text-slate-800'}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

const CompanyDetail: React.FC<{
  s: CompanySummary; tickets: Ticket[];
  tableProps: Omit<React.ComponentProps<typeof TicketTable>, 'tickets' | 'title'>; onBack: () => void;
}> = ({ s, tickets, tableProps, onBack }) => (
  <div className="flex flex-col h-full">
    <div className="px-6 pt-5 pb-3 space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Companies
        </button>
        <h2 className="text-lg font-bold text-slate-800">{s.company}</h2>
        <span className="text-xs text-slate-500">{s.requests} requests · last ticket {s.lastDate || '—'}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile label="Tickets" value={s.tickets} sub={s.refunds ? `and ${s.refunds} refunds` : undefined} />
        <Tile label="Net" value={<span className="text-sm">{moneyLine(nets(s.money))}</span>} />
        <Tile label="Billed by supplier" value={s.billed} tone="text-emerald-700" />
        <Tile label="Not billed yet" value={s.recordedOnly + s.notInBooks} tone={s.recordedOnly + s.notInBooks ? 'text-amber-700' : undefined}
          sub={`${s.recordedOnly} recorded from their sheet · ${s.notInBooks} in nobody's books`} />
        <Tile label="Open" value={s.open} tone={s.open ? 'text-orange-600' : 'text-emerald-700'}
          sub={`${s.closed} closed · open ${moneyLine(s.openMoney)}`} />
      </div>
      {s.notInBooksRows.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <AlertTriangle className="w-3.5 h-3.5" /> On their sheet and in nobody's books ({s.notInBooksRows.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.notInBooksRows.map((r, i) => (
              <span key={i} className="font-mono bg-white border border-amber-200 rounded px-1.5 py-0.5"
                title={`${r.status} · ${r.client_name} · PNR ${r.pnr}`}>
                {r.ticket_cell} · {r.req_num} · {r.net_cost != null ? `${fmt(r.net_cost)} ${r.currency}` : 'no figure'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
    <div className="flex-1 min-h-0">
      <TicketTable title={s.company} tickets={tickets} {...tableProps} />
    </div>
  </div>
);
