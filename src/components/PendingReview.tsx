import React, { useMemo, useState } from 'react';
import { PendingTicket } from '../types';
import { knownSources } from '../core/config/sources';
import { CURRENCIES } from './ManualEntry';
import { whyNotConfirmable } from '../core/helpers/pendingFromFindings';
import { writeClipboard } from '../utils/clipboard';
import {
  CheckCircle2, X, Loader2, Copy, AlertTriangle, Lock, Undo2, Trash2, Inbox,
} from 'lucide-react';

/**
 * Tickets proposed by the team-sheet check, one decision at a time.
 *
 * The check finds a couple of hundred tickets that are on the aviation
 * team's sheet and in nobody's books. Importing them in one go would be the
 * obvious thing and the wrong one: their sheet carries their markup, their
 * quoting currency and their idea of the request, so a bulk import would put
 * a couple of hundred unverified rows into the ledger and move every vendor
 * balance at once, with no record of who agreed to any of it.
 *
 * So each proposal waits here until somebody prices it and confirms it, and
 * confirming is what writes the ticket. Nothing on this screen is in the
 * ledger; nothing on it moves a balance or shows in a report.
 *
 * WHAT THE REVIEWER HAS TO SUPPLY, AND WHY IT IS NOT PREFILLED
 *
 * The price. Their cost column is a quote with their uplift on it — 1,371
 * SAR beside our 1,340 AED for the same ticket — and the actual cost is the
 * one thing the reviewer has and the sheet does not. It is shown, labelled
 * as theirs, and it is not copied into the amount.
 *
 * Sometimes the vendor. Their portal names an airline where two of our
 * houses bill for it, and only a person knows which.
 *
 * WHAT CANNOT BE CONFIRMED AT ALL
 *
 * Ibtekar and NSA settle against a credit wallet from a statement imported
 * whole. A ticket of theirs keyed in here would move that wallet twice. They
 * are listed, so the gap is visible, with the confirm closed and the reason
 * on the row.
 */

const money = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  pending: PendingTicket[];
  vendorNames?: string[];
  ledgerSources?: string[];
  onPatch?: (id: string, patch: Partial<PendingTicket>) => Promise<void>;
  onConfirm?: (p: PendingTicket) => Promise<unknown>;
  onReject?: (id: string, why: string) => Promise<void>;
  onReopen?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

