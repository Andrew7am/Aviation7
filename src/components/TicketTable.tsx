import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Ticket } from '../types';
import { Search, Download, Filter, Replace, CheckCircle2, Circle, Calendar, X, ChevronDown } from 'lucide-react';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';
import { ticketMatchKey } from '../core/helpers/ticketIdentity';
import { classifyTravel, TRAVEL_LABEL, type TravelScope } from '../core/helpers/travelScope';
import { CABIN_LABEL, type Cabin } from '../core/helpers/cabinClass';
import { classifyOffice, OFFICE_LABEL, type Office } from '../core/helpers/reqOffice';
import { airlineName } from '../core/config/airlines';
import { endOfMonth, monthLabel, monthsIn, selectedMonth } from '../core/helpers/period';
import * as XLSX from 'xlsx';

interface TicketTableProps {
  tickets: Ticket[];
  title: string;
  defaultFilter?: 'ALL' | 'NEED_REQ' | 'DUPLICATE';
  /** Opens the table already narrowed to a closure state, so a view can be
   *  "the outstanding list" without the user having to find the dropdown. */
  defaultClosed?: 'ALL' | 'CLOSED' | 'NOT_CLOSED';
  onDelete?: (id: string) => void;
  onUpdateReqNum?: (id: string, reqNum: string) => void;
  onUpdateTicket?: (id: string, patch: Partial<Ticket>) => void;
  onBulkUpdateReqNum?: (findVal: string, replaceVal: string, ids: string[]) => Promise<void>;
  onUpdateClosed?: (id: string, closed: boolean) => void;
  onBulkUpdateClosed?: (ids: string[], closed: boolean) => Promise<void>;
}

type EditableField = 'reqNum' | 'passengerName' | 'amount' | 'pnr';

type SortKey =
  | 'serial' | 'airlineCode' | 'ticketNo' | 'source' | 'status' | 'date'
  | 'route' | 'travel' | 'cabin' | 'totalDoc' | 'commission' | 'amount'
  | 'currency' | 'pnr' | 'passengerName' | 'reqNum' | 'closed'
  | null;

/** Cabins sort by where they sit on the aircraft, not alphabetically — First
 *  above Business above Economy is the order anyone means by "sort by cabin",
 *  and A-before-B would put Business above First. */
const CABIN_ORDER: Record<string, number> = {
  FIRST: 0, BUSINESS: 1, PREMIUM_ECONOMY: 2, ECONOMY: 3,
};

/** Comparable value for a sort key, or null when the row has nothing to sort
 *  by. Amount sorts on the SIGNED value so refunds group at one end rather
 *  than interleaving with issues of a similar size. Dates are ISO strings,
 *  so a plain string compare is already chronological.
 *
 *  Every column on screen is here. A column that shows something derived
 *  rather than stored — Travel from the route, Cabin from its class — sorts on
 *  what the eye sees, not on the field behind it. */
function sortValue(t: Ticket, key: Exclude<SortKey, null>): number | string | null {
  switch (key) {
    case 'serial':        return t.serial ?? null;
    case 'airlineCode':   return t.airlineCode || null;
    case 'ticketNo':      return t.ticketNo || null;
    case 'source':        return t.source || null;
    case 'status':        return t.status || null;
    case 'date':          return t.date || null;
    case 'route':         return t.route || null;
    case 'travel':        return classifyTravel(t.route) || null;
    case 'cabin':         return t.cabinClass ? (CABIN_ORDER[t.cabinClass] ?? 9) : null;
    // Zero is a real fare and a real commission — a ticket issued at no charge,
    // a sale that earned nothing — so they sort as zero rather than sinking to
    // the bottom with the rows that never had the column at all.
    case 'totalDoc':      return t.totalDoc ?? null;
    case 'commission':    return t.commission ?? null;
    case 'amount':        return t.amount ?? null;
    case 'currency':      return sourceToCurrency(t.source || '') || null;
    case 'pnr':           return t.pnr || null;
    case 'passengerName': return t.passengerName || null;
    case 'reqNum':        return t.reqNum || null;
    // Not Closed first when ascending: the outstanding ones are what anyone
    // sorting this column is looking for.
    case 'closed':        return t.closed ? 1 : 0;
  }
}

