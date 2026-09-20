import React, { useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Ticket } from '../types';
import {
  X, AlertTriangle, CheckCircle2, Circle, TrendingDown, TrendingUp, Building2, Download,
} from 'lucide-react';
import { classifyOffice, OFFICE_LABEL, Office } from '../core/helpers/reqOffice';

/**
 * Everything booked under one request number, in one place.
 *
 * A request is the unit the agency actually works in — a client asks for a
 * trip, and it becomes tickets, changes and refunds spread across however many
 * suppliers had the stock. The ledger stores those as unrelated rows that
 * happen to share a string, so answering "is this request finished?" meant
 * filtering, scrolling, and trusting that nothing was missed.
 *
 * The question worth answering is the one nobody can answer by eye: a request
 * where SOME rows are closed and some are not. KSAML1452 has seventy-four
 * rows, seventy-two of them closed. The two that are not will never be spotted
 * in a list — and they are the whole reason this screen exists.
 *
 * Which is why the profile always loads the complete request, whatever screen
 * it was opened from. Reached from Not Closed it would otherwise show only the
 * open rows, and a view containing nothing but open rows cannot tell you that
 * the rest are closed. The filter belongs on the way in, never on the data.
 */

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  reqNum: string;
  /** Close or reopen one row. Absent for a viewer, who sees the state but
   *  cannot change it. */
  onUpdateClosed?: (id: string, closed: boolean) => void;
  /** The WHOLE ledger, never a filtered slice — see the note above. */
  tickets: Ticket[];
  onClose: () => void;
}

/** A running total per currency. SAR and AED never share a figure: adding them
 *  produces a number that looks like money and is not. */
type Money = Record<string, number>;
const add = (m: Money, cur: string, n: number) => { m[cur] = (m[cur] ?? 0) + n; };
const show = (m: Money) => {
  const parts = Object.entries(m).filter(([, v]) => Math.abs(v) >= 0.005);
  return parts.length ? parts.map(([c, v]) => `${fmt(v)} ${c}`).join(' · ') : '—';
};

const Tile: React.FC<{ label: string; value: React.ReactNode; tone?: string }> =
  ({ label, value, tone }) => (
  <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2.5">
    <div className={`font-mono font-bold text-sm ${tone ?? 'text-slate-700'}`}>{value}</div>
    <div className="text-[9px] uppercase text-slate-400 font-bold mt-0.5">{label}</div>
  </div>
);

