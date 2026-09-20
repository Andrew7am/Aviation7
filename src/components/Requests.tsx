import React, { useMemo, useState } from 'react';
import { Ticket } from '../types';
import {
  Search, FolderOpen, AlertTriangle, CheckCircle2, Circle, Download, Building2,
} from 'lucide-react';
import { classifyOffice, OFFICE_LABEL, Office } from '../core/helpers/reqOffice';
import { RequestProfile } from './RequestProfile';

/**
 * The spreadsheet writer, fetched the first time something is exported.
 *
 * xlsx is a few hundred kilobytes and it is only ever reached by pressing a
 * button. Imported at the top of the file it rode into the first page load
 * of every session, including the ones where nobody exports anything.
 */
const xlsx = () => import('xlsx');


/**
 * Every request the agency has raised, as a list you can work down.
 *
 * The profile answers "what is in this request" once you already know which
 * one to ask about. This answers the question before it: which ones still
 * need something doing.
 *
 * So the order is the feature. Requests where SOME rows are closed and some
 * are not come first, because that state is invisible everywhere else — a
 * request with seventy-two closed rows and two open ones reads as finished
 * from every other screen in the app. Then the ones nothing has been closed
 * on, which are merely unstarted rather than half-forgotten. Finished
 * requests come last: they are the ones nobody needs.
 *
 * Sorting by "not closed first" alone would mix those two groups together and
 * bury the eight requests that actually hide something under the two hundred
 * that are simply new.
 */

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Money = Record<string, number>;
const show = (m: Money) => {
  const parts = Object.entries(m).filter(([, v]) => Math.abs(v) >= 0.005);
  return parts.length ? parts.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ') : '—';
};

/** The three states a request can be in, in the order they need attention. */
type State = 'PART' | 'OPEN' | 'DONE';
const RANK: Record<State, number> = { PART: 0, OPEN: 1, DONE: 2 };

const STATE_STYLE: Record<State, { chip: string; row: string; label: string }> = {
  PART: { chip: 'bg-amber-100 text-amber-800', row: 'bg-amber-50/40', label: 'PART CLOSED' },
  OPEN: { chip: 'bg-orange-100 text-orange-700', row: '', label: 'NOT CLOSED' },
  DONE: { chip: 'bg-emerald-100 text-emerald-700', row: '', label: 'CLOSED' },
};

interface Summary {
  reqNum: string;
  rows: number;
  closed: number;
  open: number;
  refunds: number;
  net: Money;
  openValue: Money;
  sources: string[];
  office: Office;
  state: State;
  lastDate: string;
}

interface Props {
  tickets: Ticket[];
  /** Close or reopen one row, when the viewer is allowed to. */
  onUpdateClosed?: (id: string, closed: boolean) => void;
}

/**
 * The office filter's choices.
 *
 * 'NONE' is not a tidy-up. Seventy-odd req numbers in this ledger are not
 * office codes at all - ADM, ACM, VOID, CANXX, CREDIT MEMO, a few people's
 * names - and they carry real money. Without a bucket of their own they
 * would be reachable from All and from nowhere else, which is how a row
 * stops being looked at.
 */
type OfficeSel = 'ALL' | Exclude<Office, ''> | 'NONE';

const OFFICE_TABS: [OfficeSel, string][] = [
  ['ALL', 'All offices'], ['DUBAI', 'Dubai'], ['SAUDI', 'Saudi'],
  ['EGYPT', 'Egypt'], ['NONE', 'No office'],
];

/**
 * The three filters, each answering its own question.
 *
 * The office comes off the req number's prefix, so it is already known for
 * every request and costs nothing to filter on - KSAML is Saudi, UAEVP is
 * Dubai, EGPML is Egypt. What it buys is the question the offices actually
 * ask: not "what is outstanding" but "what is outstanding on OUR files".
 *
 * Out here rather than inside the component because the counting rule below
 * is the part that can quietly go wrong, and a rule nobody can test is a
 * rule that only gets checked when somebody notices the number is odd.
 */
export type Facet = Pick<Summary, 'state' | 'office' | 'reqNum' | 'sources'>;

export const matchOffice = (r: Facet, sel: OfficeSel) =>
  sel === 'ALL' || (sel === 'NONE' ? !r.office : r.office === sel);

export const matchState = (r: Facet, sel: 'ALL' | State) => sel === 'ALL' || r.state === sel;

export const matchSearch = (r: Facet, q: string) => {
  const s = q.trim().toUpperCase();
  return !s || r.reqNum.toUpperCase().includes(s)
    || r.sources.some(x => (x || '').toUpperCase().includes(s));
};

export function selectRequests<T extends Facet>(
  list: T[], only: 'ALL' | State, office: OfficeSel, search: string,
): T[] {
  return list.filter(r => matchState(r, only) && matchOffice(r, office) && matchSearch(r, search));
}

