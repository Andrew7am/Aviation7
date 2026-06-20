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
  currency?: string;
}

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
  TKTT: 'bg-emerald-100 text-emerald-700',
  RFND: 'bg-red-100 text-red-700',
  VOID: 'bg-red-100 text-red-700',
  CANN: 'bg-slate-100 text-slate-500',
  CNJ: 'bg-blue-100 text-blue-700',
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
  tickets, title, defaultFilter = 'ALL', onDelete, onUpdateReqNum, currency = 'SAR',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'NEED_REQ' | 'DUPLICATE'>(defaultFilter);
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sources = useMemo(
    () => ['ALL', ...Array.from(new Set(tickets.map(t => t.source).filter(Boolean)))],
    [tickets]
  );

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (filterMode === 'NEED_REQ' && t.reqNum) return false;
      if (filterMode === 'DUPLICATE' && !t.isDuplicate) return false;
      if (sourceFilter !== 'ALL' && t.source !== sourceFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const haystack = `${t.ticketNo} ${t.reqNum} ${t.pnr} ${t.source} ${t.passengerName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, searchTerm, filterMode, sourceFilter]);

  const exportToExcel = () => {
    const data = filtered.map(t => ({
      'A/L': t.airlineCode || '',
      'Route': t.route || '',
      'Ticket No.': t.ticketNo,
      'Source': t.source || 'UNKNOWN',
      'Status': t.status || '',
      'Date': t.date,
      'Total Doc': t.totalDoc || '',
      'Commission': t.commission || '',
      'Net Amount': t.amount,
      'Currency': currency,
      'PNR': t.pnr || '',
      'Passenger': t.passengerName || '',
      'Req Num': t.reqNum || '',
      'Recon Status': t.reqNum ? 'MATCHED' : 'NEED REQ',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_Export.xlsx`);
  };

  const exportMissingReq = () => {
    const missing = tickets.filter(t => !t.reqNum);
    const data = missing.map(t => ({
      'A/L': t.airlineCode || '',
      'Route': t.route || '',
      'Ticket No.': t.ticketNo,
      'Source': t.source || '',
      'Status': t.status || '',
      'Date': t.date,
      'Net Amount': t.amount,
      'PNR': t.pnr || '',
      'Passenger': t.passengerName || '',
      'Req Num': '',  // blank — to be filled in and re-uploaded
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Missing REQ');
    XLSX.writeFile(wb, 'Missing_REQ_Numbers.xlsx');
  };

  const handleSave = (id: string) => {
    onUpdateReqNum?.(id, editValue.trim().toUpperCase());
    setEditingId(null);
  };

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
              {['A/L', 'Ticket No.', 'Source', 'Status', 'Date', 'Route', 'Total Doc', 'Comm', 'Net Amt', 'PNR', 'Passenger', 'Req Num', 'Recon'].map(col => (
                <th key={col} className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{col}</th>
              ))}
              {onDelete && <th className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase text-right">Del</th>}
            </tr>
          </thead>
          <tbody className="text-xs font-mono">
            {filtered.map(ticket => (
              <tr key={ticket.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!ticket.reqNum ? 'bg-red-50/20' : ''}`}>
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
                  {ticket.amount < 0 ? '-' : ''}{fmt(Math.abs(ticket.amount))}
                </td>
                <td className="px-3 py-2 text-slate-600">{ticket.pnr || '—'}</td>
                <td className="px-3 py-2 text-slate-500 max-w-[100px] truncate">{ticket.passengerName || '—'}</td>
                <td className="px-3 py-2">
                  {editingId === ticket.id ? (
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSave(ticket.id)}
                        className="w-20 px-1.5 py-0.5 text-xs font-bold border border-blue-400 rounded focus:outline-none focus:ring-1 ring-blue-400 uppercase"
                        autoFocus
                      />
                      <button onClick={() => handleSave(ticket.id)} className="text-blue-600 text-[9px] font-bold uppercase hover:underline">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-slate-400 text-[9px] uppercase">✕</button>
                    </div>
                  ) : (
                    <div
                      className={`font-bold cursor-pointer hover:bg-slate-100 inline-block px-1 py-0.5 rounded ${ticket.reqNum ? 'text-blue-600 underline' : 'text-red-400 italic'}`}
                      onClick={() => { setEditingId(ticket.id); setEditValue(ticket.reqNum || ''); }}
                      title="Click to edit"
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
                <td colSpan={onDelete ? 13 : 12} className="px-4 py-10 text-center text-slate-400 font-sans text-sm">
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
