import React, { useMemo, useState } from 'react';
import { FileWarning, Search, Download, AlertTriangle } from 'lucide-react';
import type { Ticket } from '../types';
import { admRegister, admTotals, ADM_KIND_LABEL, type AdmKind, type AdmRow } from '../core/helpers/admRegister';

const xlsx = () => import('xlsx');
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const KIND_STYLE: Record<AdmKind, string> = {
  ADM: 'bg-red-100 text-red-700',
  ACM: 'bg-emerald-100 text-emerald-700',
  SUPPLIER_ADM: 'bg-amber-100 text-amber-800',
  BSP_FEE: 'bg-slate-100 text-slate-500',
};

/**
 * Every ADM in the books, in one place.
 *
 * A memo is money and stays in the ledger - All Tickets, the balances, the
 * requests. This is the list of them: which are an airline charging us over
 * a ticket, which give money back, which are BSP's own fee filed under the
 * same heading, and which a supplier passed on. For each, the ticket it is
 * about and what our books hold on that ticket.
 */
export const Adms: React.FC<{ tickets: Ticket[] }> = ({ tickets }) => {
  const all = useMemo(() => admRegister(tickets), [tickets]);
  const [kind, setKind] = useState<AdmKind | 'ALL' | 'REAL'>('REAL');
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase().replace(/\s+/g, '');
    return all.filter(r =>
      (kind === 'ALL' || (kind === 'REAL' ? r.kind !== 'BSP_FEE' : r.kind === kind))
      && (!needle || [r.ticket.ticketNo, r.onTicket, r.ticket.reqNum, r.ticket.pnr,
          ...r.onTicketRows.map(t => `${t.reqNum} ${t.pnr} ${t.passengerName}`)]
        .some(x => String(x || '').toUpperCase().replace(/\s+/g, '').includes(needle))));
  }, [all, kind, q]);
  const totals = useMemo(() => admTotals(all), [all]);
  const flagged = all.filter(r => r.flag).length;

  const exportXls = async () => {
    const XLSX = await xlsx();
    const rows = shown.map(r => ({
      'Kind': ADM_KIND_LABEL[r.kind], 'Document': r.ticket.ticketNo, 'Airline': r.ticket.airlineCode || '',
      'Date': r.ticket.date, 'Amount': r.ticket.amount, 'Currency': r.ticket.currency || '',
      'Vendor': r.ticket.source, 'Billing period': r.ticket.vendorReference || '',
      'On ticket': r.onTicket, 'Ticket request': [...new Set(r.onTicketRows.map(t => t.reqNum))].join(', '),
      'Ticket PNR': r.onTicketRows[0]?.pnr || '', 'Passenger': r.onTicketRows[0]?.passengerName || '',
      'Filed under': r.ticket.reqNum || '', 'Closed': r.ticket.closed ? 'Closed' : 'Not closed', 'Check': r.flag,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'ADMs');
    XLSX.writeFile(wb, 'ADMs.xlsx');
  };

  const chip = (k: AdmKind | 'ALL' | 'REAL', label: string, n: number) => (
    <button key={k} onClick={() => setKind(k)}
      className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide border
        ${kind === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
      {label} <span className="opacity-60">{n}</span>
    </button>
  );
  const count = (k: AdmKind) => all.filter(r => r.kind === k).length;

  return (
    <div className="p-4 space-y-3 h-full overflow-auto">
      <div className="flex items-center gap-2">
        <FileWarning className="w-4 h-4 text-red-500" />
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">ADMs</h2>
        <span className="text-[11px] text-slate-400">
          Debit and credit memos, and what they are about. They stay in All Tickets and the balances too.
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {totals.map(t => (
          <div key={`${t.kind}${t.currency}`} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
            <div className="text-[9px] font-bold uppercase text-slate-400">{ADM_KIND_LABEL[t.kind]}</div>
            <div className={`font-mono font-black text-base ${t.amount < 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
              {fmt(t.amount)} <span className="text-[10px] text-slate-400">{t.currency}</span>
            </div>
            <div className="text-[10px] text-slate-400">{t.count} document{t.count === 1 ? '' : 's'}</div>
          </div>
        ))}
      </div>

      {flagged > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {flagged} memo{flagged === 1 ? '' : 's'} to look at: the ticket it names is not in our books, or it names none.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {chip('REAL', 'ADM + ACM + supplier', all.length - count('BSP_FEE'))}
        {chip('ADM', 'Airline ADM', count('ADM'))}
        {chip('ACM', 'Airline ACM', count('ACM'))}
        {chip('SUPPLIER_ADM', 'Supplier ADM', count('SUPPLIER_ADM'))}
        {chip('BSP_FEE', 'BSP fee', count('BSP_FEE'))}
        {chip('ALL', 'All', all.length)}
        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ADM, ticket, request, PNR..."
            className="pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded w-56 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        </div>
        <button onClick={exportXls}
          className="flex items-center gap-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded hover:bg-blue-700">
          <Download className="w-3.5 h-3.5" /> Export XLS
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-left min-w-[900px]">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Document</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">On ticket</th>
              <th className="px-3 py-2">That ticket in our books</th>
              <th className="px-3 py-2">Filed under</th>
              <th className="px-3 py-2">Billing period</th>
              <th className="px-3 py-2">Closed</th>
            </tr>
          </thead>
          <tbody className="text-xs font-mono">
            {shown.map((r: AdmRow) => {
              const sale = r.onTicketRows.find(t => (t.amount || 0) > 0);
              return (
                <tr key={r.ticket.id} className="border-b border-slate-50 align-top">
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold ${KIND_STYLE[r.kind]}`}>
                      {ADM_KIND_LABEL[r.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-bold whitespace-nowrap">
                    {r.ticket.airlineCode && <span className="text-slate-400 font-normal">{r.ticket.airlineCode} </span>}
                    {r.ticket.ticketNo}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.ticket.date || '—'}</td>
                  <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${(r.ticket.amount || 0) < 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                    {fmt(r.ticket.amount || 0)} <span className="text-[9px] text-slate-400">{r.ticket.currency}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.onTicket || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 font-sans text-[11px]">
                    {r.flag
                      ? <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{r.flag}</span>
                      : sale || r.onTicketRows.length
                        ? <span className="text-slate-600">
                            <b className="text-purple-700">{[...new Set(r.onTicketRows.map(t => t.reqNum).filter(Boolean))].join(', ') || 'no request'}</b>
                            {(sale ?? r.onTicketRows[0]).pnr ? ` · ${(sale ?? r.onTicketRows[0]).pnr}` : ''}
                            {(sale ?? r.onTicketRows[0]).passengerName ? ` · ${(sale ?? r.onTicketRows[0]).passengerName}` : ''}
                            {sale ? ` · sold ${fmt(sale.amount)} ${sale.currency}` : ''}
                          </span>
                        : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.ticket.reqNum || '—'}</td>
                  <td className="px-3 py-2 text-slate-400 text-[10px] whitespace-nowrap">{r.ticket.vendorReference || '—'}</td>
                  <td className="px-3 py-2 text-[10px]">
                    {r.ticket.closed ? <span className="text-emerald-600 font-bold">Closed</span> : <span className="text-amber-600 font-bold">Not closed</span>}
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400 font-sans">No memos match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
