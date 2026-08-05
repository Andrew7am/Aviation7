import React, { useState, useMemo, useEffect } from 'react';
import { Ticket } from '../types';
import { Search, Download, Filter, Replace, CheckCircle2, Circle } from 'lucide-react';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';
import * as XLSX from 'xlsx';

interface TicketTableProps {
  tickets: Ticket[];
  title: string;
  defaultFilter?: 'ALL' | 'NEED_REQ' | 'DUPLICATE';
  onDelete?: (id: string) => void;
  onUpdateReqNum?: (id: string, reqNum: string) => void;
  onUpdateTicket?: (id: string, patch: Partial<Ticket>) => void;
  onBulkUpdateReqNum?: (findVal: string, replaceVal: string, ids: string[]) => Promise<void>;
  onUpdateClosed?: (id: string, closed: boolean) => void;
  onBulkUpdateClosed?: (ids: string[], closed: boolean) => Promise<void>;
}

type EditableField = 'reqNum' | 'passengerName' | 'amount' | 'pnr';

type SortKey = 'serial' | 'date' | 'amount' | 'ticketNo' | 'source' | null;

/** Comparable value for a sort key, or null when the row has nothing to sort
 *  by. Amount sorts on the SIGNED value so refunds group at one end rather
 *  than interleaving with issues of a similar size. Dates are ISO strings,
 *  so a plain string compare is already chronological. */
function sortValue(t: Ticket, key: Exclude<SortKey, null>): number | string | null {
  switch (key) {
    case 'serial':   return t.serial ?? null;
    case 'date':     return t.date || null;
    case 'amount':   return t.amount ?? null;
    case 'ticketNo': return t.ticketNo || null;
    case 'source':   return t.source || null;
  }
}

/** Vendors whose workflow uses a "Closed / Not Closed" status. Other
 *  vendors don't have this concept — hide the toggle, exclude them from
 *  Closed/Not-Closed filtering, and skip them in bulk close/reopen. */
const CLOSED_VENDORS = new Set(['nsa', 'flyadeal ksa', 'flynas', 'ibtekar']);
const canBeClosed = (source: string) => CLOSED_VENDORS.has((source || '').toLowerCase().trim());

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
  'riyadh air': 'bg-violet-100 text-violet-700',
  'turkish': 'bg-red-100 text-red-700',
};