/**
 * Each row of tabs counts what the OTHER filters have already left.
 *
 * A tab reading "Part closed 8" while the list below it shows two is worse
 * than no number at all: the eight is true of the whole ledger and false of
 * what is on screen, and the only way to tell which was meant is to click it
 * and look. So the state tabs count within the chosen office, and the office
 * tabs count within the chosen state.
 */
export function stateCounts(list: Facet[], office: OfficeSel, search: string) {
  const base = list.filter(r => matchOffice(r, office) && matchSearch(r, search));
  return {
    ALL: base.length,
    PART: base.filter(r => r.state === 'PART').length,
    OPEN: base.filter(r => r.state === 'OPEN').length,
    DONE: base.filter(r => r.state === 'DONE').length,
  } as Record<'ALL' | State, number>;
}

export function officeTabCounts(list: Facet[], only: 'ALL' | State, search: string) {
  const base = list.filter(r => matchState(r, only) && matchSearch(r, search));
  return {
    ALL: base.length,
    DUBAI: base.filter(r => r.office === 'DUBAI').length,
    SAUDI: base.filter(r => r.office === 'SAUDI').length,
    EGYPT: base.filter(r => r.office === 'EGYPT').length,
    NONE: base.filter(r => !r.office).length,
  } as Record<OfficeSel, number>;
}

