import React, { useState, useMemo, useEffect } from 'react';
import { Ban, Search, Download, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Ticket } from '../types';
import type { VoidTicket } from '../services/VoidTicketService';
import { voidReport, RatioRow } from '../core/helpers/voidRatio';

const xlsx = () => import('xlsx');

/**
 * The cancelled documents, and what share of issuance they are.
 *
 * These are deliberately not in the ledger. A void moves no money, so it
 * belongs in no balance, no request's cost and no statement comparison —
 * and three of them once sat in the books as live sales because somebody
 * filed a cancellation as a ticket.
 *
 * But they are not nothing either. IATA caps how much of a year's issuance
 * may be voided, and that is counted in DOCUMENTS, not money: a document
 * drawn from the agency's stock and cancelled still came off the stock. So
 * the denominator here is issued plus voided, and the figures are counts.
 */

const pct = (n: number) => `${n.toFixed(2)}%`;

/** Enough to scan, few enough to draw instantly. */
const PER_PAGE = 50;

/** Where a ratio stops being ordinary. IATA's own threshold varies by
 *  market, so this only colours the number — it never says "over limit",
 *  which is not ours to assert. */
const tone = (r: number) =>
  r >= 25 ? 'text-red-600 font-bold'
  : r >= 10 ? 'text-amber-600 font-bold'
  : 'text-slate-600';

const Band: React.FC<{ rows: RatioRow[]; label: string }> = ({ rows, label }) => (
  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
    <div className="px-4 py-2 border-b border-slate-100 text-[10px] font-bold uppercase
                    tracking-wide text-slate-500">{label}</div>
    <table className="w-full text-left">
      <thead className="bg-slate-50 border-b border-slate-100">
        <tr className="text-[9px] uppercase tracking-wider text-slate-400">
          <th className="px-3 py-1.5">Period</th>
          <th className="px-3 py-1.5 text-right">Issued</th>
          <th className="px-3 py-1.5 text-right">Voided</th>
          <th className="px-3 py-1.5 text-right">Drawn</th>
          <th className="px-3 py-1.5 text-right">Void share</th>
        </tr>
      </thead>
      <tbody className="font-mono text-[11px]">
        {rows.map(r => (
          <tr key={r.key} className="border-b border-slate-50">
            <td className="px-3 py-1.5 text-slate-700">{r.key}</td>
            <td className="px-3 py-1.5 text-right text-slate-600">{r.issued}</td>
            <td className="px-3 py-1.5 text-right text-slate-600">{r.voided}</td>
            <td className="px-3 py-1.5 text-right text-slate-400">{r.issued + r.voided}</td>
            <td className={`px-3 py-1.5 text-right ${tone(r.ratio)}`}>{pct(r.ratio)}</td>
          </tr>
        ))}
        {!rows.length && (
          <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">
            Nothing yet.
          </td></tr>
        )}
      </tbody>
    </table>
  </div>
);