type Tab = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export const PendingReview: React.FC<Props> = ({
  pending, vendorNames = [], ledgerSources = [],
  onPatch, onConfirm, onReject, onReopen, onDelete,
}) => {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [vendorFilter, setVendorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const canWrite = !!onConfirm;
  const sources = useMemo(
    () => knownSources(vendorNames, ledgerSources), [vendorNames, ledgerSources]);

  const counts = useMemo(() => ({
    PENDING:   pending.filter(p => p.state === 'PENDING').length,
    CONFIRMED: pending.filter(p => p.state === 'CONFIRMED').length,
    REJECTED:  pending.filter(p => p.state === 'REJECTED').length,
  }), [pending]);

  /** Which vendors are waiting, and how many each. The first question when
   *  two hundred rows land is "where do I start", and the answer is almost
   *  always one vendor's portal at a time. */
  const byVendor = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pending) {
      if (p.state !== tab) continue;
      const k = p.source || p.theirPortal || '(no vendor)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [pending, tab]);

  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    return pending.filter(p => {
      if (p.state !== tab) return false;
      if (vendorFilter && (p.source || p.theirPortal || '(no vendor)') !== vendorFilter) return false;
      if (!q) return true;
      return [p.ticketNo, p.pnr, p.reqNum, p.theirReq, p.passengerName, p.source]
        .some(v => (v || '').toUpperCase().includes(q));
    });
  }, [pending, tab, vendorFilter, search]);

  /**
   * What is waiting, kept in two piles that must never be added together.
   *
   * A priced row carries OUR figure; an unpriced one carries only theirs,
   * which has their markup on it and is in whichever currency they quoted.
   * One total across both would be a number that is partly ours and partly
   * theirs and true of nothing.
   */
  const waiting = useMemo(() => {
    const ours = new Map<string, number>();
    const theirs = new Map<string, number>();
    for (const p of rows) {
      const cur = p.currency || 'AED';
      if (p.amount) ours.set(cur, (ours.get(cur) ?? 0) + Math.abs(p.amount));
      else if (p.theirCost) theirs.set(cur, (theirs.get(cur) ?? 0) + Math.abs(p.theirCost));
    }
    return { ours: [...ours], theirs: [...theirs] };
  }, [rows]);

  const ready = rows.filter(p => !whyNotConfirmable(p)).length;

  const copy = async (text: string) => {
    if (await writeClipboard(text)) {
      setCopied(text);
      setTimeout(() => setCopied(''), 1600);
    }
  };

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const patch = (p: PendingTicket, patchIn: Partial<PendingTicket>) =>
    onPatch && run(p.id, () => onPatch(p.id, patchIn));

  const reject = (p: PendingTicket) => {
    if (!onReject) return;
    const why = window.prompt(
      'Why is this not a ticket for our books?\n\nWhat you write here is the only record'
      + ' that it was looked at rather than ignored.', '');
    if (why === null) return;
    run(p.id, () => onReject(p.id, why));
  };

  const tabClass = (t: Tab) =>
    `px-3 py-1.5 text-[11px] font-bold rounded transition-colors ${
      tab === t ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'}`;

  const field = 'bg-white border border-slate-200 rounded px-2 py-1 text-[11px] font-mono '
    + 'focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400';

  return (
    <div className="p-6 space-y-4">
      {copied && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2
                        bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg
                        text-[11px] font-mono max-w-md">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">Copied <span className="font-bold">{copied}</span></span>
        </div>
      )}

      <div>
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">
          To review
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
          Tickets the team-sheet check found on their sheet and in nobody's books. None of
          them is in the ledger and none of them is moving a balance — each waits here until
          somebody prices it and presses Confirm, and Confirm is what records it.
          {' '}<b className="text-slate-600">Their cost is not our cost</b>: their column
          carries their markup and their quoting currency, so it is shown beside the row
          and never copied into it.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 flex items-start
                        gap-2 text-[11px] text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span className="font-mono">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── what state, and how much of it ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {(['PENDING', 'CONFIRMED', 'REJECTED'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setVendorFilter(''); }} className={tabClass(t)}>
            {t === 'PENDING' ? 'Waiting' : t === 'CONFIRMED' ? 'Recorded' : 'Turned down'}
            <span className="ml-1.5 opacity-60">{counts[t]}</span>
          </button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ticket, PNR, request…"
          className={`${field} w-56 ml-auto`} />
      </div>

      {byVendor.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider mr-1">
            Bought from
          </span>
          <button onClick={() => setVendorFilter('')}
            className={`px-2 py-1 text-[10px] font-mono rounded border ${
              vendorFilter === '' ? 'bg-slate-800 text-white border-slate-800'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            all <span className="opacity-60">{byVendor.reduce((s, [, n]) => s + n, 0)}</span>
          </button>
          {byVendor.map(([v, n]) => (
            <button key={v} onClick={() => setVendorFilter(v)}
              className={`px-2 py-1 text-[10px] font-mono rounded border ${
                vendorFilter === v ? 'bg-slate-800 text-white border-slate-800'
                                   : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {v} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'PENDING' && rows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap
                        items-center gap-x-8 gap-y-2 text-[11px]">
          <span><b className="text-slate-700 text-sm">{rows.length}</b>
            <span className="text-slate-500"> waiting</span></span>
          <span><b className="text-emerald-600 text-sm">{ready}</b>
            <span className="text-slate-500"> ready to confirm</span></span>
          <span><b className="text-amber-600 text-sm">{rows.filter(p => p.heldBack).length}</b>
            <span className="text-slate-500"> held back</span></span>
          {waiting.ours.length > 0 && (
            <span className="text-slate-500">
              priced{' '}
              {waiting.ours.map(([c, v]) => (
                <b key={c} className="font-mono text-slate-700 mr-2">{money(v)} {c}</b>
              ))}
            </span>
          )}
          {waiting.theirs.length > 0 && (
            <span className="text-slate-500" title="Their figure, with their markup on it">
              not yet priced — they say{' '}
              {waiting.theirs.map(([c, v]) => (
                <b key={c} className="font-mono text-amber-700 mr-2">{money(v)} {c}</b>
              ))}
            </span>
          )}
        </div>
      )}

      {rows.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
          <Inbox className="w-6 h-6 text-slate-300 mx-auto mb-2" />
          {/* "Nothing matched what you typed" and "there is nothing here"
              are opposite facts, and saying the second when the first is
              true tells somebody their queue is empty when 237 are in it. */}
          {counts[tab] > 0 ? (
            <p className="text-xs text-slate-500">
              None of the <b>{counts[tab]}</b> here match
              {vendorFilter && <> <b className="font-mono">{vendorFilter}</b></>}
              {vendorFilter && search.trim() && ' and'}
              {search.trim() && <> “<b className="font-mono">{search.trim()}</b>”</>}.
              {' '}
              <button onClick={() => { setVendorFilter(''); setSearch(''); }}
                className="text-emerald-700 font-bold hover:underline">Clear it</button>.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              {tab === 'PENDING'
                ? 'Nothing waiting. Run the team sheet check and send what it finds here.'
                : tab === 'CONFIRMED' ? 'Nothing recorded from here yet.'
                : 'Nothing has been turned down.'}
            </p>
          )}
        </div>
      )}

      {/* ── the queue ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {rows.map(p => {
          const blocked = whyNotConfirmable(p);
          const working = busy === p.id;
          const priced = !!p.amount;
          return (
            <div key={p.id}
              className={`bg-white border rounded-lg overflow-hidden ${
                p.heldBack ? 'border-amber-200' : blocked ? 'border-slate-200'
                                                          : 'border-emerald-200'}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5
                              border-b border-slate-50">
                <button type="button" onClick={() => copy(
                  p.airlineCode && p.ticketNo ? `${p.airlineCode}-${p.ticketNo}` : p.ticketNo)}
                  className="group flex items-center gap-1.5 font-mono text-xs font-bold
                             text-slate-700 rounded px-1 -mx-1 hover:bg-slate-100">
                  <Copy className="w-3 h-3 text-slate-300 group-hover:text-slate-500" />
                  {p.airlineCode && p.ticketNo ? `${p.airlineCode}-${p.ticketNo}` : p.ticketNo || '—'}
                </button>
                {/* For a carrier that issues no IATA ticket the booking
                    reference IS the document, so both columns hold the same
                    value and printing it twice is noise. */}
                {p.pnr && p.pnr !== p.ticketNo && (
                  <button type="button" onClick={() => copy(p.pnr!)}
                    className="group flex items-center gap-1.5 font-mono text-[11px] text-slate-500
                               rounded px-1 -mx-1 hover:bg-slate-100">
                    <Copy className="w-3 h-3 text-slate-300 group-hover:text-slate-500" />
                    {p.pnr}
                  </button>
                )}
                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5
                                  rounded ${p.transactionType === 'REFUND'
                    ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {p.transactionType || 'ISSUE'}
                </span>
                {p.theirPortal && (
                  <span className="text-[10px] text-slate-400 font-mono"
                        title="Their own word for where it was bought">
                    their portal: {p.theirPortal}
                  </span>
                )}
                {/* Their figure, labelled every time it is shown. */}
                {!!p.theirCost && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    priced ? 'text-slate-400' : 'bg-amber-50 text-amber-700'}`}>
                    they say {money(p.theirCost)} {p.currency} — theirs, with their markup
                  </span>
                )}
                {p.state !== 'PENDING' && (
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5
                                    rounded ml-auto ${p.state === 'CONFIRMED'
                      ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.state === 'CONFIRMED' ? 'recorded' : 'turned down'}
                  </span>
                )}
              </div>

              <div className="px-4 py-3 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                    Vendor that billed it
                  </span>
                  <select
                    value={p.source} disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                    onChange={e => patch(p, { source: e.target.value })}
                    className={`${field} w-44 ${p.source ? '' : 'border-amber-300 bg-amber-50'}`}>
                    <option value="">— pick one —</option>
                    {/* The row's own vendor first when the list does not
                        carry it. A <select> whose value matches no option
                        renders blank, which would show "no vendor" on a row
                        that has one and lose it the moment anybody touched
                        the field. */}
                    {p.source && !sources.includes(p.source) && (
                      <option value={p.source}>{p.source}</option>
                    )}
                    {sources.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                    Date
                  </span>
                  <input type="date" value={p.date}
                    disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                    onChange={e => patch(p, { date: e.target.value })}
                    className={`${field} w-36`} />
                </label>

                <label className="block">
                  <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                    What it actually cost
                  </span>
                  <input
                    type="number" step="0.01" defaultValue={p.amount ? Math.abs(p.amount) : ''}
                    disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                    placeholder="0.00"
                    onBlur={e => {
                      const v = Number(e.target.value.replace(/[^0-9.-]/g, ''));
                      const next = Number.isNaN(v) ? 0 : Math.abs(v);
                      if (next === Math.abs(p.amount)) return;
                      patch(p, { amount: next, totalDoc: next });
                    }}
                    className={`${field} w-32 text-right ${
                      priced ? '' : 'border-amber-300 bg-amber-50'}`} />
                </label>

                <label className="block">
                  <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                    Currency
                  </span>
                  <select value={p.currency || 'AED'}
                    disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                    onChange={e => patch(p, { currency: e.target.value as PendingTicket['currency'] })}
                    className={`${field} w-20`}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                    Request {p.theirReq && <span className="text-slate-300">(theirs)</span>}
                  </span>
                  <input defaultValue={p.reqNum}
                    disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                    onBlur={e => {
                      const v = e.target.value.trim().toUpperCase();
                      if (v !== p.reqNum) patch(p, { reqNum: v });
                    }}
                    className={`${field} w-32`} />
                </label>

                <label className="block">
                  <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                    Passenger
                  </span>
                  <input defaultValue={p.passengerName || ''}
                    disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                    placeholder="their sheet does not say"
                    onBlur={e => {
                      const v = e.target.value.trim().toUpperCase();
                      if (v !== (p.passengerName || '')) patch(p, { passengerName: v });
                    }}
                    className={`${field} w-48`} />
                </label>

                {p.state === 'PENDING' && canWrite && (
                  <div className="flex items-center gap-2 ml-auto">
                    {blocked ? (
                      <span className="flex items-center gap-1.5 text-[10px] text-slate-500
                                       max-w-[280px] leading-snug">
                        {p.heldBack
                          ? <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                        {/* The reason for a hold is long and is already
                            written across the bottom of the row, where it
                            is readable. Saying it twice in half the width
                            is saying it once, badly. */}
                        {p.heldBack ? 'Held back' : blocked}
                      </span>
                    ) : (
                      <button onClick={() => onConfirm && run(p.id, () => onConfirm(p))}
                        disabled={working}
                        className="flex items-center gap-1.5 bg-emerald-600 text-white text-[11px]
                                   font-bold px-3 py-1.5 rounded hover:bg-emerald-700
                                   disabled:opacity-50">
                        {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                 : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Confirm
                      </button>
                    )}
                    {onReject && (
                      <button onClick={() => reject(p)} disabled={working}
                        title="Not a ticket for our books"
                        className="text-[11px] font-bold text-slate-400 hover:text-red-600 px-2 py-1.5">
                        Not ours
                      </button>
                    )}
                  </div>
                )}

                {p.state === 'REJECTED' && canWrite && (
                  <div className="flex items-center gap-2 ml-auto">
                    {onReopen && (
                      <button onClick={() => run(p.id, () => onReopen(p.id))} disabled={working}
                        className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500
                                   hover:text-slate-800 px-2 py-1.5">
                        <Undo2 className="w-3.5 h-3.5" /> Put it back
                      </button>
                    )}
                    {onDelete && (
                      <button onClick={() => run(p.id, () => onDelete(p.id))} disabled={working}
                        title="Remove it from the list for good"
                        className="text-slate-300 hover:text-red-600 px-1 py-1.5">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {(p.note || p.heldBackWhy || p.reviewNote) && (
                <div className="px-4 pb-2.5 space-y-1">
                  {p.heldBackWhy && (
                    <p className="text-[10px] text-amber-700 leading-relaxed flex items-start gap-1.5">
                      <Lock className="w-3 h-3 mt-px shrink-0" />{p.heldBackWhy}
                    </p>
                  )}
                  {p.note && !p.heldBackWhy && (
                    <p className="text-[10px] text-slate-500 leading-relaxed">{p.note}</p>
                  )}
                  {p.reviewNote && (
                    <p className="text-[10px] text-slate-600 leading-relaxed">
                      <b>Turned down:</b> {p.reviewNote}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
