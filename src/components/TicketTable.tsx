import React, { useState, useMemo } from 'react';
import { Ticket } from '../types';
import { Search, Download, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';

interface TicketTableProps {
  tickets: Ticket[];
  title: string;
  defaultFilter?: 'ALL' | 'NEED_REQ' | 'DUPLICATE';
  onDelete?: (id: string) => void;
  onUpdateReqNum?: (id: string, reqNum: string) => void;
  onUpdateTicket?: (id: string, patch: Partial<Ticket>) => void;
  currency?: string;
}

type EditableField = 'reqNum' | 'passengerName' | 'amount' | 'pnr';

const SOURCE_COLORS: Record<string, string> = {
  'flyadeal ksa': 'bg-orange-100 text-orange-700',
  'flyadeal dxb': 'bg-amber-100 text-amber-700',
  'flynas': 'bg-green-100 text-green-700',
  'flydubai': 'bg-sky-100 text-sky-700',
  'airarabia': 'bg-rose-100 text-rose-700',
  'air arabia': 'bg-rose-100 text-rose-700',
  'iata': 'bg-indigo-100 text-indigo-700',
  'rts': 'bg-emerald-100 text-emerald-700',
  'ibtekar': 'bg-purple-100 text-purple-700',
  'gold medal': 'bg-yellow-100 text-yellow-700',
};

const STATUS_COLORS: Record<string, string> = {
  // New normalized statuses
  ISSUE:  'bg-emerald-100 text-emerald-700',
  REFUND: 'bg-red-100 text-red-700',
  FUND:   'bg-emerald-200 text-emerald-800',
  ADM:    'bg-blue-100 text-blue-700',
  ACM:    'bg-purple-100 text-purple-700',
  // Legacy (for old imported data)
  TKTT: 'bg-emerald-100 text-emerald-700',
  RFND: 'bg-red-100 text-red-700',
  VOID: 'bg-red-100 text-red-700',
  CANN: 'bg-slate-100 text-slate-500',
  EMDS: 'bg-purple-100 text-purple-700',
};

function getSourceColor(source: string) {
  const s = source.toLowerCase();
  for (const [key, val] of Object.entries(SOURCE_COLORS)) {
    if (s.includes(key)) return val;
  }
  return 'bg-slate-100 text-slate-700';
}

export const TicketTable: React.FC<TicketTableProps> = ({
  tickets, title, defaultFilter = 'ALL', onDelete, onUpdateReqNum, onUpdateTicket, currency = 'SAR',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'NEED_REQ' | 'DUPLICATE'>(defaultFilter);
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [sortKey, setSortKey] = useState<'serial' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sources = useMemo(
    () => ['ALL', ...Array.from(new Set(tickets.map(t => t.source).filter(Boolean)))],
    [tickets]
  );

  const filtered = useMemo(() => {
    const rows = tickets.filter(t => {
      if (filterMode === 'NEED_REQ' && (t.reqNum || t.status === 'FUND')) return false;
      if (filterMode === 'DUPLICATE' && !t.isDuplicate) return false;
      if (sourceFilter !== 'ALL' && t.source !== sourceFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const haystack = `${t.ticketNo} ${t.reqNum} ${t.pnr} ${t.source} ${t.passengerName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (sortKey === 'serial') {
      rows.sort((a, b) => {
        const av = a.serial ?? (sortDir === 'asc' ? Infinity : -Infinity);
        const bv = b.serial ?? (sortDir === 'asc' ? Infinity : -Infinity);
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    }
    return rows;
  }, [tickets, searchTerm, filterMode, sourceFilter, sortKey, sortDir]);

  const toggleSerialSort = () => {
    if (sortKey !== 'serial') { setSortKey('serial'); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortKey(null); setSortDir('asc'); }
  };

  // Gaps in the Serial sequence are only meaningful sorted ascending by
  // serial — flags a row where the previous row's serial skipped a number,
  // so missing IATA tickets show up directly in the table.
  const serialGapBefore = useMemo(() => {
    const gaps = new Map<string, number>();
    if (sortKey !== 'serial' || sortDir !== 'asc') return gaps;
    let prev: number | null = null;
    for (const t of filtered) {
      if (t.serial != null) {
        if (prev != null && t.serial - prev > 1) gaps.set(t.id, t.serial - prev - 1);
        prev = t.serial;
      }
    }
    return gaps;
  }, [filtered, sortKey, sortDir]);

  const exportToExcel = () => {
    const data = filtered.map(t => ({
      'Serial':      t.serial ?? '',
      'A/L':         t.airlineCode || '',
      'Route':       t.route || '',
      'Ticket No.':  t.ticketNo,
      'Source':      t.source || 'UNKNOWN',
      'Type':        t.transactionType || t.status || '',
      'Status':      t.status || '',
      'Date':        t.date,
      'Total Doc':   t.totalDoc || '',
      'Commission':  t.commission || '',
      'Net Amount':  t.amount,
      'Currency':    t.currency || 'SAR',   // always from ticket, never from UI selection
      'PNR':         t.pnr || '',
      'Passenger':   t.passengerName || '',
      'Req Num':     t.reqNum || '',
      'Recon Status': t.reqNum ? 'MATCHED' : 'NEED REQ',
      'Import Time': t.importTime || '',
      'Report Name': t.reportName || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_Export.xlsx`);
  };

  const exportMissingReq = () => {
    const missing = tickets.filter(t => !t.reqNum && t.status !== 'FUND');
    const data = missing.map(t => ({
      'A/L':        t.airlineCode || '',
      'Route':      t.route || '',
      'Ticket No.': t.ticketNo,
      'Source':     t.source || '',
      'Status':     t.status || '',
      'Date':       t.date,
      'Net Amount': t.amount,
      'Currency':   t.currency || 'SAR',  // from ticket, not UI
      'PNR':        t.pnr || '',
      'Passenger':  t.passengerName || '',
      'Req Num':    '',  // blank — fill and re-import to auto-match
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Missing REQ');
    XLSX.writeFile(wb, 'Missing_REQ_Numbers.xlsx');
  };

  const canEdit = !!onUpdateReqNum || !!onUpdateTicket;

  const startEdit = (ticket: Ticket, field: EditableField) => {
    if (!canEdit) return;
    const current =
      field === 'reqNum'        ? (ticket.reqNum || '')
      : field === 'passengerName' ? (ticket.passengerName || '')
      : field === 'pnr'         ? (ticket.pnr || '')
      : String(ticket.amount ?? '');
    setEditingCell({ id: ticket.id, field });
    setEditValue(current);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const raw = editValue.trim();

    if (field === 'reqNum') {
      onUpdateReqNum?.(id, raw.toUpperCase());
    } else if (field === 'amount') {
      const n = Number(raw.replace(/[^0-9.-]/g, ''));
      if (!Number.isNaN(n)) onUpdateTicket?.(id, { amount: n });
    } else if (field === 'passengerName') {
      onUpdateTicket?.(id, { passengerName: raw.toUpperCase() });
    } else if (field === 'pnr') {
      onUpdateTicket?.(id, { pnr: raw.toUpperCase() });
    }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  const isEditing = (id: string, field: EditableField) =>
    editingCell?.id === id && editingCell.field === field;

  const editorInput = (
    <input
      type="text"
      value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
      onBlur={commitEdit}
      className="w-24 px-1.5 py-0.5 text-xs font-bold border border-blue-400 rounded focus:outline-none focus:ring-1 ring-blue-400"
      autoFocus
    />
  );

  const totalAmount = filtered.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* Header */}
      <div className="p-4 flex flex-wrap justify-between items-center gap-2 shrink-0 bg-white border-b border-slate-200">
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search ticket, PNR, req..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-7 pr-2 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-48"
            />
          </div>

          {/* Source filter */}
          <div className="relative">
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="pl-7 pr-2 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Status filter */}
          <select
            value={filterMode}
            onChange={e => setFilterMode(e.target.value as any)}
            className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase border focus:outline-none transition-colors ${
              filterMode === 'NEED_REQ' ? 'bg-red-50 text-red-600 border-red-200'
              : filterMode === 'DUPLICATE' ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            <option value="ALL">All</option>
            <option value="NEED_REQ">Missing REQ</option>
            <option value="DUPLICATE">Duplicates</option>
          </select>

          {/* Export missing REQ */}
          {defaultFilter === 'NEED_REQ' && (
            <button
              onClick={exportMissingReq}
              className="px-2 py-1.5 bg-red-600 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-red-700 flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              Export Missing REQ
            </button>
          )}

          {/* Export all */}
          <button
            onClick={exportToExcel}
            className="px-2 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            Export XLS
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="flex items-center space-x-4 px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0 text-[10px] font-mono text-slate-500">
        <span>{filtered.length} tickets</span>
        <span className="text-slate-300">|</span>
        <span className={totalAmount < 0 ? 'text-red-600 font-bold' : 'text-slate-600'}>
          Net: {currency} {fmt(totalAmount)}
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-red-500">{filtered.filter(t => !t.reqNum).length} missing req</span>
      </div>

      {/* Table */}
      <div className="flex-1 mx-4 my-4 bg-white border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                <th
                  onClick={toggleSerialSort}
                  className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap cursor-pointer select-none hover:text-slate-700"
                  title="Click to sort by Serial — reveals gaps in the sequence"
                >
                  Serial {sortKey === 'serial' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
              {['A/L', 'Ticket No.', 'Source', 'Status', 'Date', 'Route', 'Total Doc', 'Comm', 'Net Amt', 'PNR', 'Passenger', 'Req Num', 'Recon'].map(col => (
                <th key={col} className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{col}</th>
              ))}
              {onDelete && <th className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase text-right">Del</th>}
            </tr>
          </thead>
          <tbody className="text-xs font-mono">
            {filtered.map(ticket => (
              <tr key={ticket.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!ticket.reqNum ? 'bg-red-50/20' : ''}`}>
                <td className="px-3 py-2 whitespace-nowrap">
                  {ticket.serial != null ? (
                    <span className="text-slate-500">{ticket.serial}</span>
                  ) : <span className="text-slate-300">—</span>}
                  {serialGapBefore.has(ticket.id) && (
                    <span className="ml-1.5 bg-red-100 text-red-700 px-1 py-0.5 rounded text-[8px] font-bold" title={`${serialGapBefore.get(ticket.id)} serial(s) missing before this ticket`}>
                      GAP −{serialGapBefore.get(ticket.id)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {ticket.airlineCode
                    ? <span className="font-mono font-black text-[11px] text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{ticket.airlineCode}</span>
                    : <span className="text-slate-300 text-[9px]">—</span>
                  }
                </td>
                <td className="px-3 py-2 font-bold select-all whitespace-nowrap">
                  {ticket.ticketNo}
                  {ticket.isDuplicate && (
                    <span className="ml-1.5 bg-amber-400 text-black px-1 py-0.5 rounded text-[8px] font-bold">DUP</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold uppercase ${getSourceColor(ticket.source || '')}`}>
                    {ticket.source || 'UNKNOWN'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {ticket.status
                    ? <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${STATUS_COLORS[ticket.status] ?? 'bg-slate-100 text-slate-500'}`}>{ticket.status}</span>
                    : <span className="text-slate-300">—</span>
                  }
                </td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{ticket.date}</td>
                <td className="px-3 py-2 text-[10px] text-slate-400">{ticket.route || '—'}</td>
                <td className="px-3 py-2 text-slate-500">{ticket.totalDoc > 0 ? fmt(ticket.totalDoc) : '—'}</td>
                <td className="px-3 py-2 text-slate-400">{ticket.commission > 0 ? fmt(ticket.commission) : '—'}</td>
                <td className={`px-3 py-2 font-bold ${ticket.amount < 0 ? 'text-red-600' : ''}`}>
                  {isEditing(ticket.id, 'amount') ? editorInput : (
                    <span
                      className={canEdit ? 'cursor-pointer hover:bg-slate-100 px-1 py-0.5 rounded' : ''}
                      onClick={() => startEdit(ticket, 'amount')}
                      title={canEdit ? 'Click to edit amount' : undefined}
                    >
                      {ticket.amount < 0 ? '-' : ''}{fmt(Math.abs(ticket.amount))}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {isEditing(ticket.id, 'pnr') ? editorInput : (
                    <span
                      className={canEdit ? 'cursor-pointer hover:bg-slate-100 px-1 py-0.5 rounded' : ''}
                      onClick={() => startEdit(ticket, 'pnr')}
                      title={canEdit ? 'Click to edit PNR' : undefined}
                    >
                      {ticket.pnr || '—'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500 max-w-[140px]">
                  {isEditing(ticket.id, 'passengerName') ? editorInput : (
                    <span
                      className={`block truncate ${canEdit ? 'cursor-pointer hover:bg-slate-100 px-1 py-0.5 rounded' : ''}`}
                      onClick={() => startEdit(ticket, 'passengerName')}
                      title={canEdit ? (ticket.passengerName || 'Click to edit name') : ticket.passengerName}
                    >
                      {ticket.passengerName || '—'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isEditing(ticket.id, 'reqNum') ? editorInput : (
                    <div
                      className={`font-bold inline-block px-1 py-0.5 rounded ${canEdit ? 'cursor-pointer hover:bg-slate-100' : ''} ${ticket.reqNum ? 'text-blue-600 underline' : 'text-red-400 italic'}`}
                      onClick={() => startEdit(ticket, 'reqNum')}
                      title={canEdit ? 'Click to edit' : undefined}
                    >
                      {ticket.reqNum || '[+ ADD]'}
                    </div>
                  )}
                </td>
                <td className={`px-3 py-2 font-bold text-[9px] ${!ticket.reqNum ? 'text-red-600' : 'text-emerald-600'}`}>
                  {!ticket.reqNum ? 'NEED REQ' : 'MATCHED'}
                </td>
                {onDelete && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => onDelete(ticket.id)} className="text-slate-300 hover:text-red-500 font-bold text-xs transition-colors">✕</button>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={onDelete ? 14 : 13} className="px-4 py-10 text-center text-slate-400 font-sans text-sm">
                  No tickets found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
