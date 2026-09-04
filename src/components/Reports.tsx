import React, { useMemo, useState } from 'react';
import { Ticket, VendorBalance, BalanceTopUp } from '../types';
import { useReports } from '../hooks/useReports';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';
import { Download, FileText, TrendingDown, Wallet, Database, BarChart3, Calendar, X } from 'lucide-react';
import { airlineName } from '../core/config/airlines';
import { computeAnalytics, SAR_TO_AED_RATE, type ShareRow } from '../core/helpers/analytics';
import {
  PERIOD_PRESETS, endOfMonth, inPeriod, monthLabel, monthsIn, periodLabel, selectedMonth,
} from '../core/helpers/period';
import { Donut, TrendBars, paletteAt } from './Charts';
import { CABIN_LABEL, type Cabin } from '../core/helpers/cabinClass';
import * as XLSX from 'xlsx';

interface ReportsProps {
  tickets: Ticket[];
  vendorBalances: VendorBalance[];
  topUps: BalanceTopUp[];
}

type ReportTab = 'summary' | 'analytics' | 'overdraft' | 'vendor_detail' | 'missing_req' | 'ledger';

/** How many leading rows the donuts colour individually. The same number is
 *  handed to the table below so the two agree on where the tail begins. */
const DONUT_MAX = 8;

/** A titled card with an optional control in its header — the frame every
 *  chart on the analytics tab sits in. */
const ChartCard: React.FC<{
  title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode;
}> = ({ title, subtitle, right, children }) => (
  <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase text-slate-500">{title}</div>
        {subtitle && <div className="text-[9px] text-slate-400 mt-0.5">{subtitle}</div>}
      </div>
      {right}
    </div>
    <div className="p-4 overflow-x-auto">{children}</div>
  </div>
);

/**
 * One currency's net, with the money in and the money out behind it.
 *
 * A net can be negative without anything being wrong: an airline that sells
 * almost entirely in one currency can still take credits in the other — a
 * refund of a ticket issued in an earlier period, or a credit memo — so the
 * minus is the truth rather than a fault. One ACM of -30,699 is most of
 * British Airways' AED credits on its own. The figures underneath say so,
 * instead of leaving a bare minus sign to be read as a bug.
 *
 * "Credited" rather than "refunded" because this bucket is everything that
 * came back — refunds, credit memos, and credit notes booked as sales — and
 * calling all of it refunds would send someone hunting for refunds that do not
 * exist.
 */