const STATUS_COLORS: Record<string, string> = {
  ISSUE:  'bg-emerald-100 text-emerald-700',
  REFUND: 'bg-red-100 text-red-700',
  FUND:   'bg-emerald-200 text-emerald-800',
  VOID:   'bg-slate-200 text-slate-600',
  HOLD:   'bg-amber-100 text-amber-800',
  ADM:    'bg-blue-100 text-blue-700',
  ACM:    'bg-purple-100 text-purple-700',
  TKTT: 'bg-emerald-100 text-emerald-700',
  RFND: 'bg-red-100 text-red-700',
  CANN: 'bg-slate-100 text-slate-500',
  CANX: 'bg-slate-200 text-slate-600',
  RFNX: 'bg-slate-200 text-slate-600',
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
  tickets, title, defaultFilter = 'ALL', onDelete, onUpdateReqNum, onUpdateTicket, onBulkUpdateReqNum, onUpdateClosed, onBulkUpdateClosed,
}) => {
  const [searchTerm, setSearchTerm]     = useState('');
  const [filterMode, setFilterMode]     = useState<'ALL' | 'NEED_REQ' | 'DUPLICATE'>(defaultFilter);
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [closedFilter, setClosedFilter] = useState<'ALL' | 'CLOSED' | 'NOT_CLOSED'>('ALL');
  const [filterAL, setFilterAL]         = useState('');
  const [filterPax, setFilterPax]       = useState('');
  const [filterPNR, setFilterPNR]       = useState('');
  const [showColFilters, setShowColFilters] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findVal, setFindVal]           = useState('');
  const [replaceVal, setReplaceVal]     = useState('');
  const [frBusy, setFrBusy]            = useState(false);
  const [bulkClosedBusy, setBulkClosedBusy] = useState(false);
  const [editingCell, setEditingCell]   = useState<{ id: string; field: EditableField } | null>(null);
  const [editValue, setEditValue]       = useState('');
  const [sortKey, setSortKey]           = useState<SortKey>(null);
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('asc');
  const [page, setPage]                 = useState(0);
  const PAGE_SIZE = 100;

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
      // Closed status is only tracked for a subset of vendors — exclude
      // everyone else when the user filters on closure state.
      if (closedFilter === 'CLOSED'     && (!canBeClosed(t.source) || !t.closed)) return false;
      if (closedFilter === 'NOT_CLOSED' && (!canBeClosed(t.source) ||  t.closed)) return false;
      if (filterAL  && !(t.airlineCode || '').toLowerCase().includes(filterAL.toLowerCase())) return false;
      if (filterPax && !(t.passengerName || '').toLowerCase().includes(filterPax.toLowerCase())) return false;
      if (filterPNR && !(t.pnr || '').toLowerCase().includes(filterPNR.toLowerCase())) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const haystack = `${t.ticketNo} ${t.reqNum} ${t.pnr} ${t.source} ${t.passengerName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        // Blanks always sink to the bottom regardless of direction — a row
        // with no date or no serial is missing data, not "the earliest", and
        // flipping the arrow shouldn't parade it to the top.
        const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return rows;
  }, [tickets, searchTerm, filterMode, sourceFilter, closedFilter, filterAL, filterPax, filterPNR, sortKey, sortDir]);

  useEffect(() => setPage(0), [searchTerm, filterMode, sourceFilter, closedFilter, filterAL, filterPax, filterPNR, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );

  // Tickets that will be affected by Find & Replace
  const frTargets = useMemo(() => {
    if (!findVal.trim()) return [];
    const q = findVal.trim().toUpperCase();
    return filtered.filter(t => (t.reqNum || '').toUpperCase() === q);
  }, [filtered, findVal]);

  const applyFindReplace = async () => {
    if (!onBulkUpdateReqNum || frTargets.length === 0 || !replaceVal.trim()) return;
    setFrBusy(true);
    try {
      await onBulkUpdateReqNum(findVal.trim(), replaceVal.trim(), frTargets.map(t => t.id));
      setFindVal(''); setReplaceVal(''); setShowFindReplace(false);
    } finally {
      setFrBusy(false);
    }
  };

  /** Bulk-close operates on the entire filtered result set — so the natural
   *  workflow is: search by req num (or any filter), then click Close All /
   *  Reopen All to flip every currently-visible ticket at once. */
  const applyBulkClosed = async (closed: boolean) => {
    if (!onBulkUpdateClosed) return;
    // Bulk close only touches vendors that support the flag — filter out
    // IATA / FlyDubai / AirArabia / etc. from the selection.
    const targets = filtered.filter(t => canBeClosed(t.source)).map(t => t.id);
    if (targets.length === 0) return;
    const label = closed ? 'Close' : 'Reopen';
    if (!confirm(`${label} ${targets.length} ticket${targets.length !== 1 ? 's' : ''} (current filter, NSA/FlyAdeal KSA/Flynas/Ibtekar only)?`)) return;
    setBulkClosedBusy(true);
    try {
      await onBulkUpdateClosed(targets, closed);
    } finally {
      setBulkClosedBusy(false);
    }
  };

  /** Click a sortable header to cycle: ascending -> descending -> unsorted. */
  const toggleSort = (key: Exclude<SortKey, null>) => {
    // Money and dates are most often wanted biggest/newest first, so that is
    // the opening direction; serial reads naturally low-to-high. Whichever it
    // starts on, the second click gives the OPPOSITE direction and only the
    // third turns sorting off — otherwise one of the two directions is
    // unreachable, which is what happened here: every non-serial column went
    // descending -> off and could never be sorted ascending at all.
    const first: 'asc' | 'desc' = key === 'serial' ? 'asc' : 'desc';
    const second: 'asc' | 'desc' = first === 'asc' ? 'desc' : 'asc';
    if (sortKey !== key)          { setSortKey(key); setSortDir(first); }
    else if (sortDir === first)   { setSortDir(second); }
    else                          { setSortKey(null); setSortDir('asc'); }
  };
  const sortArrow = (key: Exclude<SortKey, null>) =>
    sortKey !== key ? '' : sortDir === 'asc' ? ' ▲' : ' ▼';

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

  // Per-currency net totals
  const sarTotal = useMemo(() => filtered.filter(t => sourceToCurrency(t.source || '') === 'SAR').reduce((s, t) => s + t.amount, 0), [filtered]);
  const aedTotal = useMemo(() => filtered.filter(t => sourceToCurrency(t.source || '') === 'AED').reduce((s, t) => s + t.amount, 0), [filtered]);
  const hasSAR = filtered.some(t => sourceToCurrency(t.source || '') === 'SAR');
  const hasAED = filtered.some(t => sourceToCurrency(t.source || '') === 'AED');

  /** Build a filename that reflects what the user filtered by, so an export
   *  saved off a search for "REQ12345" lands as "REQ12345_Export.xlsx" not a
   *  generic title. Priority chain: general search text → find/replace target
   *  → column filters (PNR / passenger / A/L) → source/status filter → title.
   *  Sanitizes to filename-safe chars; caps at 40 to avoid OS length issues. */
  const filenameForFilter = (): string => {
    const sanitize = (s: string) => s.trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    const parts: string[] = [];
    if (searchTerm.trim()) parts.push(sanitize(searchTerm));
    else if (findVal.trim() && showFindReplace) parts.push('REQ_' + sanitize(findVal));
    else {
      if (filterPNR) parts.push('PNR_' + sanitize(filterPNR));
      if (filterPax) parts.push('PAX_' + sanitize(filterPax));
      if (filterAL)  parts.push('AL_'  + sanitize(filterAL));
      if (sourceFilter !== 'ALL') parts.push(sanitize(sourceFilter));
      if (closedFilter !== 'ALL') parts.push(closedFilter === 'CLOSED' ? 'Closed' : 'NotClosed');
      if (filterMode === 'NEED_REQ') parts.push('MissingREQ');
      else if (filterMode === 'DUPLICATE') parts.push('Duplicates');
    }
    if (parts.length === 0) parts.push(sanitize(title));
    return parts.join('-');
  };

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
      'Currency':    sourceToCurrency(t.source || ''),
      'PNR':         t.pnr || '',
      'Passenger':   t.passengerName || '',
      'Req Num':     t.reqNum || '',
      'Recon Status': t.reqNum ? 'MATCHED' : 'NEED REQ',
      'Closed':      t.closed ? 'Closed' : 'Not Closed',
      'Import Time': t.importTime || '',
      'Report Name': t.reportName || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);

    // Totals block, split by currency. A req-num report almost always mixes
    // SAR and AED vendors, and adding those together gives a meaningless
    // number — so each currency is totalled on its own line, with issued and
    // refunds shown separately so the net is auditable rather than just
    // asserted. Only currencies actually present are listed.
    const byCurrency = (cur: 'SAR' | 'AED') => {
      const rows = filtered.filter(t => sourceToCurrency(t.source || '') === cur);
      return {
        cur,
        count:   rows.length,
        issued:  rows.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0),
        refunds: rows.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
        net:     rows.reduce((s, t) => s + t.amount, 0),
      };
    };
    const totals = (['SAR', 'AED'] as const).map(byCurrency).filter(t => t.count > 0);

    const block: (string | number)[][] = [[], ['TOTALS BY CURRENCY']];
    block.push(['Currency', 'Tickets', 'Issued', 'Refunds', 'Net']);
    for (const t of totals) {
      block.push([t.cur, t.count, Number(t.issued.toFixed(2)), Number(t.refunds.toFixed(2)), Number(t.net.toFixed(2))]);
    }
    block.push([]);
    block.push(['Total tickets', filtered.length]);
    // The label names the exact filter this export was taken under, so a
    // saved file still says what it was a report OF weeks later.
    block.push(['Report filter', filenameForFilter().replace(/_/g, ' ')]);
    block.push(['Generated', new Date().toLocaleString()]);
    XLSX.utils.sheet_add_aoa(ws, block, { origin: -1 });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    XLSX.writeFile(wb, `${filenameForFilter()}_Export.xlsx`);
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
      'Currency':   sourceToCurrency(t.source || ''),
      'PNR':        t.pnr || '',
      'Passenger':  t.passengerName || '',
      'Req Num':    '',
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
  const isEditing = (id: string, field: EditableField) => editingCell?.id === id && editingCell.field === field;

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

  const activeColFilters = [filterAL, filterPax, filterPNR].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* Header */}
      <div className="p-4 flex flex-wrap justify-between items-center gap-2 shrink-0 bg-white border-b border-slate-200">
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* General search */}
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

          {/* Closed / Not Closed filter */}
          <select
            value={closedFilter}
            onChange={e => setClosedFilter(e.target.value as any)}
            className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase border focus:outline-none transition-colors ${
              closedFilter === 'CLOSED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : closedFilter === 'NOT_CLOSED' ? 'bg-orange-50 text-orange-700 border-orange-200'
              : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            <option value="ALL">All Closure</option>
            <option value="CLOSED">Closed</option>
            <option value="NOT_CLOSED">Not Closed</option>
          </select>

          {/* Bulk close / reopen — operates on entire filtered set */}
          {onBulkUpdateClosed && filtered.length > 0 && (searchTerm || closedFilter !== 'ALL' || filterAL || filterPax || filterPNR || sourceFilter !== 'ALL') && (
            <>
              <button
                onClick={() => applyBulkClosed(true)}
                disabled={bulkClosedBusy}
                title={`Mark all ${filtered.length} filtered tickets as Closed`}
                className="px-2 py-1.5 bg-emerald-600 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1"
              >
                <CheckCircle2 className="w-3 h-3" />
                Close ({filtered.length})
              </button>
              <button
                onClick={() => applyBulkClosed(false)}
                disabled={bulkClosedBusy}
                title={`Mark all ${filtered.length} filtered tickets as Not Closed`}
                className="px-2 py-1.5 bg-orange-600 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-orange-700 disabled:opacity-40 flex items-center gap-1"
              >
                <Circle className="w-3 h-3" />
                Reopen
              </button>
            </>
          )}

          {/* Column filters toggle */}
          <button
            onClick={() => setShowColFilters(v => !v)}
            className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase border transition-colors flex items-center gap-1 ${
              showColFilters || activeColFilters > 0
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3 h-3" />
            Filters{activeColFilters > 0 ? ` (${activeColFilters})` : ''}
          </button>

          {/* Find & Replace toggle */}
          {onBulkUpdateReqNum && (
            <button
              onClick={() => setShowFindReplace(v => !v)}
              className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase border transition-colors flex items-center gap-1 ${
                showFindReplace ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Replace className="w-3 h-3" />
              Find &amp; Replace
            </button>
          )}

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

      {/* Column-specific filters panel */}
      {showColFilters && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex flex-wrap items-center gap-3 shrink-0">
          <span className="text-[9px] font-bold uppercase text-blue-500 tracking-wider">Filter by column:</span>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-blue-400 font-mono uppercase">A/L</span>
            <input
              type="text" placeholder="e.g. 065"
              value={filterAL} onChange={e => setFilterAL(e.target.value)}
              className="w-20 px-1.5 py-1 text-[10px] font-mono border border-blue-200 rounded focus:outline-none focus:ring-1 ring-blue-400 bg-white"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-blue-400 font-mono uppercase">Passenger</span>
            <input
              type="text" placeholder="name..."
              value={filterPax} onChange={e => setFilterPax(e.target.value)}
              className="w-32 px-1.5 py-1 text-[10px] font-mono border border-blue-200 rounded focus:outline-none focus:ring-1 ring-blue-400 bg-white"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-blue-400 font-mono uppercase">PNR</span>
            <input
              type="text" placeholder="PNR..."
              value={filterPNR} onChange={e => setFilterPNR(e.target.value)}
              className="w-24 px-1.5 py-1 text-[10px] font-mono border border-blue-200 rounded focus:outline-none focus:ring-1 ring-blue-400 bg-white"
            />
          </div>
          {activeColFilters > 0 && (
            <button
              onClick={() => { setFilterAL(''); setFilterPax(''); setFilterPNR(''); }}
              className="text-[9px] text-blue-500 hover:text-blue-700 font-bold underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Find & Replace panel */}
      {showFindReplace && (
        <div className="px-4 py-2 bg-violet-50 border-b border-violet-100 flex flex-wrap items-center gap-3 shrink-0">
          <span className="text-[9px] font-bold uppercase text-violet-500 tracking-wider">Find &amp; Replace REQ:</span>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-violet-400 font-mono">Find</span>
            <input
              type="text" placeholder="current req num..."
              value={findVal} onChange={e => setFindVal(e.target.value)}
              className="w-36 px-1.5 py-1 text-[10px] font-mono border border-violet-200 rounded focus:outline-none focus:ring-1 ring-violet-400 bg-white"
            />
          </div>
          <span className="text-violet-300 font-bold">→</span>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-violet-400 font-mono">Replace</span>
            <input
              type="text" placeholder="new req num..."
              value={replaceVal} onChange={e => setReplaceVal(e.target.value)}
              className="w-36 px-1.5 py-1 text-[10px] font-mono border border-violet-200 rounded focus:outline-none focus:ring-1 ring-violet-400 bg-white"
            />
          </div>
          {findVal.trim() && (
            <span className={`text-[9px] font-bold font-mono ${frTargets.length > 0 ? 'text-violet-600' : 'text-slate-400'}`}>
              {frTargets.length} ticket{frTargets.length !== 1 ? 's' : ''} will be updated
            </span>
          )}
          <button
            onClick={applyFindReplace}
            disabled={frBusy || frTargets.length === 0 || !replaceVal.trim()}
            className="px-3 py-1 bg-violet-600 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {frBusy ? 'Applying...' : 'Apply'}
          </button>
          <button onClick={() => { setShowFindReplace(false); setFindVal(''); setReplaceVal(''); }} className="text-[9px] text-violet-400 hover:text-violet-600 font-bold">✕ Close</button>
        </div>
      )}

      {/* Summary row */}
      <div className="flex items-center space-x-4 px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0 text-[10px] font-mono text-slate-500">
        <span>{filtered.length} tickets</span>
        <span className="text-slate-300">|</span>
        {hasSAR && <span className={sarTotal < 0 ? 'text-red-600 font-bold' : 'text-slate-600'}>Net SAR: {fmt(sarTotal)}</span>}
        {hasSAR && hasAED && <span className="text-slate-300">·</span>}
        {hasAED && <span className={aedTotal < 0 ? 'text-red-600 font-bold' : 'text-slate-600'}>Net AED: {fmt(aedTotal)}</span>}
        <span className="text-slate-300">|</span>
        <span className="text-red-500">{filtered.filter(t => !t.reqNum).length} missing req</span>
        <span className="text-slate-300">|</span>
        <span className="text-emerald-600">{filtered.filter(t => canBeClosed(t.source) && t.closed).length} closed</span>
        <span className="text-orange-600">· {filtered.filter(t => canBeClosed(t.source) && !t.closed).length} not closed</span>
      </div>

      {/* Table */}
      <div className="flex-1 mx-4 my-4 bg-white border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
              {/* Sortable headers cycle ascending -> descending -> unsorted. */}
              {([
                ['Serial',     'serial'],
                ['A/L',        null],
                ['Ticket No.', 'ticketNo'],
                ['Source',     'source'],
                ['Status',     null],
                ['Date',       'date'],
                ['Route',      null],
                ['Total Doc',  null],
                ['Comm',       null],
                ['Net Amt',    'amount'],
                ['Curr',       null],
                ['PNR',        null],
                ['Passenger',  null],
                ['Req Num',    null],
                ['Recon',      null],
                ['Closed',     null],
              ] as [string, Exclude<SortKey, null> | null][]).map(([label, key]) => (
                <th
                  key={label}
                  onClick={key ? () => toggleSort(key) : undefined}
                  title={key ? `Sort by ${label}` : undefined}
                  className={`px-3 py-2 text-[9px] font-bold uppercase whitespace-nowrap ${
                    key
                      ? `cursor-pointer select-none hover:text-slate-700 ${sortKey === key ? 'text-blue-600' : 'text-slate-500'}`
                      : 'text-slate-500'
                  }`}
                >
                  {label}{key ? sortArrow(key) : ''}
                </th>
              ))}
              {onDelete && <th className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase text-right">Del</th>}
            </tr>
          </thead>
          <tbody className="text-xs font-mono">
            {paged.map(ticket => {
              const ticketCurrency = sourceToCurrency(ticket.source || '');
              return (
                <tr key={ticket.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!ticket.reqNum ? 'bg-red-50/20' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {ticket.serial != null ? (
                      <span className="text-slate-500">{ticket.serial}</span>
                    ) : <span className="text-slate-300">—</span>}
                    {serialGapBefore.has(ticket.id) && (
                      <span className="ml-1.5 bg-red-100 text-red-700 px-1 py-0.5 rounded text-[8px] font-bold">
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
                  {/* Negative values must render, not collapse to an em-dash:
                      a refund's clawed-back commission is real data, and
                      hiding it makes the net amount look unexplainable. */}
                  <td className="px-3 py-2 text-slate-500">{ticket.totalDoc ? fmt(ticket.totalDoc) : '—'}</td>
                  <td className={`px-3 py-2 ${ticket.commission < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    {ticket.commission ? fmt(ticket.commission) : '—'}
                  </td>
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
                  <td className="px-3 py-2 text-[9px] font-bold text-slate-400">{ticketCurrency}</td>
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
                  <td className="px-3 py-2">
                    {!canBeClosed(ticket.source || '') ? (
                      <span className="text-slate-300 text-[9px]">—</span>
                    ) : onUpdateClosed ? (
                      <button
                        onClick={() => onUpdateClosed(ticket.id, !ticket.closed)}
                        title={ticket.closed ? 'Click to reopen' : 'Click to close'}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 transition-colors ${
                          ticket.closed
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        }`}
                      >
                        {ticket.closed ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Circle className="w-2.5 h-2.5" />}
                        {ticket.closed ? 'Closed' : 'Not Closed'}
                      </button>
                    ) : (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${ticket.closed ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                        {ticket.closed ? 'Closed' : 'Not Closed'}
                      </span>
                    )}
                  </td>
                  {onDelete && (
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => onDelete(ticket.id)} className="text-slate-300 hover:text-red-500 font-bold text-xs transition-colors">✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={onDelete ? 17 : 16} className="px-4 py-10 text-center text-slate-400 font-sans text-sm">
                  No tickets found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-white border-t border-slate-200 text-[10px] font-mono text-slate-500">
          <span>Page {page + 1} of {totalPages} · showing {paged.length} of {filtered.length}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30">«</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30">‹ Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30">Next ›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30">»</button>
          </div>
        </div>
      )}
    </div>
  );
};