export const Requests: React.FC<Props> = ({ tickets, onUpdateClosed }) => {
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState<'ALL' | State>('ALL');
  const [office, setOffice] = useState<OfficeSel>('ALL');
  const [openReq, setOpenReq] = useState<string | null>(null);

  const all = useMemo<Summary[]>(() => {
    const by = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const k = (t.reqNum || '').trim();
      if (!k || (t.status || '').toUpperCase() === 'FUND') continue;
      // Case is not identity: the ledger holds Ksaml1452 beside KSAML1452 and
      // they are one request. The first spelling seen is the one displayed.
      const key = k.toUpperCase();
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(t);
    }

    return [...by.entries()].map(([key, rows]) => {
      const closed = rows.filter(t => t.closed).length;
      const open = rows.length - closed;
      const net: Money = {}, openValue: Money = {};
      for (const t of rows) {
        const c = t.currency || 'SAR';
        net[c] = Math.round(((net[c] ?? 0) + (t.amount || 0)) * 100) / 100;
        if (!t.closed) openValue[c] = Math.round(((openValue[c] ?? 0) + (t.amount || 0)) * 100) / 100;
      }
      const state: State = closed > 0 && open > 0 ? 'PART' : open > 0 ? 'OPEN' : 'DONE';
      return {
        reqNum: (rows[0].reqNum || key).trim(),
        rows: rows.length, closed, open,
        refunds: rows.filter(t => (t.amount || 0) < 0).length,
        net, openValue,
        sources: [...new Set(rows.map(t => t.source).filter(Boolean))],
        office: classifyOffice(key),
        state,
        lastDate: rows.map(t => t.date || '').filter(Boolean).sort().pop() || '',
      };
    }).sort((a, b) =>
      RANK[a.state] - RANK[b.state]
      // Inside a group, the most outstanding rows first, then the most recent:
      // a request nobody has touched since March matters less than one from
      // last week with the same number of loose ends.
      || b.open - a.open
      || b.lastDate.localeCompare(a.lastDate)
      || a.reqNum.localeCompare(b.reqNum));
  }, [tickets]);

  const shown = useMemo(
    () => selectRequests(all, only, office, search),
    [all, search, only, office]);

  const counts = useMemo(() => stateCounts(all, office, search), [all, office, search]);
  const officeCounts = useMemo(() => officeTabCounts(all, only, search), [all, only, search]);

  /** Whether the ledger has unfiled requests at all, so the tab does not
   *  appear and vanish as the other filters move. */
  const hasUnfiled = useMemo(() => all.some(r => !r.office), [all]);

  /** The list as it stands, filter and order included — what is on screen is
   *  what lands in the file. */
  const exportList = async () => {
    const XLSX = await xlsx();
    const ws = XLSX.utils.json_to_sheet(shown.map(r => ({
      'Request': r.reqNum,
      'State': STATE_STYLE[r.state].label,
      'Office': r.office ? OFFICE_LABEL[r.office as Exclude<Office, ''>] : '',
      'Rows': r.rows,
      'Closed': r.closed,
      'Not closed': r.open,
      'Refunds': r.refunds,
      'Outstanding': show(r.openValue),
      'Net': show(r.net),
      'Suppliers': r.sources.join(', '),
      'Last activity': r.lastDate,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Requests');
    XLSX.writeFile(wb, 'Requests.xlsx');
  };

  const TABS: ['ALL' | State, string][] = [
    ['ALL', 'All'], ['PART', 'Part closed'], ['OPEN', 'Not closed'], ['DONE', 'Closed'],
  ];

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {openReq && (
        <RequestProfile reqNum={openReq} tickets={tickets} onUpdateClosed={onUpdateClosed}
          onClose={() => setOpenReq(null)} />
      )}

      <div className="p-4 space-y-3 shrink-0 bg-white border-b border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">
            Requests
          </h2>
          <button onClick={exportList}
            className="flex items-center gap-1.5 bg-purple-600 text-white text-[11px] font-bold
                       px-3 py-1.5 rounded hover:bg-purple-700">
            <Download className="w-3.5 h-3.5" /> Export list
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search a request or a supplier"
              className="bg-slate-50 border border-slate-200 rounded pl-8 pr-3 py-1.5 text-xs
                         w-64 focus:outline-none focus:ring-2 focus:ring-purple-500/20" />
          </div>
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setOnly(k)}
              className={`text-[10px] font-bold uppercase px-2.5 py-1.5 rounded transition
                ${only === k
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {label} <span className="opacity-60">{counts[k]}</span>
            </button>
          ))}
        </div>

        {/* The office, on its own line rather than in among the states: they
            are two different questions and reading them as one row invites
            clicking one thinking it does the other. */}
        <div className="flex flex-wrap items-center gap-2">
          <Building2 className="w-3.5 h-3.5 text-slate-300" />
          {OFFICE_TABS.filter(([k]) => k !== 'NONE' || hasUnfiled).map(([k, label]) => (
            <button key={k} onClick={() => setOffice(k)}
              title={k === 'NONE'
                ? 'Req numbers that are not an office code — ADM, VOID, credit memos, names'
                : undefined}
              className={`text-[10px] font-bold uppercase px-2.5 py-1.5 rounded border transition
                ${office === k
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              {label} <span className="opacity-60">{officeCounts[k]}</span>
            </button>
          ))}
        </div>

        {counts.PART > 0 && only !== 'PART' && (
          <button onClick={() => setOnly('PART')}
            className="w-full text-left bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5
                       flex items-start gap-2.5 hover:bg-amber-100 transition">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <span className="text-xs text-amber-900">
              <b>{counts.PART} request{counts.PART === 1 ? '' : 's'} part closed.</b>{' '}
              Some of their rows are finished and some are not — the one state no other
              screen shows. They are listed first. Click to see only those.
            </span>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {shown.length === 0 ? (
          <p className="text-xs text-slate-400 italic text-center py-10">
            No request matches
            {office !== 'ALL' && <> in {office === 'NONE' ? 'the unfiled group'
              : OFFICE_LABEL[office as Exclude<Office, ''>]}</>}.
          </p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[880px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[9px] uppercase
                                 tracking-wider text-slate-400">
                    <th className="px-3 py-2">Request</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Office</th>
                    <th className="px-3 py-2 text-right">Rows</th>
                    <th className="px-3 py-2 text-right">Not closed</th>
                    <th className="px-3 py-2 text-right">Outstanding</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2">Suppliers</th>
                    <th className="px-3 py-2">Last activity</th>
                  </tr>
                </thead>
                <tbody className="text-xs font-mono">
                  {shown.map(r => (
                    <tr key={r.reqNum}
                        onClick={() => setOpenReq(r.reqNum)}
                        className={`border-b border-slate-100 cursor-pointer hover:bg-purple-50
                                    ${STATE_STYLE[r.state].row}`}>
                      <td className="px-3 py-2 font-bold text-purple-700 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <FolderOpen className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          {r.reqNum}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold
                                          whitespace-nowrap ${STATE_STYLE[r.state].chip}`}>
                          {r.state === 'PART' && <AlertTriangle className="w-2.5 h-2.5 inline mr-1" />}
                          {r.state === 'DONE' && <CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />}
                          {r.state === 'OPEN' && <Circle className="w-2.5 h-2.5 inline mr-1" />}
                          {STATE_STYLE[r.state].label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-500 whitespace-nowrap">
                        {r.office ? (
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-slate-300" />
                            {OFFICE_LABEL[r.office as Exclude<Office, ''>]}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{r.rows}</td>
                      <td className={`px-3 py-2 text-right font-bold
                        ${r.open ? 'text-orange-600' : 'text-slate-300'}`}>
                        {r.open || '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-[10px] text-slate-600 whitespace-nowrap">
                        {r.open ? show(r.openValue) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-[10px] text-slate-700 whitespace-nowrap">
                        {show(r.net)}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-500 max-w-[180px] truncate">
                        {r.sources.join(', ')}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-400 whitespace-nowrap">
                        {r.lastDate || <span className="text-red-400">no date</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-2 bg-white border-t border-slate-200 shrink-0 text-[10px]
                      font-mono text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
        <span>
          {shown.length} of {all.length} requests
          {office !== 'ALL' && ` · ${office === 'NONE' ? 'no office'
            : OFFICE_LABEL[office as Exclude<Office, ''>]}`}
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-amber-700">{counts.PART} part closed</span>
        <span className="text-orange-600">· {counts.OPEN} not closed</span>
        <span className="text-emerald-600">· {counts.DONE} closed</span>
        <span className="text-slate-300 hidden sm:inline">|</span>
        <span className="text-slate-400 hidden sm:inline">click a row to open it</span>
      </div>
    </div>
  );
};

export default Requests;