export const Voids: React.FC<{ voids: VoidTicket[]; tickets: Ticket[] }> = ({ voids, tickets }) => {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('ALL');

  const sources = useMemo(
    () => [...new Set(voids.map(v => v.source))].sort(), [voids]);

  const report = useMemo(
    () => voidReport(voids, tickets, source === 'ALL' ? undefined : source),
    [voids, tickets, source]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return voids
      .filter(v => source === 'ALL' || v.source === source)
      .filter(v => !q
        || v.ticketNo.toLowerCase().includes(q)
        || v.pnr.toLowerCase().includes(q)
        || v.passengerName.toLowerCase().includes(q)
        || (v.period ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [voids, search, source]);

  /* BSP's agent billing file lists documents, not people: it carries no
     passenger and no PNR on any line, voided or not. Two columns of dashes
     look like a parsing failure, so a column appears only when something in
     the list actually fills it. */
  const has = useMemo(() => ({
    pnr: rows.some(v => !!v.pnr),
    pax: rows.some(v => !!v.passengerName),
  }), [rows]);

  const [page, setPage] = useState(0);
  // Any narrowing puts you back at the top: page 4 of a list that is now two
  // pages long is an empty screen that looks like no results.
  useEffect(() => setPage(0), [search, source]);

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = useMemo(
    () => rows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE),
    [rows, page]);

  const exportAll = async () => {
    const XLSX = await xlsx();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.byMonth.map(r => ({
      Month: r.key, Issued: r.issued, Voided: r.voided,
      Drawn: r.issued + r.voided, 'Void share %': r.ratio,
    }))), 'By month');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(v => ({
      Ticket: v.airlineCode ? `${v.airlineCode}-${v.ticketNo}` : v.ticketNo,
      PNR: v.pnr, Passenger: v.passengerName, Issued: v.date,
      Supplier: v.source, Period: v.period, Status: v.rawStatus,
    }))), 'Voided documents');
    XLSX.writeFile(wb, 'Voided documents.xlsx');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Ban className="w-4 h-4 text-slate-500" />
            Voids
          </h2>
          <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">
            Documents that were cancelled. They are in no balance, no request and no
            report of money — a void moves none — so they carry no request number and
            nothing to close. They are here to be found and counted: IATA caps how much
            of a year's issuance may be voided, and that is counted in documents.
          </p>
        </div>
        <button onClick={exportAll}
          className="flex items-center gap-1.5 bg-purple-600 text-white text-[11px] font-bold
                     px-3 py-1.5 rounded hover:bg-purple-700 shrink-0">
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Voided</div>
          <div className="text-lg font-bold font-mono text-slate-800 mt-0.5">{report.overall.voided}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Issued</div>
          <div className="text-lg font-bold font-mono text-slate-800 mt-0.5">{report.overall.issued}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Drawn</div>
          <div className="text-lg font-bold font-mono text-slate-800 mt-0.5">
            {report.overall.issued + report.overall.voided}
          </div>
        </div>
        <div className={`bg-white border rounded-lg px-4 py-3 ${
          report.overall.ratio >= 10 ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Void share</div>
          <div className={`text-lg font-mono mt-0.5 ${tone(report.overall.ratio)}`}>
            {pct(report.overall.ratio)}
          </div>
        </div>
      </div>

      {report.alsoLive.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-[11px]
                        text-red-800 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>
            {report.alsoLive.length} document(s) are cancelled here and still a live sale in
            the ledger. One of the two records is wrong:{' '}
            <span className="font-mono">{report.alsoLive.slice(0, 8).join(', ')}</span>
            {report.alsoLive.length > 8 && ` and ${report.alsoLive.length - 8} more`}.
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <Band rows={report.byYear} label="By year — the one IATA caps" />
        <Band rows={report.byMonth.slice(0, 14)} label="By month" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ticket, PNR, passenger, period"
            className="text-[11px] border border-slate-200 rounded pl-6 pr-2 py-1.5 w-64 text-slate-700" />
        </div>
        {sources.length > 1 && (
          <select value={source} onChange={e => setSource(e.target.value)}
            className="text-[11px] border border-slate-200 rounded px-2 py-1.5 text-slate-600">
            <option value="ALL">All suppliers</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span className="text-[11px] text-slate-400 ml-auto">{rows.length} shown</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Ticket</th>
              {has.pnr && <th className="px-3 py-2">PNR</th>}
              {has.pax && <th className="px-3 py-2">Passenger</th>}
              <th className="px-3 py-2">Issued</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Period</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[11px]">
            {shown.map(v => (
              <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-3 py-1.5 font-bold text-slate-700">
                  {v.airlineCode ? `${v.airlineCode}-${v.ticketNo}` : v.ticketNo}
                </td>
                {has.pnr && <td className="px-3 py-1.5 text-slate-500">{v.pnr || '—'}</td>}
                {has.pax && (
                  <td className="px-3 py-1.5 text-slate-600 max-w-[16rem] truncate">
                    {v.passengerName || '—'}
                  </td>
                )}
                <td className="px-3 py-1.5 text-slate-500">{v.date || '—'}</td>
                <td className="px-3 py-1.5 text-slate-500">{v.source}</td>
                <td className="px-3 py-1.5 text-slate-400">{v.period || '—'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={4 + (has.pnr ? 1 : 0) + (has.pax ? 1 : 0)}
                      className="px-3 py-8 text-center text-xs text-slate-400">
                Nothing here.
              </td></tr>
            )}
          </tbody>
        </table>
        {rows.length > PER_PAGE && (
          <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              {page * PER_PAGE + 1}–{Math.min(rows.length, (page + 1) * PER_PAGE)} of {rows.length}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 rounded border border-slate-200 text-slate-500 disabled:opacity-30
                           hover:bg-slate-50">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-slate-500 px-1">
                {page + 1} / {pages}
              </span>
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="p-1 rounded border border-slate-200 text-slate-500 disabled:opacity-30
                           hover:bg-slate-50">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