/** Closed / Not Closed is a follow-up state on the AGENCY's side — has this
 *  document been reconciled and finalised with the client — so it applies to
 *  every ticket regardless of which vendor issued it. It used to be offered
 *  for four vendors only, which left the rest with a dash and no way to track
 *  the same workflow. The `closed` column has always existed for every row. */

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

/**
 * A total that can be clicked to copy.
 *
 * The number copied is the PLAIN one — "5295441.46", not "5,295,441.46" — so
 * it pastes into a spreadsheet or an invoice as a value rather than as text a
 * locale has to re-interpret. The separators are only there to be read.
 *
 * navigator.clipboard needs a secure context, which production has and a plain
 * http origin does not, so a failure falls back to the old textarea trick and
 * then says so instead of silently doing nothing.
 */
const CopyableAmount: React.FC<{
  label: string;
  value: number;
  fmt: (n: number) => string;
}> = ({ label, value, fmt }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    const plain = value.toFixed(2);
    try {
      await navigator.clipboard.writeText(plain);
      setState('copied');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = plain;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        setState(ok ? 'copied' : 'failed');
      } catch {
        setState('failed');
      }
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Click to copy ${value.toFixed(2)}`}
      className={`font-mono rounded px-1 -mx-1 transition-colors hover:bg-slate-200 ${
        state === 'copied' ? 'text-emerald-600 font-bold'
        : state === 'failed' ? 'text-red-600 font-bold'
        : value < 0 ? 'text-red-600 font-bold' : 'text-slate-600'
      }`}
    >
      {state === 'copied' ? `${label}: copied`
       : state === 'failed' ? `${label}: press Ctrl+C`
       : `${label}: ${fmt(value)}`}
    </button>
  );
};

/** The itinerary's verdict as text, blank when the route says nothing. */
const travelText = (route?: string): string => {
  const s = classifyTravel(route);
  return s ? TRAVEL_LABEL[s] : '';
};

/** The cabin as text for a spreadsheet: the reading when there is one, and
 *  otherwise the wording the source used, so nothing is exported as blank that
 *  the source actually said something about. */
const cabinText = (t: Ticket): string =>
  t.cabinClass ? (CABIN_LABEL[t.cabinClass as Exclude<Cabin, ''>] ?? t.cabinClass) : (t.cabinRaw || '');

/** Domestic / International, or an em-dash when there is no route to read. */
const TravelBadge: React.FC<{ route?: string }> = ({ route }) => {
  const scope = classifyTravel(route);
  if (!scope) return <span className="text-slate-300 text-[9px]">—</span>;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap ${
      scope === 'DOMESTIC' ? 'bg-teal-100 text-teal-700' : 'bg-blue-100 text-blue-700'
    }`}>
      {TRAVEL_LABEL[scope]}
    </span>
  );
};

/**
 * The cabin the ticket was sold in.
 *
 * Hovering shows what the source actually called it, which is often longer
 * than the badge — "Economy; Business" for a journey that ran through both, or
 * "Business Elite" for a name the airline invented. The badge shows the cabin;
 * the tooltip shows the wording it was read from.
 */
const CABIN_STYLE: Record<string, string> = {
  FIRST:           'bg-purple-100 text-purple-700',
  BUSINESS:        'bg-blue-100 text-blue-700',
  PREMIUM_ECONOMY: 'bg-teal-100 text-teal-700',
  ECONOMY:         'bg-slate-100 text-slate-600',
};