const NetCell: React.FC<{
  net: number; issued: number; refunded: number; fmt: (n: number) => string;
}> = ({ net, issued, refunded, fmt }) => {
  if (net === 0 && issued === 0 && refunded === 0) {
    return <td className="px-3 py-2 text-right"><span className="text-slate-300 text-[11px]">—</span></td>;
  }
  return (
    <td className="px-3 py-2 text-right">
      <div className={`font-mono text-[11px] ${net < 0 ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
        {fmt(net)}
      </div>
      {refunded < 0 && (
        <div className="text-[9px] text-slate-400 leading-tight font-mono">
          {fmt(issued)} − {fmt(Math.abs(refunded))} credited
        </div>
      )}
    </td>
  );
};

/**
 * The cabin split for one airline or route.
 *
 * Compact on purpose — three or four numbers in a table column, not a chart —
 * and it names what is NOT known rather than leaving it out. A cabin is
 * recorded for roughly a quarter of the ledger, so "2 business" could mean two
 * business seats sold or two that anyone wrote down, and only saying so
 * distinguishes them.
 */
const CABIN_SHORT: [keyof ShareRow['cabins'], string, string][] = [
  ['FIRST',           'F',  'text-purple-600'],
  ['BUSINESS',        'J',  'text-blue-600'],
  ['PREMIUM_ECONOMY', 'W',  'text-teal-600'],
  ['ECONOMY',         'Y',  'text-slate-500'],
];

const CabinCell: React.FC<{ cabins: ShareRow['cabins'] }> = ({ cabins }) => {
  const shown = CABIN_SHORT.filter(([k]) => cabins[k] > 0);
  if (!shown.length) {
    return (
      <td className="px-3 py-2 text-right">
        <span className="text-slate-300 text-[11px]"
              title={`${cabins.unknown} ticket(s), no cabin recorded`}>—</span>
      </td>
    );
  }
  return (
    <td className="px-3 py-2 text-right whitespace-nowrap">
      <span className="font-mono text-[11px] space-x-1.5">
        {shown.map(([k, letter, tone]) => (
          <span key={k} className={tone} title={CABIN_LABEL[k as Exclude<Cabin, ''>]}>
            {cabins[k]}{letter}
          </span>
        ))}
      </span>
      {cabins.unknown > 0 && (
        <div className="text-[9px] text-slate-400 leading-tight font-mono"
             title="Tickets with no cabin recorded">
          {cabins.unknown} not recorded
        </div>
      )}
    </td>
  );
};

/**
 * A ranked share table — who accounts for how much of the business.
 *
 * SAR and AED are separate columns rather than one total. Twenty-eight
 * airlines here sell in both, and adding the two produces a figure that reads
 * like money and is not. A currency with nothing in it shows a dash rather
 * than 0.00, so a zero always means "nothing", never "not applicable".
 *
 * The bar is drawn relative to the top row, not to 100%, because the leader
 * holds about half and everything else would otherwise be an invisible sliver.
 *
 * The top rows take the same colours, in the same order, as the donut above
 * them, so a slice can be found in the table without reading every label. Rows
 * past the donut's cut-off go grey, matching its "Others" slice rather than
 * implying a colour that is not on the chart.
 */
const ShareTable: React.FC<{
  title: string; subtitle: string; keyHeader: string;
  rows: ShareRow[]; fmt: (n: number) => string;
  /** Optional second line under the key — the carrier's name beside its code.
   *  Returning '' leaves the code standing alone, which is what an airline
   *  outside the supplied list should do rather than showing a guess. */
  subLabel?: (key: string) => string;
  /** How many leading rows the donut gave a colour to. */
  colored?: number;
  /** Show the cabin split. Off for the cabin table itself, where it would
   *  simply repeat the row's own name back at it. */
  showCabins?: boolean;
  /** What "Share" ranks and sorts by. Default is ticket count, which is the
   *  only honest basis for a ranking that spans routes or cabins with no
   *  single currency of their own. 'sar' / 'aed' rank by that currency's
   *  issued volume instead — money, not how many tickets it took to earn it.
   *  'total' ranks by the combined AED-equivalent (SAR ÷ SAR_TO_AED_RATE +
   *  AED) — the one place this screen deliberately adds the two currencies
   *  together; see the note on SAR_TO_AED_RATE in analytics.ts. Whichever is
   *  picked, the table re-sorts itself to match, so row order always agrees
   *  with the percentage printed beside it. */
  shareBasis?: 'tickets' | 'sar' | 'aed' | 'total';
}> = ({ title, subtitle, keyHeader, rows, fmt, subLabel, colored = 0, showCabins = false, shareBasis = 'tickets' }) => {
  const basisValue = (r: ShareRow) =>
    shareBasis === 'sar' ? r.sarIssued
    : shareBasis === 'aed' ? r.aedIssued
    : shareBasis === 'total' ? r.totalAedEq
    : r.tickets;
  const basisPct = (r: ShareRow) =>
    shareBasis === 'sar' ? r.pctSar
    : shareBasis === 'aed' ? r.pctAed
    : shareBasis === 'total' ? r.pctTotal
    : r.pct;
  // Sorted here rather than trusting the incoming order: rows arrive sorted by
  // TICKET count from computeAnalytics, and ranking by volume instead without
  // re-sorting would print row 1 with a smaller % than row 3.
  const sorted = [...rows].sort((a, b) => basisValue(b) - basisValue(a));
  // Guarded like the original `rows[0]?.tickets || 1`: an empty ranking must
  // not crash trying to read a basis value off a row that isn't there.
  const top = (sorted.length ? basisValue(sorted[0]) : 0) || 1;
  const shown = sorted.slice(0, 25);
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div className="text-[10px] font-bold uppercase text-slate-500">{title}</div>
        <div className="text-[9px] text-slate-400 mt-0.5">{subtitle}</div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-slate-400 italic">Nothing to show yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">{keyHeader}</th>
              <th className="px-3 py-2 text-right">Tickets</th>
              <th className="px-3 py-2 text-right" title="Refunds, and memos or EMDs — money that moved without a ticket being sold. Their amounts are already in the totals.">
                Other docs
              </th>
              <th className="px-3 py-2 text-right"
                  title={shareBasis === 'tickets' ? 'Share of tickets issued'
                       : shareBasis === 'total' ? `Share of combined AED-equivalent volume issued (SAR ÷ ${SAR_TO_AED_RATE} + AED)`
                       : `Share of ${shareBasis.toUpperCase()} volume issued`}>
                Share {shareBasis === 'total' ? '(Total AED)' : shareBasis !== 'tickets' && `(${shareBasis.toUpperCase()})`}
              </th>
              {showCabins && (
                <th className="px-3 py-2 text-right" title="Tickets by cabin. A dash means no cabin was recorded for any of them.">
                  Cabin
                </th>
              )}
              <th className="px-3 py-2 text-right">Net SAR</th>
              <th className="px-3 py-2 text-right">Net AED</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.key} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-sm shrink-0"
                          style={{ background: i < colored ? paletteAt(i) : '#cbd5e1' }} />
                    <div>
                      <div className="font-mono text-[11px] font-bold text-slate-700">{r.key}</div>
                      {subLabel?.(r.key) && (
                        <div className="text-[9px] text-slate-400 leading-tight">{subLabel(r.key)}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-600">{r.tickets}</td>
                <td className="px-3 py-2 text-right font-mono text-[11px]">
                  {r.refunds + r.otherDocs === 0
                    ? <span className="text-slate-300">—</span>
                    : (
                      <span className="text-slate-500"
                            title={`${r.refunds} refund(s), ${r.otherDocs} memo/EMD`}>
                        {r.refunds + r.otherDocs}
                      </span>
                    )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-1.5 rounded-full"
                           style={{ width: `${Math.max(2, (basisValue(r) / top) * 100)}%`,
                                    background: i < colored ? paletteAt(i) : '#94a3b8' }} />
                    </div>
                    <span className="font-mono text-[11px] font-bold text-slate-700 w-11 text-right">
                      {basisPct(r).toFixed(1)}%
                    </span>
                  </div>
                </td>
                {showCabins && <CabinCell cabins={r.cabins} />}
                <NetCell net={r.sar} issued={r.sarIssued} refunded={r.sarRefunded} fmt={fmt} />
                <NetCell net={r.aed} issued={r.aedIssued} refunded={r.aedRefunded} fmt={fmt} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > shown.length && (
        <div className="px-4 py-2 text-[9px] text-slate-400 border-t border-slate-100">
          showing the top {shown.length} of {rows.length}
        </div>
      )}
    </div>
  );
};

/**
 * The period control for the analytics screen.
 *
 * Three ways in, all driving the same two dates: a preset for the answer you
 * usually want, a month picker listing only months the data actually has, and
 * from/to for anything else. Whatever is active is highlighted, so the numbers
 * below can never be read as "all time" when they are not.
 */
const PeriodBar: React.FC<{
  from: string; to: string; months: string[];
  onChange: (from: string, to: string) => void;
  cabin: string;
  onCabin: (c: string) => void;
}> = ({ from, to, months, onChange, cabin, onCabin }) => {
  const monthSel = selectedMonth(from, to);
  const activePreset = PERIOD_PRESETS.find(p => {
    const r = p.range();
    return r.from === from && r.to === to;
  })?.key ?? (from || to ? 'custom' : 'all');

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Period</span>

      <div className="flex flex-wrap gap-1">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => { const r = p.range(); onChange(r.from, r.to); }}
            className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors ${
              activePreset === p.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-slate-200" />

      <div className="relative">
        <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
        <select
          value={monthSel}
          onChange={e => {
            const m = e.target.value;
            if (!m) onChange('', ''); else onChange(`${m}-01`, endOfMonth(m));
          }}
          title="Jump to a whole month"
          className={`pl-7 pr-2 py-1 rounded text-[10px] font-bold uppercase border focus:outline-none ${
            monthSel ? 'bg-blue-50 text-blue-700 border-blue-200'
                     : 'bg-white text-slate-500 border-slate-200'
          }`}
        >
          <option value="">Month</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <input
        type="date" value={from} max={to || undefined} title="From date"
        onChange={e => onChange(e.target.value, to)}
        className={`px-1.5 py-1 rounded text-[10px] font-mono border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
          from ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'
        }`}
      />
      <span className="text-[9px] font-bold uppercase text-slate-400">to</span>
      <input
        type="date" value={to} min={from || undefined} title="To date"
        onChange={e => onChange(from, e.target.value)}
        className={`px-1.5 py-1 rounded text-[10px] font-mono border focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
          to ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'
        }`}
      />
      {(from || to) && (
        <button onClick={() => onChange('', '')} title="Clear the period"
                className="p-1 text-slate-400 hover:text-slate-700">
          <X className="w-3 h-3" />
        </button>
      )}

      <div className="h-4 w-px bg-slate-200" />

      {/* Narrows every figure on the tab, not just the cabin card — the point
          is to ask which airlines and routes a cabin was sold on. */}
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Cabin</span>
      <select
        value={cabin}
        onChange={e => onCabin(e.target.value)}
        title="Narrow everything on this tab to one cabin"
        className={`px-2 py-1 rounded text-[10px] font-bold uppercase border focus:outline-none transition-colors ${
          cabin === 'ALL' ? 'bg-white text-slate-500 border-slate-200'
                          : 'bg-blue-600 text-white border-blue-600'
        }`}
      >
        <option value="ALL">All cabins</option>
        <option value="FIRST">First</option>
        <option value="BUSINESS">Business</option>
        <option value="PREMIUM_ECONOMY">Premium Economy</option>
        <option value="ECONOMY">Economy</option>
        <option value="NONE">Not recorded</option>
      </select>
    </div>
  );
};

/** One headline figure. `tone` colours the number, never the whole card, so a
 *  screen of cards does not turn into a traffic light. */
const Kpi: React.FC<{
  label: string; value: string; sub?: string; tone?: 'blue' | 'green' | 'red' | 'slate';
}> = ({ label, value, sub, tone = 'slate' }) => {
  const color = {
    blue: 'text-blue-600', green: 'text-emerald-600',
    red: 'text-red-600', slate: 'text-slate-800',
  }[tone];
  const accent = {
    blue: 'bg-blue-500', green: 'bg-emerald-500',
    red: 'bg-red-500', slate: 'bg-slate-300',
  }[tone];
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex">
      <div className={`w-1 shrink-0 ${accent}`} />
      <div className="px-4 py-3 min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
        <div className={`font-mono font-bold text-lg leading-tight truncate ${color}`}>{value}</div>
        {sub && <div className="text-[9px] text-slate-400 leading-tight truncate">{sub}</div>}
      </div>
    </div>
  );
};

export const Reports: React.FC<ReportsProps> = ({ tickets, vendorBalances, topUps }) => {
  const [tab, setTab] = useState<ReportTab>('summary');
  const [selectedVendor, setSelectedVendor] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // The analytics period is its own filter, not the Transaction History one.
  // Sharing a single range across both tabs meant narrowing a vendor export
  // silently narrowed the share tables too.
  const [anFrom, setAnFrom] = useState('');
  const [anTo, setAnTo] = useState('');
  // Tickets or money, and which currency. SAR and AED are never plotted on one
  // axis — two currencies against a single scale draw a picture that reads like
  // money and is not.
  const [trendMetric, setTrendMetric] = useState<'tickets' | 'SAR' | 'AED'>('tickets');
  /**
   * Narrow every figure on the tab to one cabin.
   *
   * "Which airlines do I sell business on" is a different question from "which
   * airlines do I sell", and the period alone could not ask it. Refunds and
   * memos carry no cabin, so a cabin filter necessarily drops them — which is
   * right for "what did I sell in business" and is said on screen so a smaller
   * net is not read as money going missing.
   */
  const [cabinFilter, setCabinFilter] = useState<string>('ALL');
  /**
   * What the "Airline Share" donut and table rank by. Ticket count and money
   * tell different stories — an airline with a few long-haul fares can
   * out-earn one with many cheap domestic hops — and "share of the business"
   * means the money, not how many documents it took.
   *
   * Defaults to TOTAL: one combined AED-equivalent figure (SAR ÷
   * SAR_TO_AED_RATE + AED), the owner's own call for this one screen. Every
   * other figure in the app — the ticket table, vendor balances, exports —
   * still keeps SAR and AED strictly apart, as it always has; this toggle is
   * the one deliberate exception, and only here. SAR-only and AED-only stay
   * available for anyone who wants to drill into one currency specifically.
   */
  const [airlineShareCurrency, setAirlineShareCurrency] = useState<'TOTAL' | 'SAR' | 'AED'>('TOTAL');

  // Centralized stats — single source of truth, no duplicated calculations
  const { totalIssued, totalRefunds, netTotal, bySource, missingReq, duplicates } = useReports(tickets, vendorBalances, topUps);

  const analyticsMonths = useMemo(() => monthsIn(tickets.map(t => t.date)), [tickets]);


  /**
   * Tickets carrying no date at all.
   *
   * They cannot belong to any period, so every range silently excludes them
   * and the months never add up to the all-time total. That gap is invisible
   * unless it is said out loud, which is what this counts for.
   */
  const undated = useMemo(
    () => tickets.filter(t =>
      t.status !== 'FUND' && !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')).length,
    [tickets],
  );

  /** The same maths the whole-ledger figures use, over the chosen period. */
  const an = useMemo(
    () => computeAnalytics(tickets.filter(t =>
      inPeriod(t.date, anFrom, anTo)
      && (cabinFilter === 'ALL'
          || (cabinFilter === 'NONE' ? !t.cabinClass : t.cabinClass === cabinFilter)))),
    [tickets, anFrom, anTo, cabinFilter],
  );

  /**
   * How much of the period the cabin shares were measured over.
   *
   * The shares are of tickets that HAVE a cabin, so they answer "of what we
   * know, how much was business" — the useful question, and an honest one only
   * while the reader can see how much that is. Said on both the chart and the
   * table rather than once, because either can be read alone.
   */
  const cabinCoverage = useMemo(() => {
    const known = an.cabinKnown, total = an.cabinTotal;
    if (!total) return 'No tickets in this period';
    if (!known) return `No cabin recorded for any of the ${total.toLocaleString('en-US')} tickets`;
    return `Share of the ${known.toLocaleString('en-US')} tickets with a cabin recorded`
         + ` — ${((known / total) * 100).toFixed(0)}% of ${total.toLocaleString('en-US')} issued`;
  }, [an]);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** Total ISSUED volume in whichever basis the Airline Share donut is ranked
   *  by right now — the figure in the donut's centre, and the denominator
   *  every share on that ranking is measured against. */
  const airlineVolumeTotal = an.byAirline.reduce((s, r) => s + (
    airlineShareCurrency === 'SAR'   ? r.sarIssued
    : airlineShareCurrency === 'AED' ? r.aedIssued
    :                                  r.totalAedEq
  ), 0);

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      if (selectedVendor !== 'ALL' && t.source !== selectedVendor) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      return true;
    });
  }, [tickets, selectedVendor, dateFrom, dateTo]);

  const overdraftVendors = vendorBalances.filter(v => v.currentBalance < 0);
  const lowVendors = vendorBalances.filter(v => v.currentBalance >= 0 && v.initialBalance > 0 && (v.currentBalance / v.initialBalance) < 0.2);

  const sources = useMemo(() =>
    ['ALL', ...Array.from(new Set(tickets.map(t => t.source).filter(Boolean)))],
    [tickets]
  );

  /**
   * Excel rejects sheet names over 31 chars or containing : \ / ? * [ ], and
   * silently produces a corrupt file on a duplicate name. Vendor names are
   * free text, so every name is sanitised and de-duplicated before use.
   */
  const safeSheetName = (raw: string, used: Set<string>): string => {
    let name = (raw || 'UNKNOWN').replace(/[:\\/?*[\]]/g, '-').trim().slice(0, 31) || 'UNKNOWN';
    if (used.has(name.toLowerCase())) {
      const stem = name.slice(0, 27);
      let n = 2;
      while (used.has(`${stem}_${n}`.toLowerCase())) n++;
      name = `${stem}_${n}`;
    }
    used.add(name.toLowerCase());
    return name;
  };

  const backupRow = (t: Ticket) => ({
    'Serial':       t.serial ?? '',
    'A/L':          t.airlineCode || '',
    'Ticket No.':   t.ticketNo,
    'Source':       t.source || '',
    'Status':       t.status || '',
    'Type':         t.transactionType || t.status || '',
    'Date':         t.date || '',
    'Route':        t.route || '',
    'PNR':          t.pnr || '',
    'Passenger':    t.passengerName || '',
    'Fare':         t.totalDoc ?? 0,
    'Commission':   t.commission ?? 0,
    'Balance Payable': t.amount ?? 0,
    'Currency':     sourceToCurrency(t.source || ''),
    'Req Num':      t.reqNum || '',
    'Closed':       t.closed ? 'Closed' : 'Not Closed',
    // The reading and the text it came from, so a re-import can restore both
    // and a cabin name nobody has mapped is still carried through.
    'Cabin':        t.cabinClass ? CABIN_LABEL[t.cabinClass as Exclude<Cabin, ''>] ?? t.cabinClass : '',
    'Cabin Class':  t.cabinRaw || '',
    'Report Name':  t.reportName || '',
    'Import Time':  t.importTime || '',
  });

  /**
   * Full backup — every ticket of every vendor, one sheet per vendor, in a
   * single workbook. Deliberately ignores the screen's filters: a backup that
   * silently captured only what was on screen would be worse than none.
   * Vendor balances and top-ups are included too, since tickets alone cannot
   * rebuild a wallet.
   */
  const exportFullBackup = () => {
    const wb = XLSX.utils.book_new();
    const used = new Set<string>();
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

    const bySrc = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const k = t.source || 'UNKNOWN';
      if (!bySrc.has(k)) bySrc.set(k, []);
      bySrc.get(k)!.push(t);
    }
    const sources = [...bySrc.keys()].sort((a, b) => a.localeCompare(b));

    // Sheet 1 — index, so the file explains itself months from now.
    const index: (string | number)[][] = [
      ['FULL BACKUP — ALL TICKETS, ALL VENDORS'],
      ['Generated', stamp],
      ['Total tickets', tickets.length],
      ['Vendors', sources.length],
      [],
      ['Vendor', 'Tickets', 'Currency', 'Issued', 'Refunds', 'Net'],
    ];
    for (const s of sources) {
      const rows = bySrc.get(s)!;
      const live = rows.filter(t => (t.status || '').toUpperCase() !== 'FUND');
      index.push([
        s,
        rows.length,
        sourceToCurrency(s),
        Number(live.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0).toFixed(2)),
        Number(live.filter(t => t.amount < 0).reduce((a, t) => a + Math.abs(t.amount), 0).toFixed(2)),
        Number(live.reduce((a, t) => a + t.amount, 0).toFixed(2)),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(index), safeSheetName('INDEX', used));

    // One sheet per vendor.
    for (const s of sources) {
      const ws = XLSX.utils.json_to_sheet(bySrc.get(s)!.map(backupRow));
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s, used));
    }

    // Wallet state — a ticket list alone can't reconstruct the balances.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      vendorBalances.map(v => ({
        'Vendor': v.vendorName,
        'Opening Balance': v.initialBalance,
        'Current Balance': v.currentBalance,
        'Currency': sourceToCurrency(v.vendorName),
      }))
    ), safeSheetName('Vendor Balances', used));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      topUps.map(tu => ({
        'Vendor': tu.vendorName, 'Date': tu.date, 'Amount': tu.amount, 'Note': tu.note,
      }))
    ), safeSheetName('Top-ups', used));

    XLSX.writeFile(wb, `Backup_All_Tickets_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportSummary = () => {
    const rows = vendorBalances.map(v => {
      const vTopUps = topUps.filter(tu => tu.vendorId === v.id);
      const totalTopUp = vTopUps.reduce((s, tu) => s + tu.amount, 0);
      return {
        'Vendor': v.vendorName,
        'Initial Balance': v.initialBalance,
        'Top-ups': totalTopUp,
        'Remaining Balance': v.currentBalance,
        'Status': v.currentBalance < 0 ? 'OVERDRAFT' : (v.currentBalance / (v.initialBalance || 1)) < 0.2 ? 'LOW' : 'OK',
        'Currency': sourceToCurrency(v.vendorName),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendor Summary');
    XLSX.writeFile(wb, 'Vendor_Balances_Report.xlsx');
  };

  const exportMissingReq = () => {
    const data = missingReq.map(t => ({
      'Ticket No.': t.ticketNo,
      'Source': t.source || '',
      'Date': t.date,
      'Balance Payable': t.amount,
      'PNR': t.pnr || '',
      'Passenger': t.passengerName || '',
      'Req Num': '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Missing REQ');
    XLSX.writeFile(wb, 'Missing_REQ_Export.xlsx');
  };

  const exportVendorDetail = () => {
    const data = filteredTickets.map(t => ({
      'A/L':        t.airlineCode || '',
      'Ticket No.': t.ticketNo,
      'Source':     t.source,
      'Status': t.status || '',
      'Date': t.date,
      'Total Doc': t.totalDoc || '',
      'Commission': t.commission || '',
      'Balance Payable': t.amount,
      'Currency':   sourceToCurrency(t.source || ''),
      'PNR':        t.pnr || '',
      'Passenger': t.passengerName || '',
      'Req Num': t.reqNum || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    XLSX.writeFile(wb, `Transaction_History_${selectedVendor}.xlsx`);
  };

  const TABS: { key: ReportTab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary',        label: 'Vendor Summary',       icon: <Wallet className="w-3.5 h-3.5" /> },
    { key: 'analytics',      label: 'Analytics',            icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { key: 'overdraft',      label: 'Overdraft / Low',      icon: <TrendingDown className="w-3.5 h-3.5" /> },
    { key: 'ledger',         label: 'Wallet Ledger',        icon: <Wallet className="w-3.5 h-3.5" /> },
    { key: 'vendor_detail',  label: 'Transaction History',  icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'missing_req',    label: `Missing REQ (${missingReq.length})`, icon: <FileText className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-100">
      <div className="px-6 py-4 bg-white border-b border-slate-200 shrink-0 flex items-center justify-between gap-4">
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Reports &amp; Exports</h2>
        <button
          onClick={exportFullBackup}
          title="Download every ticket of every vendor — one sheet per vendor, plus balances and top-ups"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 shadow-sm"
        >
          <Database className="w-3 h-3" />
          <span>Backup All Tickets ({tickets.length})</span>
        </button>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-4 shrink-0">
        <div className="flex space-x-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center space-x-1.5 px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-400 hover:text-slate-700'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">

        {/* ── ANALYTICS TAB ── */}
        {tab === 'analytics' && (
          <div className="space-y-4">
            <PeriodBar
              from={anFrom} to={anTo} months={analyticsMonths}
              onChange={(f, t) => { setAnFrom(f); setAnTo(t); }}
              cabin={cabinFilter} onCabin={setCabinFilter}
            />

            {/* A cabin filter necessarily excludes refunds and memos, which
                carry no cabin. Said out loud so a smaller net is read as a
                narrower question rather than as money having gone missing. */}
            {cabinFilter !== 'ALL' && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-blue-500 text-[11px] leading-none mt-0.5">▸</span>
                <p className="text-[10px] text-blue-800 leading-relaxed">
                  Showing <span className="font-bold">
                    {cabinFilter === 'NONE' ? 'tickets with no cabin recorded'
                      : `${CABIN_LABEL[cabinFilter as Exclude<Cabin, ''>]} only`}
                  </span>. Refunds and memos carry no cabin, so they are not in these figures.
                </p>
              </div>
            )}

            {/* Only while a period is active: under "All time" these rows ARE
                counted, so the warning would be false. */}
            {undated > 0 && (anFrom || anTo) && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <span className="text-amber-500 text-[11px] leading-none mt-0.5">▲</span>
                <p className="text-[10px] text-amber-800 leading-relaxed">
                  <span className="font-bold">{undated.toLocaleString('en-US')} tickets carry no date</span>
                  {' '}and cannot fall inside any period, so they are missing from the figures above.
                  They are counted under <span className="font-bold">All time</span>.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Tickets issued" tone="blue"
                   value={an.issuedCount.toLocaleString('en-US')}
                   sub={periodLabel(anFrom, anTo)} />
              <Kpi label="Refunds" tone="red"
                   value={an.refundCount.toLocaleString('en-US')}
                   sub={an.otherDocCount
                     ? `+ ${an.otherDocCount} memo/EMD, all in the totals`
                     : (an.issuedCount ? `${((an.refundCount / an.issuedCount) * 100).toFixed(1)}% of issues` : '—')} />
              <Kpi label="Net SAR" tone={an.totals.sar < 0 ? 'red' : 'green'}
                   value={fmt(an.totals.sar)}
                   sub={an.totals.sarRefunded < 0
                     ? `${fmt(an.totals.sarIssued)} − ${fmt(Math.abs(an.totals.sarRefunded))} credited`
                     : undefined} />
              <Kpi label="Net AED" tone={an.totals.aed < 0 ? 'red' : 'green'}
                   value={fmt(an.totals.aed)}
                   sub={an.totals.aedRefunded < 0
                     ? `${fmt(an.totals.aedIssued)} − ${fmt(Math.abs(an.totals.aedRefunded))} credited`
                     : undefined} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Airline Share"
                subtitle={
                  airlineShareCurrency === 'TOTAL'
                    ? `Combined AED-equivalent volume issued — SAR ÷ ${SAR_TO_AED_RATE} + AED — money, not ticket count`
                    : `Share of ${airlineShareCurrency} volume issued — money, not ticket count; the long tail folded into one slice`
                }
                right={
                  <div className="flex gap-1">
                    {(['TOTAL', 'SAR', 'AED'] as const).map(c => (
                      <button
                        key={c}
                        onClick={() => setAirlineShareCurrency(c)}
                        title={c === 'TOTAL' ? `SAR ÷ ${SAR_TO_AED_RATE} + AED, combined into one AED figure` : undefined}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                          airlineShareCurrency === c
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {c === 'TOTAL' ? 'Total (AED)' : c}
                      </button>
                    ))}
                  </div>
                }
              >
                {/* Ranked by ISSUED VOLUME, not by how many tickets it took to
                    earn it — an airline with a handful of long-haul fares can
                    out-earn one with many cheap hops. Zero-volume airlines in
                    the selected basis drop out on their own: the Donut only
                    plots slices with a positive value.

                    TOTAL is the one place on this screen SAR and AED are
                    combined — an owner decision for this single figure, not a
                    reversal of the rule everywhere else. See SAR_TO_AED_RATE
                    in analytics.ts. */}
                <Donut
                  slices={an.byAirline.map(r => ({
                    key: r.key,
                    label: airlineName(r.key) ? `${r.key} · ${airlineName(r.key)}` : r.key,
                    value: airlineShareCurrency === 'SAR' ? r.sarIssued
                         : airlineShareCurrency === 'AED' ? r.aedIssued
                         :                                   r.totalAedEq,
                  }))}
                  max={DONUT_MAX}
                  centerLabel={airlineShareCurrency === 'TOTAL' ? 'AED total' : `${airlineShareCurrency} issued`}
                  centerValue={fmt(airlineVolumeTotal)}
                />
              </ChartCard>

              <ChartCard title="Route Share"
                         subtitle="Tickets issued, by journey — tickets with no route are not counted">
                <Donut
                  slices={an.byRoute.map(r => ({ key: r.key, label: r.key, value: r.tickets }))}
                  max={DONUT_MAX}
                  centerLabel="On routes"
                />
              </ChartCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Cabin" subtitle={cabinCoverage}>
                {an.cabinKnown === 0 ? (
                  <p className="px-4 py-8 text-xs text-slate-400 italic text-center">
                    No ticket in this period has a cabin recorded.
                  </p>
                ) : (
                  <Donut
                    slices={an.byCabin.map(r => ({ key: r.key, label: r.key, value: r.tickets }))}
                    max={4}
                    centerLabel="With a cabin"
                  />
                )}
              </ChartCard>

              <ShareTable
                title="By Cabin"
                subtitle={cabinCoverage}
                keyHeader="Cabin"
                rows={an.byCabin}
                fmt={fmt}
                colored={4}
              />
            </div>

            <ChartCard
              title="Activity by month"
              subtitle={
                trendMetric === 'tickets'
                  ? 'Blue is tickets issued, orange the refunds stacked on top'
                  : `Net ${trendMetric} per month — a month whose refunds outweigh its sales shows in red`
              }
              right={
                <div className="flex gap-1">
                  {(['tickets', 'SAR', 'AED'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setTrendMetric(m)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                        trendMetric === m
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              }
            >
              <TrendBars
                money={trendMetric !== 'tickets'}
                secondaryLabel="refunds"
                bars={an.months.map(p => ({
                  label: monthLabel(p.month),
                  value: trendMetric === 'tickets' ? p.tickets
                       : trendMetric === 'SAR'     ? p.sar
                       :                             p.aed,
                  secondary: trendMetric === 'tickets' ? p.refunds : undefined,
                }))}
              />
            </ChartCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <ShareTable
                title="By Airline"
                subtitle={
                  airlineShareCurrency === 'TOTAL'
                    ? `Ranked by combined AED-equivalent volume (SAR ÷ ${SAR_TO_AED_RATE} + AED) — what each airline earned, and in which cabin`
                    : `Ranked by ${airlineShareCurrency} volume issued — what each airline earned, and in which cabin`
                }
                keyHeader="A/L"
                rows={an.byAirline}
                fmt={fmt}
                subLabel={airlineName}
                colored={DONUT_MAX}
                showCabins
                shareBasis={
                  airlineShareCurrency === 'SAR' ? 'sar'
                  : airlineShareCurrency === 'AED' ? 'aed'
                  : 'total'
                }
              />
              <ShareTable
                title="Most Issued Routes"
                subtitle="Journeys ranked by how many tickets were issued on them"
                keyHeader="Route"
                rows={an.byRoute}
                fmt={fmt}
                colored={DONUT_MAX}
              />
            </div>
          </div>
        )}

        {/* ── VENDOR SUMMARY TAB ── */}
        {tab === 'summary' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100 bg-slate-50">
              <span className="text-[10px] font-bold uppercase text-slate-500">All Vendor Balances</span>
              <button onClick={exportSummary} className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase hover:bg-blue-700">
                <Download className="w-3 h-3" />
                <span>Export</span>
              </button>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2 text-right">Initial</th>
                  <th className="px-4 py-2 text-right">Top-ups</th>
                  <th className="px-4 py-2 text-right">Issued</th>
                  <th className="px-4 py-2 text-right">Refunds</th>
                  <th className="px-4 py-2 text-right">Remaining</th>
                  <th className="px-4 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="text-xs font-mono divide-y divide-slate-50">
                {vendorBalances.map(v => {
                  const vTickets = tickets.filter(t => t.source.toLowerCase().includes(v.vendorName.toLowerCase()));
                  const vTopUps = topUps.filter(tu => tu.vendorId === v.id);
                  const totalTopUp = vTopUps.reduce((s, tu) => s + tu.amount, 0);
                  const issued = vTickets.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
                  const refunds = vTickets.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
                  const rem = v.currentBalance;
                  const isNeg = rem < 0;
                  const isLow = !isNeg && v.initialBalance > 0 && (rem / v.initialBalance) < 0.2;
                  return (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-sans font-bold text-slate-700 text-[11px] uppercase">{v.vendorName}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{fmt(v.initialBalance)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{totalTopUp > 0 ? `+${fmt(totalTopUp)}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{fmt(issued)}</td>
                      <td className="px-4 py-2.5 text-right text-red-500">{refunds > 0 ? fmt(refunds) : '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {isNeg ? '-' : ''}{sourceToCurrency(v.vendorName)} {fmt(Math.abs(rem))}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isNeg
                          ? <span className="bg-red-100 text-red-700 text-[9px] font-bold px-2 py-0.5 rounded">OVERDRAFT</span>
                          : isLow
                          ? <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded">LOW</span>
                          : <span className="bg-emerald-50 text-emerald-600 text-[9px] font-bold px-2 py-0.5 rounded">OK</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── OVERDRAFT TAB ── */}
        {tab === 'overdraft' && (
          <div className="space-y-4">
            {overdraftVendors.length > 0 && (
              <div className="bg-white border border-red-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-red-50 border-b border-red-100">
                  <span className="text-[10px] font-bold uppercase text-red-700">Overdraft Vendors ({overdraftVendors.length})</span>
                </div>
                {overdraftVendors.map(v => (
                  <div key={v.id} className="flex justify-between items-center px-4 py-3 border-b border-red-50">
                    <span className="font-bold text-sm uppercase text-slate-700">{v.vendorName}</span>
                    <span className="font-mono font-black text-red-600 text-lg">{sourceToCurrency(v.vendorName)} {fmt(Math.abs(v.currentBalance))} OVERDRAWN</span>
                  </div>
                ))}
              </div>
            )}
            {lowVendors.length > 0 && (
              <div className="bg-white border border-amber-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
                  <span className="text-[10px] font-bold uppercase text-amber-700">Low Balance (Below 20%) — {lowVendors.length} Vendors</span>
                </div>
                {lowVendors.map(v => {
                  const pct = (v.currentBalance / v.initialBalance) * 100;
                  return (
                    <div key={v.id} className="flex justify-between items-center px-4 py-3 border-b border-amber-50">
                      <span className="font-bold text-sm uppercase text-slate-700">{v.vendorName}</span>
                      <div className="flex items-center space-x-3">
                        <div className="w-24 bg-amber-100 rounded-full h-2">
                          <div className="bg-amber-400 h-2 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono font-bold text-amber-700 text-sm">{sourceToCurrency(v.vendorName)} {fmt(v.currentBalance)} ({pct.toFixed(0)}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {overdraftVendors.length === 0 && lowVendors.length === 0 && (
              <div className="bg-white border border-emerald-200 rounded-lg p-8 text-center shadow-sm">
                <p className="text-emerald-600 font-bold text-sm">✓ All vendor balances are healthy</p>
              </div>
            )}
          </div>
        )}

        {/* ── TRANSACTION HISTORY TAB ── */}
        {tab === 'vendor_detail' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex flex-wrap gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <select
                value={selectedVendor}
                onChange={e => setSelectedVendor(e.target.value)}
                className="bg-white border border-slate-200 text-xs font-bold uppercase px-3 py-1.5 rounded focus:outline-none"
              >
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="bg-white border border-slate-200 text-xs px-3 py-1.5 rounded focus:outline-none" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="bg-white border border-slate-200 text-xs px-3 py-1.5 rounded focus:outline-none" />
              <button onClick={exportVendorDetail}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase hover:bg-blue-700 ml-auto">
                <Download className="w-3 h-3" />
                <span>Export {filteredTickets.length} rows</span>
              </button>
            </div>
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-left min-w-[800px]">
                <thead className="sticky top-0 bg-slate-50 shadow-sm">
                  <tr className="border-b border-slate-200 text-[9px] uppercase tracking-wider text-slate-400">
                    {['Date', 'Ticket No.', 'Source', 'Status', 'PNR', 'Passenger', 'Net Amt', 'Req Num'].map(c => (
                      <th key={c} className="px-3 py-2">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-xs font-mono divide-y divide-slate-50">
                  {filteredTickets.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{t.date}</td>
                      <td className="px-3 py-2 font-bold">{t.ticketNo}</td>
                      <td className="px-3 py-2 text-slate-500">{t.source}</td>
                      <td className="px-3 py-2 text-slate-400 text-[9px]">{t.status || '—'}</td>
                      <td className="px-3 py-2">{t.pnr || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{t.passengerName || '—'}</td>
                      <td className={`px-3 py-2 font-bold ${t.amount < 0 ? 'text-red-600' : ''}`}>
                        {t.amount < 0 ? '-' : ''}{fmt(Math.abs(t.amount))}
                      </td>
                      <td className={`px-3 py-2 ${t.reqNum ? 'text-blue-600' : 'text-red-400 italic'}`}>
                        {t.reqNum || 'MISSING'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── MISSING REQ TAB ── */}
        {tab === 'missing_req' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100 bg-red-50">
              <span className="text-[10px] font-bold uppercase text-red-700">{missingReq.length} Tickets Missing Req Num</span>
              <button onClick={exportMissingReq}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-600 text-white rounded text-[10px] font-bold uppercase hover:bg-red-700">
                <Download className="w-3 h-3" />
                <span>Export & Fill In Excel</span>
              </button>
            </div>
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[10px] text-amber-700 font-mono">
              💡 Export → Fill in the "Req Num" column → Re-import via Import Data. The system will match by Ticket No. and update existing records.
            </div>
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-50 shadow-sm">
                  <tr className="border-b border-slate-200 text-[9px] uppercase tracking-wider text-slate-400">
                    {['Ticket No.', 'Source', 'Date', 'Amount', 'PNR', 'Passenger'].map(c => (
                      <th key={c} className="px-3 py-2">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-xs font-mono divide-y divide-slate-50">
                  {missingReq.map(t => (
                    <tr key={t.id} className="hover:bg-red-50/30">
                      <td className="px-3 py-2 font-bold text-slate-700">{t.ticketNo}</td>
                      <td className="px-3 py-2 text-slate-500">{t.source}</td>
                      <td className="px-3 py-2 text-slate-400">{t.date}</td>
                      <td className={`px-3 py-2 font-bold ${t.amount < 0 ? 'text-red-600' : ''}`}>
                        {fmt(Math.abs(t.amount))}
                      </td>
                      <td className="px-3 py-2">{t.pnr || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{t.passengerName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── WALLET LEDGER TAB ── */}
        {tab === 'ledger' && (
          <div className="space-y-4">
            {vendorBalances.map(v => {
              const vTopUps   = topUps.filter(tu => tu.vendorId === v.id);
              const vTickets  = tickets.filter(t =>
                (t.source || '').toLowerCase().includes(v.vendorName.toLowerCase()) ||
                v.vendorName.toLowerCase().includes((t.source || '').toLowerCase())
              );
              const totalTopUp  = vTopUps.reduce((s, tu) => s + tu.amount, 0);
              const totalIssued = vTickets.filter(t => (t.status||'').toUpperCase() === 'ISSUE' || t.amount > 0).reduce((s, t) => s + Math.abs(t.amount), 0);
              const totalRefund = vTickets.filter(t => (t.status||'').toUpperCase() === 'REFUND' || t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
              const balance     = v.currentBalance;
              const isNeg       = balance < 0;

              // Build ledger entries
              const ledgerEntries = [
                { date: '-', type: 'OPENING', desc: 'Opening Balance', debit: 0, credit: v.initialBalance, running: v.initialBalance },
                ...vTopUps.map(tu => ({ date: tu.date, type: 'FUND', desc: tu.note, debit: 0, credit: tu.amount, running: 0 })),
                ...vTickets.map(t => ({
                  date: t.date, type: t.status || 'ISSUE',
                  desc: `${t.ticketNo} — ${t.passengerName || t.pnr || ''}`,
                  debit: t.amount > 0 ? t.amount : 0,
                  credit: t.amount < 0 ? Math.abs(t.amount) : 0,
                  running: 0,
                })),
              ].sort((a, b) => a.date.localeCompare(b.date));

              // Calculate running balance
              let running = 0;
              ledgerEntries.forEach(e => {
                running += e.credit - e.debit;
                e.running = running;
              });

              return (
                <div key={v.id} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                  <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <span className="font-bold text-sm uppercase text-slate-700">{v.vendorName}</span>
                    <span className={`font-mono font-black text-lg ${isNeg ? 'text-red-600' : 'text-emerald-700'}`}>
                      {isNeg ? '-' : ''}{sourceToCurrency(v.vendorName)} {fmt(Math.abs(balance))}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                        <tr>
                          {['Date','Type','Description','Debit','Credit','Balance'].map(c => (
                            <th key={c} className="px-3 py-2 text-[9px] font-bold uppercase text-slate-400">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {ledgerEntries.map((e, i) => (
                          <tr key={i} className={`hover:bg-slate-50 ${e.type === 'FUND' ? 'bg-emerald-50/40' : e.type === 'REFUND' ? 'bg-red-50/30' : ''}`}>
                            <td className="px-3 py-1.5 text-slate-400 text-[10px]">{e.date}</td>
                            <td className="px-3 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                e.type === 'FUND' ? 'bg-emerald-100 text-emerald-700' :
                                e.type === 'REFUND' ? 'bg-red-100 text-red-700' :
                                e.type === 'OPENING' ? 'bg-blue-100 text-blue-700' :
                                'bg-slate-100 text-slate-600'
                              }`}>{e.type}</span>
                            </td>
                            <td className="px-3 py-1.5 text-slate-600 max-w-[200px] truncate text-[10px]">{e.desc}</td>
                            <td className="px-3 py-1.5 text-red-600 text-right">{e.debit > 0 ? fmt(e.debit) : '—'}</td>
                            <td className="px-3 py-1.5 text-emerald-600 text-right">{e.credit > 0 ? fmt(e.credit) : '—'}</td>
                            <td className={`px-3 py-1.5 text-right font-bold ${e.running < 0 ? 'text-red-600' : 'text-slate-700'}`}>{fmt(e.running)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {vendorBalances.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center shadow-sm">
                <p className="text-slate-400 text-sm">No vendors configured yet.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