export const RequestProfile: React.FC<Props> = ({ reqNum, tickets, onClose, onUpdateClosed }) => {
  const r = useMemo(() => {
    const key = reqNum.trim().toUpperCase();
    const rows = tickets.filter(t => (t.reqNum || '').trim().toUpperCase() === key
      && (t.status || '').toUpperCase() !== 'FUND');

    const issues = rows.filter(t => (t.amount || 0) >= 0);
    const refunds = rows.filter(t => (t.amount || 0) < 0);
    const closed = rows.filter(t => t.closed);
    const open = rows.filter(t => !t.closed);

    const issued: Money = {}, refunded: Money = {}, net: Money = {}, openValue: Money = {};
    for (const t of rows) {
      const cur = t.currency || 'SAR';
      add(net, cur, t.amount || 0);
      if ((t.amount || 0) >= 0) add(issued, cur, t.amount || 0);
      else add(refunded, cur, Math.abs(t.amount || 0));
      if (!t.closed) add(openValue, cur, t.amount || 0);
    }

    return {
      rows, issues, refunds, closed, open, issued, refunded, net, openValue,
      sources: [...new Set(rows.map(t => t.source).filter(Boolean))],
      office: classifyOffice(reqNum),
      // The state worth shouting about: part finished, part not.
      mixed: closed.length > 0 && open.length > 0,
      allClosed: rows.length > 0 && open.length === 0,
      // Open rows first — they are the only ones anybody has to act on.
      sorted: [...rows].sort((a, b) =>
        Number(!!a.closed) - Number(!!b.closed)
        || (a.date || '').localeCompare(b.date || '')),
    };
  }, [reqNum, tickets]);

  /**
   * The request as a sheet, in the order the screen shows it.
   *
   * Open rows first, same as above: the file is usually going to whoever has
   * to chase them, and burying them among seventy-two closed rows would undo
   * the one thing this screen does. A Closed column reading Yes/No rather
   * than TRUE/FALSE, because it is read by people, and a summary block under
   * the rows so the totals travel with the file instead of having to be
   * rebuilt by whoever opens it.
   */
  const exportSheet = () => {
    const rows = r.sorted.map(t => ({
      'Date':        t.date || '',
      'A/L':         t.airlineCode || '',
      'Ticket No.':  t.ticketNo,
      'Source':      t.source || '',
      'Type':        t.status || 'ISSUE',
      'Passenger':   t.passengerName || '',
      'PNR':         t.pnr || '',
      'Req Num':     t.reqNum || '',
      'Invoice':     t.vendorReference || '',
      'Amount':      t.amount ?? 0,
      'Curr':        t.currency || '',
      'Closed':      t.closed ? 'Yes' : 'No',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const money = (m: Money) =>
      Object.entries(m).map(([c, v]) => `${fmt(v)} ${c}`).join(' / ') || '—';
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['REQUEST', reqNum],
      ['Office', r.office ? OFFICE_LABEL[r.office as Exclude<Office, ''>] : ''],
      ['Suppliers', r.sources.join(', ')],
      ['Rows', r.rows.length],
      ['Closed', r.closed.length],
      ['Not closed', r.open.length],
      ['Tickets', r.issues.length],
      ['Refunds', r.refunds.length],
      ['Issued', money(r.issued)],
      ['Refunded', money(r.refunded)],
      ['Net', money(r.net)],
      ...(r.mixed
        ? [['STATUS', `PART CLOSED — ${r.open.length} of ${r.rows.length} still open,`
            + ` ${money(r.openValue)} outstanding`]]
        : [['STATUS', r.allClosed ? 'Fully closed' : 'Nothing closed yet']]),
      ['Exported', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    ], { origin: -1 });

    const wb = XLSX.utils.book_new();
    // A sheet name cannot carry : \ / ? * [ ] and is capped at 31 characters.
    XLSX.utils.book_append_sheet(wb, ws, reqNum.replace(/[:\\/?*[\]]/g, '-').slice(0, 31));
    XLSX.writeFile(wb, `${reqNum.replace(/[^A-Za-z0-9_-]+/g, '_')}.xlsx`);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
         onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col"
           onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 font-mono text-base">{reqNum}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{r.rows.length} row{r.rows.length === 1 ? '' : 's'}</span>
              {r.office && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-slate-400" />
                  {OFFICE_LABEL[r.office as Exclude<Office, ''>]}
                </span>
              )}
              {r.sources.length > 0 && <span>· {r.sources.join(', ')}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {r.rows.length > 0 && (
              <button onClick={exportSheet}
                title="Download this request as a spreadsheet"
                className="flex items-center gap-1.5 bg-purple-600 text-white text-[11px]
                           font-bold px-3 py-1.5 rounded hover:bg-purple-700">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-auto">
          {r.rows.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-6 text-center">
              Nothing in the ledger carries this request number.
            </p>
          ) : (
            <>
              {/* The finding, before the figures. A request that is part
                  closed is the one case a person cannot see by scrolling. */}
              {r.mixed && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3
                                flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-900 flex-1">
                    <b>This request is only part closed.</b>{' '}
                    {r.closed.length} of its {r.rows.length} rows are closed and{' '}
                    <b>{r.open.length} {r.open.length === 1 ? 'is' : 'are'} not</b>
                    {show(r.openValue) !== '—' && <> — {show(r.openValue)} still outstanding</>}.
                    {' '}They are listed first below.
                    {onUpdateClosed && (
                      <button
                        onClick={() => r.open.forEach(t => onUpdateClosed(t.id, true))}
                        className="ml-2 bg-amber-600 text-white text-[10px] font-bold px-2 py-1
                                   rounded hover:bg-amber-700 whitespace-nowrap">
                        Close the remaining {r.open.length}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {r.allClosed && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5
                                flex items-center gap-2.5 text-xs text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Every row on this request is closed.</span>
                </div>
              )}
              {!r.mixed && !r.allClosed && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5
                                flex items-center gap-2.5 text-xs text-slate-600">
                  <Circle className="w-4 h-4 shrink-0 text-slate-400" />
                  <span>Nothing on this request is closed yet.</span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-center">
                <Tile label="Tickets" value={r.issues.length} />
                <Tile label="Refunds" value={r.refunds.length}
                      tone={r.refunds.length ? 'text-emerald-600' : undefined} />
                <Tile label="Issued" value={show(r.issued)} />
                <Tile label="Refunded" value={show(r.refunded)}
                      tone={r.refunds.length ? 'text-emerald-600' : undefined} />
                <Tile label="Net" value={show(r.net)} tone="text-slate-900" />
              </div>

              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center
                                justify-between text-[9px] font-bold uppercase text-slate-500">
                  <span>Every row on this request</span>
                  <span>
                    <span className="text-orange-600">{r.open.length} not closed</span>
                    {' · '}
                    <span className="text-emerald-600">{r.closed.length} closed</span>
                  </span>
                </div>
                <div className="max-h-[46vh] overflow-auto">
                  <table className="w-full text-left min-w-[720px]">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100 text-[9px] uppercase
                                     tracking-wider text-slate-400">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Ticket</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Passenger</th>
                        <th className="px-3 py-2">Invoice</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-center">Closed</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      {r.sorted.map(t => (
                        <tr key={t.id}
                            className={`border-b border-slate-50 ${t.closed ? '' : 'bg-orange-50/50'}`}>
                          <td className="px-3 py-1.5 text-[10px] text-slate-500 whitespace-nowrap">
                            {t.date || <span className="text-red-400">no date</span>}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] font-bold text-slate-700 whitespace-nowrap">
                            {t.airlineCode ? `${t.airlineCode}-${t.ticketNo}` : t.ticketNo}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-slate-500">{t.source}</td>
                          <td className="px-3 py-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold
                              ${(t.amount || 0) < 0
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'}`}>
                              {t.status || 'ISSUE'}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-600 max-w-[160px] truncate">
                            {t.passengerName || '—'}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-slate-500">
                            {t.vendorReference || <span className="text-slate-300">—</span>}
                          </td>
                          <td className={`px-3 py-1.5 text-right font-bold
                            ${(t.amount || 0) < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                            {(t.amount || 0) < 0 ? '−' : ''}{fmt(t.amount || 0)}
                            <span className="text-slate-400 font-normal ml-1 text-[9px]">
                              {t.currency}
                            </span>
                          </td>
                          {/* Closing belongs here rather than only on the
                              ledger. This is the screen that shows a request
                              is part finished, so it is the screen where the
                              last two rows get dealt with - sending someone
                              to another page to act on what they just found
                              is how the finding gets lost. */}
                          <td className="px-3 py-1.5 text-center">
                            {onUpdateClosed ? (
                              <button
                                onClick={() => onUpdateClosed(t.id, !t.closed)}
                                title={t.closed ? 'Reopen this row' : 'Close this row'}
                                className={`text-[8px] font-sans font-bold px-1.5 py-0.5 rounded
                                  transition ${t.closed
                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                    : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                                {t.closed ? 'CLOSED' : 'OPEN'}
                              </button>
                            ) : t.closed
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline" />
                              : <span className="bg-orange-100 text-orange-700 text-[8px] font-sans
                                                 font-bold px-1.5 py-0.5 rounded">OPEN</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tickets and refunds are counted separately above; this says
                  what the request cost once the refunds are taken off, which
                  is the figure a client conversation actually turns on. */}
              <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" /> {r.issues.length} issued
                  </span>
                  <span className="flex items-center gap-1 text-emerald-600">
                    <TrendingUp className="w-3 h-3" /> {r.refunds.length} refunded
                  </span>
                </span>
                <span className="font-mono">net <b className="text-slate-800">{show(r.net)}</b></span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RequestProfile;