const CabinBadge: React.FC<{ cabin?: string; raw?: string }> = ({ cabin, raw }) => {
  if (!cabin) {
    // A cabin name the reader could not place still gets shown, greyed, rather
    // than reduced to an em-dash as if the source had said nothing.
    return raw
      ? <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-50 text-amber-700 whitespace-nowrap"
              title={`Not recognised as a cabin: ${raw}`}>{raw}</span>
      : <span className="text-slate-300 text-[9px]">—</span>;
  }
  const label = CABIN_LABEL[cabin as Exclude<Cabin, ''>] ?? cabin;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap ${
      CABIN_STYLE[cabin] ?? 'bg-slate-100 text-slate-600'}`}
      title={raw && raw.toLowerCase() !== label.toLowerCase() ? `Source: ${raw}` : label}>
      {label}
    </span>
  );
};

export const TicketTable: React.FC<TicketTableProps> = ({
  tickets, title, defaultFilter = 'ALL', defaultClosed = 'ALL', onDelete, onUpdateReqNum, onUpdateTicket, onBulkUpdateReqNum, onUpdateClosed, onBulkUpdateClosed,
}) => {
  const [searchTerm, setSearchTerm]     = useState('');
  const [filterMode, setFilterMode]     = useState<'ALL' | 'NEED_REQ' | 'DUPLICATE'>(defaultFilter);
  // Vendors are multi-select: comparing NSA against IATA, or a handful of
  // portals at once, is the normal reconciliation question. Empty = every
  // vendor, so the filter starts out of the way.
  const [sourceSel, setSourceSel]       = useState<string[]>([]);
  const [showSources, setShowSources]   = useState(false);
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [closedFilter, setClosedFilter] = useState<'ALL' | 'CLOSED' | 'NOT_CLOSED'>(defaultClosed);
  const [travelFilter, setTravelFilter] = useState<'ALL' | TravelScope>('ALL');
  const [cabinFilter, setCabinFilter]   = useState<string>('ALL');
  /** Which office raised the request, read off the req number's prefix. */
  const [officeFilter, setOfficeFilter] = useState<string>('ALL');
  const [filterTicket, setFilterTicket] = useState('');
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
    () => Array.from(new Set(tickets.map(t => t.source).filter(Boolean))).sort(),
    [tickets]
  );

  /** Months present in the data, newest first — the quick-pick for "show me
   *  April". */
  const months = useMemo(() => monthsIn(tickets.map(t => t.date)), [tickets]);

  const monthSel = selectedMonth(dateFrom, dateTo);

  const pickMonth = (m: string) => {
    if (!m) { setDateFrom(''); setDateTo(''); return; }
    setDateFrom(`${m}-01`);
    setDateTo(endOfMonth(m));
  };

  const toggleSource = (s: string) =>
    setSourceSel(cur => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);

  // Close the vendor popover on an outside click, so it behaves like a menu.
  const srcRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showSources) return;
    const onDown = (e: MouseEvent) => {
      if (srcRef.current && !srcRef.current.contains(e.target as Node)) setShowSources(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSources]);

  const filtered = useMemo(() => {
    const rows = tickets.filter(t => {
      if (filterMode === 'NEED_REQ' && (t.reqNum || t.status === 'FUND')) return false;
      if (filterMode === 'DUPLICATE' && !t.isDuplicate) return false;
      // No vendor ticked means every vendor, not none.
      if (sourceSel.length > 0 && !sourceSel.includes(t.source)) return false;
      // Dates are YYYY-MM-DD, so these compare as strings. A row with no date
      // cannot satisfy a date window, so it drops out while one is set.
      if (dateFrom || dateTo) {
        const d = t.date || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo   && d > dateTo)   return false;
      }
      // Closed status is only tracked for a subset of vendors — exclude
      // everyone else when the user filters on closure state.
      // A top-up has no closure state, so it belongs to neither side of this
      // filter rather than falling into "not closed" by default.
      if (closedFilter !== 'ALL' && t.status === 'FUND') return false;
      if (closedFilter === 'CLOSED'     && !t.closed) return false;
      if (closedFilter === 'NOT_CLOSED' &&  t.closed) return false;
      // Domestic / international is read off the itinerary, so a ticket with
      // no route satisfies neither — it is unknown, not one or the other.
      if (travelFilter !== 'ALL' && classifyTravel(t.route) !== travelFilter) return false;
      // "Not recorded" finds the tickets nobody wrote a cabin for, which is
      // how that gap gets closed rather than just counted.
      if (cabinFilter !== 'ALL') {
        if (cabinFilter === 'NONE') { if (t.cabinClass) return false; }
        else if (t.cabinClass !== cabinFilter) return false;
      }
      // "Other" is the useful half of this filter as much as the three
      // offices: it is how the req numbers that are markers rather than
      // requests — ADM, VOID, CREDIT MEMO, someone's name — get found.
      if (officeFilter !== 'ALL') {
        const office = classifyOffice(t.reqNum);
        if (officeFilter === 'OTHER') { if (office) return false; }
        else if (office !== officeFilter) return false;
      }
      // Ticket numbers are stored as the bare 10-digit serial, but the number
      // to hand is often the full 13-digit one off the airline's site or an
      // older report. Both are matched, so pasting either finds the document.
      if (filterTicket) {
        const q = ticketMatchKey(filterTicket);
        if (!q || !t.ticketNo.toUpperCase().includes(q)) return false;
      }
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
  }, [tickets, searchTerm, filterMode, sourceSel, dateFrom, dateTo, closedFilter, travelFilter, cabinFilter, officeFilter, filterTicket, filterAL, filterPax, filterPNR, sortKey, sortDir]);

  useEffect(() => setPage(0), [searchTerm, filterMode, sourceSel, dateFrom, dateTo, closedFilter, travelFilter, cabinFilter, officeFilter, filterTicket, filterAL, filterPax, filterPNR, sortKey, sortDir]);

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
    const targets = filtered.map(t => t.id);
    if (targets.length === 0) return;
    const label = closed ? 'Close' : 'Reopen';
    // Name the count and say it follows the filter — this flips every visible
    // row, so the user needs to know the filter is the selection.
    if (!confirm(`${label} all ${targets.length} ticket${targets.length !== 1 ? 's' : ''} in the current filter?`)) return;
    setBulkClosedBusy(true);
    try {
      await onBulkUpdateClosed(targets, closed);
    } finally {
      setBulkClosedBusy(false);
    }
  };

  /** Click a sortable header to cycle: ascending -> descending -> unsorted. */
  const toggleSort = (key: Exclude<SortKey, null>) => {
    // Whichever direction it starts on, the second click gives the OPPOSITE
    // one and only the third turns sorting off — otherwise one of the two is
    // unreachable, which is what used to happen here: every column but serial
    // went descending -> off and could never be sorted ascending at all.
    //
    // Which direction opens depends on the column. Money and dates are wanted
    // biggest and newest first; a name, a route or a PNR is wanted A-to-Z, and
    // opening those on Z-to-A would be answering a question nobody asked.
    const DESC_FIRST = new Set<Exclude<SortKey, null>>([
      'date', 'amount', 'totalDoc', 'commission',
    ]);
    const first: 'asc' | 'desc' = DESC_FIRST.has(key) ? 'desc' : 'asc';
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
      if (travelFilter === 'DOMESTIC') parts.push('Domestic');
      else if (travelFilter === 'INTERNATIONAL') parts.push('International');
      if (filterTicket) parts.push('TK_' + sanitize(filterTicket));
      if (filterPNR) parts.push('PNR_' + sanitize(filterPNR));
      if (filterPax) parts.push('PAX_' + sanitize(filterPax));
      if (filterAL)  parts.push('AL_'  + sanitize(filterAL));
      // Name every selected vendor, up to a point — an export filtered to
      // three portals should say so, but not run to a 200-character filename.
      if (sourceSel.length > 0) {
        parts.push(sourceSel.length <= 3 ? sourceSel.map(sanitize).join('_')
                                         : `${sourceSel.length}_vendors`);
      }
      if (monthSel) parts.push(monthSel);
      else if (dateFrom || dateTo) parts.push(`${dateFrom || 'start'}_to_${dateTo || 'end'}`);
      if (closedFilter !== 'ALL') parts.push(closedFilter === 'CLOSED' ? 'Closed' : 'NotClosed');
      if (filterMode === 'NEED_REQ') parts.push('MissingREQ');
      else if (filterMode === 'DUPLICATE') parts.push('Duplicates');
    }
    if (parts.length === 0) parts.push(sanitize(title));
    return parts.join('-');
  };

  const exportToExcel = () => {
    /**
     * Columns are chosen from what the exported rows actually contain, so a
     * review sheet never carries a column that is the same on every line or
     * empty on every line.
     *
     * Permanently dropped:
     *   Report Name  — held the vendor name, identical to Source on every row
     *   Type         — identical to Status on every row
     *   Recon Status — always "MATCHED" once a req num exists, and a ticket
     *                  without one cannot appear in a req-num report at all
     *   Import Time  — a system timestamp, not something being reviewed
     */
    const has = {
      serial: filtered.some(t => t.serial != null),
      al:     filtered.some(t => !!t.airlineCode),
      route:  filtered.some(t => !!t.route),
      pnr:    filtered.some(t => !!t.pnr),
      pax:    filtered.some(t => !!t.passengerName),
      comm:   filtered.some(t => !!t.commission),
      cabin:  filtered.some(t => !!t.cabinClass || !!t.cabinRaw),
      office: filtered.some(t => !!classifyOffice(t.reqNum)),
      // Total Doc only earns a column when it differs from the net somewhere.
      total:  filtered.some(t => Math.abs((t.totalDoc ?? 0) - Math.abs(t.amount)) > 0.005),
      closed: filtered.length > 0,
    };

    type Col = { key: string; get: (t: Ticket) => string | number; w: number; money?: boolean };
    const cols: Col[] = [
      ...(has.serial ? [{ key: '#',          get: (t: Ticket) => t.serial ?? '', w: 7 }] : []),
      { key: 'Date',        get: (t: Ticket) => t.date || '',            w: 11 },
      ...(has.al ? [{ key: 'A/L',            get: (t: Ticket) => t.airlineCode || '', w: 6 }] : []),
      { key: 'Ticket No.',  get: (t: Ticket) => t.ticketNo,              w: 16 },
      // With a single vendor the value repeats on every line; the filename
      // and the totals block already name it.
      // Always present, exactly once. The old sheet printed the vendor twice
      // (Source in the middle, Report Name at the end); the fix is dropping
      // the duplicate, not the column itself.
      { key: 'Source', get: (t: Ticket) => t.source || 'UNKNOWN', w: 15 },
      { key: 'Status',      get: (t: Ticket) => t.status || '',          w: 9 },
      ...(has.route ? [{ key: 'Route',       get: (t: Ticket) => t.route || '',  w: 18 }] : []),
      ...(has.route ? [{ key: 'Travel',      get: (t: Ticket) => travelText(t.route), w: 13 }] : []),
      ...(has.cabin ? [{ key: 'Cabin',       get: (t: Ticket) => cabinText(t), w: 15 }] : []),
      ...(has.pnr   ? [{ key: 'PNR',         get: (t: Ticket) => t.pnr || '',    w: 9 }] : []),
      ...(has.pax   ? [{ key: 'Passenger',   get: (t: Ticket) => t.passengerName || '', w: 26 }] : []),
      ...(has.total ? [{ key: 'Fare',        get: (t: Ticket) => t.totalDoc ?? 0, w: 12, money: true }] : []),
      ...(has.comm  ? [{ key: 'Commission',  get: (t: Ticket) => t.commission ?? 0, w: 12, money: true }] : []),
      { key: 'Balance Payable', get: (t: Ticket) => t.amount ?? 0,           w: 13, money: true },
      { key: 'Cur',         get: (t: Ticket) => sourceToCurrency(t.source || ''), w: 6 },
      { key: 'Req Num',     get: (t: Ticket) => t.reqNum || '',          w: 14 },
      ...(has.office ? [{ key: 'Office',
        get: (t: Ticket) => OFFICE_LABEL[classifyOffice(t.reqNum) as Exclude<Office, ''>] ?? '',
        w: 10 }] : []),
      ...(has.closed ? [{ key: 'Closed', get: (t: Ticket) => t.closed ? 'Closed' : 'Not Closed', w: 11 }] : []),
    ];

    const data = filtered.map(t => Object.fromEntries(cols.map(c => [c.key, c.get(t)])));
    const ws = XLSX.utils.json_to_sheet(data, { header: cols.map(c => c.key) });

    // Presentation: sized columns so nothing shows as ####, a filter dropdown
    // on every heading, and real Excel number formatting on the money columns
    // (negatives in red brackets) so refunds stand out while reviewing.
    ws['!cols'] = cols.map(c => ({ wch: c.w }));
    const lastCol = XLSX.utils.encode_col(cols.length - 1);
    ws['!autofilter'] = { ref: `A1:${lastCol}${filtered.length + 1}` };
    // (No freeze-pane line here: this build of SheetJS writes no <pane>
    //  element, so setting !freeze would look like it worked and do nothing.)
    cols.forEach((c, ci) => {
      if (!c.money) return;
      for (let r = 1; r <= filtered.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ c: ci, r })];
        if (cell && typeof cell.v === 'number') cell.z = '#,##0.00;[Red](#,##0.00)';
      }
    });

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

  /** One row of a worklist export. Shared so the two lists cannot drift into
   *  describing the same ticket differently. */
  const worklistRow = (t: Ticket) => ({
    'A/L':        t.airlineCode || '',
    'Route':      t.route || '',
    'Travel':     travelText(t.route),
    'Ticket No.': t.ticketNo,
    'Source':     t.source || '',
    'Status':     t.status || '',
    'Date':       t.date,
    'Balance Payable': t.amount,
    'Currency':   sourceToCurrency(t.source || ''),
    'PNR':        t.pnr || '',
    'Passenger':  t.passengerName || '',
  });

  const writeSheet = (rows: object[], sheetName: string, fileName: string) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };

  const exportMissingReq = () => {
    const missing = tickets.filter(t => !t.reqNum && t.status !== 'FUND');
    // Req Num is deliberately blank: this sheet exists to be filled in and
    // re-imported, and a column with something already in it invites editing
    // the wrong row.
    writeSheet(missing.map(t => ({ ...worklistRow(t), 'Req Num': '' })),
      'Missing REQ', 'Missing_REQ_Numbers.xlsx');
  };

  /**
   * Everything still outstanding, whatever the screen is currently filtered to.
   *
   * Deliberately ignores the filters, the way the missing-REQ export does: this
   * is the "what is still open" list, and getting a partial one because a
   * vendor or a month happened to be selected would be worse than useless. A
   * narrower slice is still available by filtering and using Export XLS.
   *
   * Top-ups are left out — a balance payment is not a ticket that can be
   * closed.
   */
  const exportNotClosed = () => {
    const open = tickets
      .filter(t => !t.closed && t.status !== 'FUND')
      .sort((a, b) => (a.source || '').localeCompare(b.source || '')
                   || (a.date || '').localeCompare(b.date || ''));
    writeSheet(open.map(t => ({ ...worklistRow(t), 'Req Num': t.reqNum || '', 'Closed': 'Not Closed' })),
      'Not Closed', 'Not_Closed_Tickets.xlsx');
  };

  const notClosedCount = useMemo(
    () => tickets.filter(t => !t.closed && t.status !== 'FUND').length,
    [tickets]
  );

  const canEdit = !!onUpdateReqNum || !!onUpdateTicket;

  /**
   * Click a cell to copy it.
   *
   * A viewer cannot change anything, which left them dragging a selection
   * across a monospace table to lift a PNR — and the passenger column is
   * truncated, so the full name could not be selected at all. Clicking copies
   * the whole value, truncated or not.
   *
   * It applies to anyone on any cell they cannot edit: for a viewer that is
   * every cell, and for an admin it is everything except the four that open an
   * editor, which keep their own click.
   */
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(''), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCellClick = async (e: React.MouseEvent<HTMLTableSectionElement>) => {
    const el = e.target as HTMLElement;
    // An editor's own controls, the delete button, the closed toggle: those
    // clicks mean something already.
    if (el.closest('button, input, select, textarea, a')) return;
    // On an editable cell the admin's click opens the editor instead.
    if (canEdit && el.closest('[data-editable]')) return;

    const cell = el.closest('td');
    if (!cell) return;
    // What the eye sees, minus the decorations a badge stacks underneath it.
    let text = (cell.innerText || '').trim().split('\n')[0].trim();
    if (!text || text === '—' || text === '[+ ADD]') return;
    // A money cell copies the plain number — "2810.00", not "2,810.00" — so it
    // pastes into a spreadsheet as a value rather than as text a locale has to
    // re-interpret. The separators are only there to be read.
    if (/^-?[\d,]+\.\d{2}$/.test(text)) text = text.replace(/,/g, '');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      // navigator.clipboard needs a secure context, which a plain http origin
      // is not. The old textarea trick still works there.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(ok ? text : '');
      } catch { /* nothing more to try; stay silent rather than alarm */ }
    }
  };

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

  const activeColFilters = [filterTicket, filterAL, filterPax, filterPNR].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* Says what landed on the clipboard, not just that something did — a
          click near a cell edge could otherwise copy the neighbour without
          anyone noticing. */}
      {copied && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2
                        bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg
                        text-[11px] font-mono max-w-md">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">Copied <span className="font-bold">{copied}</span></span>
        </div>
      )}
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

          {/* Vendor filter — multi-select, so several portals can be compared
              against IATA in one view. */}
          <div className="relative" ref={srcRef}>
            <button
              type="button"
              onClick={() => setShowSources(v => !v)}
              title="Filter by one or more vendors"
              className={`pl-7 pr-6 py-1.5 rounded text-[10px] font-bold uppercase border transition-colors flex items-center ${
                sourceSel.length > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" />
              {sourceSel.length === 0 ? 'All Vendors'
                : sourceSel.length === 1 ? sourceSel[0]
                : `${sourceSel.length} Vendors`}
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" />
            </button>

            {showSources && (
              <div className="absolute z-30 mt-1 left-0 w-56 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg py-1">
                <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {sourceSel.length || 'all'} selected
                  </span>
                  {sourceSel.length > 0 && (
                    <button
                      onClick={() => setSourceSel([])}
                      className="text-[9px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {sources.map(s => {
                  const on = sourceSel.includes(s);
                  return (
                    <label
                      key={s}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleSource(s)}
                        className="w-3 h-3 accent-blue-600"
                      />
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${getSourceColor(s)}`}>
                        {s}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Date range — a month quick-pick for the common case, explicit
              from/to for anything else. Both drive the same two values. */}
          <div className="flex items-center gap-1">
            <div className="relative">
              <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
              <select
                value={monthSel}
                onChange={e => pickMonth(e.target.value)}
                title="Jump to a whole month"
                className={`pl-7 pr-2 py-1.5 rounded text-[10px] font-bold uppercase border focus:outline-none transition-colors ${
                  monthSel ? 'bg-blue-50 text-blue-700 border-blue-200'
                           : 'bg-white text-slate-500 border-slate-200'
                }`}
              >
                <option value="">Month</option>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>

            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={e => setDateFrom(e.target.value)}
              title="From date"
              className={`px-1.5 py-1.5 rounded text-[10px] font-mono border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                dateFrom ? 'bg-blue-50 text-blue-700 border-blue-200'
                         : 'bg-white text-slate-500 border-slate-200'
              }`}
            />
            <span className="text-[9px] font-bold uppercase text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={e => setDateTo(e.target.value)}
              title="To date"
              className={`px-1.5 py-1.5 rounded text-[10px] font-mono border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                dateTo ? 'bg-blue-50 text-blue-700 border-blue-200'
                       : 'bg-white text-slate-500 border-slate-200'
              }`}
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                title="Clear the date range"
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3 h-3" />
              </button>
            )}
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

          {/* Domestic / International — read off the itinerary, so a ticket
              with no route belongs to neither and drops out of both. */}
          <select
            value={travelFilter}
            onChange={e => setTravelFilter(e.target.value as 'ALL' | TravelScope)}
            title="Domestic = every airport on the route is in Saudi Arabia"
            className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase border focus:outline-none transition-colors ${
              travelFilter === 'DOMESTIC' ? 'bg-teal-50 text-teal-700 border-teal-200'
              : travelFilter === 'INTERNATIONAL' ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            <option value="ALL">All Travel</option>
            <option value="DOMESTIC">Domestic</option>
            <option value="INTERNATIONAL">International</option>
          </select>

          {/* Cabin. "Not recorded" is a choice of its own, because finding the
              tickets nobody wrote a cabin for is the way that gap gets closed. */}
          <select
            value={cabinFilter}
            onChange={e => setCabinFilter(e.target.value)}
            title="Cabin the ticket was sold in"
            className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase border focus:outline-none transition-colors ${
              cabinFilter === 'ALL' ? 'bg-white text-slate-500 border-slate-200'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}
          >
            <option value="ALL">All Cabins</option>
            <option value="FIRST">First</option>
            <option value="BUSINESS">Business</option>
            <option value="PREMIUM_ECONOMY">Premium Economy</option>
            <option value="ECONOMY">Economy</option>
            <option value="NONE">Not recorded</option>
          </select>

          {/* Office, from the req number's prefix. */}
          <select
            value={officeFilter}
            onChange={e => setOfficeFilter(e.target.value)}
            title="Office that raised the request, read from the req number"
            className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase border focus:outline-none transition-colors ${
              officeFilter === 'ALL' ? 'bg-white text-slate-500 border-slate-200'
                                     : 'bg-violet-50 text-violet-700 border-violet-200'
            }`}
          >
            <option value="ALL">All Offices</option>
            <option value="DUBAI">Dubai</option>
            <option value="SAUDI">Saudi</option>
            <option value="EGYPT">Egypt</option>
            <option value="OTHER">Other / not an office</option>
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
          {onBulkUpdateClosed && filtered.length > 0 && (searchTerm || closedFilter !== 'ALL' || travelFilter !== 'ALL' || filterTicket || filterAL || filterPax || filterPNR || sourceSel.length > 0 || dateFrom || dateTo) && (
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

          {/* Everything still open, regardless of the current filter. Hidden
              when nothing is outstanding, so it never offers an empty file. */}
          {notClosedCount > 0 && (
            <button
              onClick={exportNotClosed}
              title="Export every ticket that is still Not Closed, ignoring the filters above"
              className="px-2 py-1.5 bg-orange-600 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-orange-700 flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              Not Closed ({notClosedCount})
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
          {/* Ordered to match the table's own columns — A/L then Ticket No —
              so the eye moves the same way in the filter bar as in the rows. */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-blue-400 font-mono uppercase">A/L</span>
            <input
              type="text" placeholder="e.g. 065"
              value={filterAL} onChange={e => setFilterAL(e.target.value)}
              className="w-20 px-1.5 py-1 text-[10px] font-mono border border-blue-200 rounded focus:outline-none focus:ring-1 ring-blue-400 bg-white"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-blue-400 font-mono uppercase">Ticket No</span>
            <input
              type="text" placeholder="2540225922"
              title="Full or partial ticket number. The 13-digit form works too — the airline code is ignored."
              value={filterTicket} onChange={e => setFilterTicket(e.target.value)}
              className="w-32 px-1.5 py-1 text-[10px] font-mono border border-blue-200 rounded focus:outline-none focus:ring-1 ring-blue-400 bg-white"
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
              onClick={() => { setFilterTicket(''); setFilterAL(''); setFilterPax(''); setFilterPNR(''); }}
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
        {hasSAR && <CopyableAmount label="Net SAR" value={sarTotal} fmt={fmt} />}
        {hasSAR && hasAED && <span className="text-slate-300">·</span>}
        {hasAED && <CopyableAmount label="Net AED" value={aedTotal} fmt={fmt} />}
        <span className="text-slate-300">|</span>
        <span className="text-red-500">{filtered.filter(t => !t.reqNum).length} missing req</span>
        <span className="text-slate-300">|</span>
        {/* Top-ups are excluded from both: a balance payment is not a ticket
            that can be reconciled and closed, and counting it as outstanding
            overstated the work left. This is the same rule the Not Closed
            export uses, so the badge and the file agree. */}
        <span className="text-emerald-600">{filtered.filter(t => t.closed && t.status !== 'FUND').length} closed</span>
        <span className="text-orange-600">· {filtered.filter(t => !t.closed && t.status !== 'FUND').length} not closed</span>
        {/* Nothing on screen would otherwise suggest a cell is clickable. */}
        <span className="text-slate-300">|</span>
        <span className="text-slate-400">
          click a cell to copy it{canEdit && ' · the editable ones open for editing'}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 mx-4 my-4 bg-white border border-slate-200 rounded-lg overflow-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
              {/* Sortable headers cycle ascending -> descending -> unsorted. */}
              {([
                ['Serial',     'serial'],
                ['A/L',        'airlineCode'],
                ['Ticket No.', 'ticketNo'],
                ['Source',     'source'],
                ['Status',     'status'],
                ['Date',       'date'],
                ['Route',      'route'],
                ['Travel',     'travel'],
                ['Cabin',      'cabin'],
                ['Fare',       'totalDoc'],
                ['Commission', 'commission'],
                ['Balance Payable', 'amount'],
                ['Curr',       'currency'],
                ['PNR',        'pnr'],
                ['Passenger',  'passengerName'],
                ['Req Num',    'reqNum'],
                // Recon is derived entirely from Req Num — a row is MATCHED
                // exactly when it has one — so sorting it would just be the
                // Req Num sort with less information in it.
                ['Recon',      null],
                ['Closed',     'closed'],
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
          {/* Click any cell you cannot edit to copy what it says.
              Delegated to the tbody rather than attached per cell, so it
              covers every column — including ones added later — without
              eighteen near-identical handlers. */}
          <tbody className="text-xs font-mono" onClick={handleCellClick}>
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
                      ? <span
                          title={airlineName(ticket.airlineCode) || `Airline code ${ticket.airlineCode}`}
                          className="font-mono font-black text-[11px] text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded"
                        >{ticket.airlineCode}</span>
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
                  <td className="px-3 py-2">
                    <TravelBadge route={ticket.route} />
                  </td>
                  <td className="px-3 py-2">
                    <CabinBadge cabin={ticket.cabinClass} raw={ticket.cabinRaw} />
                  </td>
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
                        data-editable
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
                        data-editable
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
                        data-editable
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
                        data-editable
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
                    {onUpdateClosed ? (
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
