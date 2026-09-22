import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { PendingTicket } from '../types';
import { knownSources } from '../core/config/sources';
import { CURRENCIES } from './ManualEntry';
import {
  whyNotConfirmable, cellKey, cellShares, canSplit,
} from '../core/helpers/pendingFromFindings';
import { writeClipboard } from '../utils/clipboard';
import {
  CheckCircle2, X, Loader2, Copy, AlertTriangle, Lock, Undo2, Trash2, Inbox,
  ChevronLeft, ChevronRight, Scissors,
} from 'lucide-react';

/**
 * Tickets proposed by the team-sheet check, one decision at a time.
 *
 * The check finds a couple of hundred tickets that are on the aviation
 * team's sheet and in nobody's books. Importing them in one go would be the
 * obvious thing and the wrong one: their currency, their idea of the
 * request and their price are all theirs, so a bulk import would put a
 * couple of hundred unverified rows into the ledger and move every vendor
 * balance at once, with no record of who agreed to any of it.
 *
 * So each proposal waits here until somebody prices it and confirms it, and
 * confirming is what writes the ticket. Nothing on this screen is in the
 * ledger; nothing on it moves a balance or shows in a report.
 *
 * WHAT ARRIVES FILLED IN, AND WHAT DOES NOT
 *
 * The price arrives filled in from their "Net Cost", which is a net — the
 * marked-up rate lives in a column of their sheet that is never read. It
 * matches our own figure exactly about two times in three, so a blank
 * would have been the worse default. A row keeps `theirCost` beside the
 * amount, so a figure nobody has checked still looks different from one
 * somebody corrected, and the tile at the top counts them.
 *
 * It arrives EMPTY when their cell named several tickets, because the
 * money on that cell is the booking's and would treble the cost.
 *
 * Sometimes the vendor is empty too. Their portal names an airline where
 * two of our houses bill for it, and only a person knows which.
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

/**
 * How many proposals are on screen at once.
 *
 * Every one of them is a form: six inputs, two selects with a dozen
 * options each, and a handful of badges. Two hundred of those is upwards
 * of two thousand DOM nodes that React has to reconcile whenever anything
 * in the parent changes, and the screen visibly stalled. Twenty-five is
 * about a screenful and a half — enough to work through without paging
 * constantly, small enough that the page never stops responding.
 *
 * The counts, the money and the vendor chips are all still computed over
 * everything, so the page bounds what is DRAWN and never what is said.
 */
const PER_PAGE = 25;

/**
 * One proposal.
 *
 * Its own component, and memoised, because there are two hundred of them
 * and the parent's state changes on every keystroke in the search box and
 * on every realtime event. Without this, typing one character re-rendered
 * two hundred cards carrying six inputs and a fifteen-option select each,
 * and the screen came to a stop.
 */
interface RowProps {
  p: PendingTicket;
  sources: string[];
  canWrite: boolean;
  working: boolean;
  field: string;
  /** Every proposal that came out of the same cell of their sheet, this
   *  one included. One row long when the cell named one ticket. */
  group: PendingTicket[];
  onSplit: (p: PendingTicket, group: PendingTicket[]) => void;
  onCopy: (text: string) => void;
  onPatch: (p: PendingTicket, patch: Partial<PendingTicket>) => void;
  onConfirm: (p: PendingTicket) => void;
  onReject: (p: PendingTicket) => void;
  onReopen: (p: PendingTicket) => void;
  onDelete: (p: PendingTicket) => void;
}

const Row = React.memo(function Row({
  p, sources, canWrite, working, field, group, onSplit,
  onCopy, onPatch, onConfirm, onReject, onReopen, onDelete,
}: RowProps) {
  const blocked = whyNotConfirmable(p);
  const priced = !!p.amount;
      /* Their Net Cost, copied in and not yet looked at. Worth saying
         out loud on the row: it is right about two times in three, and
         the third time is the reason this screen exists. */
      const untouched = priced && p.theirCost != null
        && Math.abs(p.amount) === Math.abs(p.theirCost);
      /* Their cell named more than one ticket, so the figure beside it
         is the booking's. 123 of the first 206 are like this, one of
         them a cell of 45 against 139,500 — which is why nothing is
         divided automatically and nothing is prefilled. */
      const shared = (p.theirGroup ?? 1) > 1;
      /* What this ticket would get if the cell were divided evenly. Shown
         on the row rather than left as arithmetic: "2,960.00 covers 5"
         tells somebody the problem and nothing about what to type. */
      const blockedSplit = shared ? canSplit(group, p) : 'not shared';
      const share = shared && !blockedSplit
        ? cellShares(group, p)[Math.max(0, group.findIndex(x => x.id === p.id))]
        : null;
      /* Their cell named more than are waiting, because the rest are
         already in our books. Worth saying: it is the difference between
         "divide by five" and "divide by the two you can see". */
      const partly = shared && group.length < (p.theirGroup ?? 1);
      return (
        <div key={p.id}
          className={`bg-white border rounded-lg overflow-hidden ${
            p.heldBack ? 'border-amber-200' : blocked ? 'border-slate-200'
                                                      : 'border-emerald-200'}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5
                          border-b border-slate-50">
            <button type="button" onClick={() => onCopy(
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
              <button type="button" onClick={() => onCopy(p.pnr!)}
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
            {/* Their cell, when it does not read as the number we took out
                of it. A conjunction is written "176-5513261452-53": the
                second document is 5513261453, which is correct and does
                NOT appear in their file as text — so anybody searching
                their sheet for it finds nothing and concludes we made it
                up. This is the line that makes the search land. */}
            {p.theirCell && p.theirCell !== p.ticketNo
              && !p.theirCell.endsWith(p.ticketNo) && (
              <button type="button" onClick={() => onCopy(p.theirCell!)}
                title="Search their sheet for this — it is the cell the number came out of"
                className="group flex items-center gap-1.5 text-[10px] font-mono
                           text-sky-700 bg-sky-50 rounded px-1.5 py-0.5 hover:bg-sky-100">
                <Copy className="w-3 h-3 text-sky-300 group-hover:text-sky-600" />
                their cell: {p.theirCell.length > 40
                  ? p.theirCell.slice(0, 40) + '…' : p.theirCell}
              </button>
            )}
            {p.theirPortal && (
              <span className="text-[10px] text-slate-400 font-mono"
                    title="Their own word for where it was bought">
                their portal: {p.theirPortal}
              </span>
            )}
            {/* Their figure, labelled every time it is shown. */}
            {!!p.theirCost && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                shared ? 'bg-sky-50 text-sky-700'
                : untouched ? 'bg-amber-50 text-amber-700' : 'text-slate-400'}`}>
                {/* A shared cell is the one case where their figure is
                    not this ticket's, so it never reads as a price. */}
                {shared
                  ? `${money(p.theirCost)} ${p.currency} covers ${p.theirGroup} tickets`
                    + (share != null ? ` — ${money(share)} each` : '')
                    + (partly ? `, ${group.length} of them still waiting` : '')
                  : untouched
                    ? `${money(p.theirCost)} ${p.currency} — their figure, not checked yet`
                    : `they said ${money(p.theirCost)} ${p.currency}`}
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
                onChange={e => onPatch(p, { source: e.target.value })}
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
                onChange={e => onPatch(p, { date: e.target.value })}
                className={`${field} w-36`} />
            </label>

            <label className="block">
              <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                What it cost{' '}
                {shared
                  ? <span className="text-sky-500">· 1 of {p.theirGroup}</span>
                  : untouched && <span className="text-amber-500">· theirs</span>}
              </span>
              <input
                type="number" step="0.01" defaultValue={p.amount ? Math.abs(p.amount) : ''}
                disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                placeholder="0.00"
                onBlur={e => {
                  const v = Number(e.target.value.replace(/[^0-9.-]/g, ''));
                  const next = Number.isNaN(v) ? 0 : Math.abs(v);
                  if (next === Math.abs(p.amount)) return;
                  onPatch(p, { amount: next, totalDoc: next });
                }}
                className={`${field} w-32 text-right ${
                  priced ? (untouched ? 'border-amber-200' : '')
                         : 'border-amber-300 bg-amber-50'}`} />
            </label>

            <label className="block">
              <span className="text-[9px] font-bold uppercase text-slate-400 block mb-1">
                Currency
              </span>
              <select value={p.currency || 'AED'}
                disabled={!canWrite || p.state !== 'PENDING' || p.heldBack}
                onChange={e => onPatch(p, { currency: e.target.value as PendingTicket['currency'] })}
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
                  if (v !== p.reqNum) onPatch(p, { reqNum: v });
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
                  if (v !== (p.passengerName || '')) onPatch(p, { passengerName: v });
                }}
                className={`${field} w-48`} />
            </label>

            {p.state === 'PENDING' && canWrite && (
              <div className="flex items-center gap-2 ml-auto">
                {/* A cell nobody can price by hand without doing the
                    arithmetic first. The figure is the booking's and the
                    per-ticket fares are not in their sheet at all, so the
                    only honest division is an even one — and it is one
                    click rather than a sum on paper and five edits. */}
                {shared && !priced && canWrite && p.state === 'PENDING' && (
                  blockedSplit ? (
                    <span className="flex items-center gap-1.5 text-[10px] text-slate-500
                                     max-w-[260px] leading-snug">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      {blockedSplit}
                    </span>
                  ) : (
                    <button onClick={() => onSplit(p, group)} disabled={working}
                      title={partly
                        ? `Their cell named ${p.theirGroup} tickets and ${group.length} are`
                          + ' waiting; the rest are already in our books. Each waiting one'
                          + ` gets a ${p.theirGroup}th of ${money(p.theirCost ?? 0)}`
                          + ` ${p.currency}.`
                        : `Give each of the ${group.length} tickets that shared this cell an`
                          + ` equal share. They add back to ${money(p.theirCost ?? 0)}`
                          + ` ${p.currency} exactly.`}
                      className="flex items-center gap-1.5 bg-sky-600 text-white text-[11px]
                                 font-bold px-3 py-1.5 rounded hover:bg-sky-700
                                 disabled:opacity-50">
                      {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                               : <Scissors className="w-3.5 h-3.5" />}
                      Split across {p.theirGroup}{partly && ` · ${group.length} here`}
                    </button>
                  )
                )}
                {blocked ? (
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-500
                                   max-w-[240px] leading-snug">
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
                  <button onClick={() => onConfirm(p)}
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
                  <button onClick={() => onReject(p)} disabled={working}
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
                  <button onClick={() => onReopen(p)} disabled={working}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500
                               hover:text-slate-800 px-2 py-1.5">
                    <Undo2 className="w-3.5 h-3.5" /> Put it back
                  </button>
                )}
                {onDelete && (
                  <button onClick={() => onDelete(p)} disabled={working}
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
      )
});

interface Props {
  pending: PendingTicket[];
  vendorNames?: string[];
  ledgerSources?: string[];
  onPatch?: (id: string, patch: Partial<PendingTicket>) => Promise<void>;
  /** Price several rows at once — one cell of their sheet divided across
   *  the tickets that shared it. */
  onPatchMany?: (updates: { id: string; amount: number }[]) => Promise<void>;
  onConfirm?: (p: PendingTicket) => Promise<unknown>;
  onReject?: (id: string, why: string) => Promise<void>;
  onReopen?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

type Tab = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export const PendingReview: React.FC<Props> = ({
  pending, vendorNames = [], ledgerSources = [],
  onPatch, onPatchMany, onConfirm, onReject, onReopen, onDelete,
}) => {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [vendorFilter, setVendorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [pageNo, setPageNo] = useState(0);
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
   * A row somebody has corrected carries OUR figure; one nobody has
   * touched still carries theirs. They are close but they are not the
   * same claim, and one total across both would be a number that is
   * partly checked and partly not, and true of nothing.
   */
  const waiting = useMemo(() => {
    const ours = new Map<string, number>();
    const theirs = new Map<string, number>();
    for (const p of rows) {
      const cur = p.currency || 'AED';
      const v = Math.abs(p.amount || p.theirCost || 0);
      if (!v) continue;
      // Untouched means the amount is still exactly what they said.
      const untouched = p.theirCost != null && Math.abs(p.amount) === Math.abs(p.theirCost);
      const into = untouched ? theirs : ours;
      into.set(cur, (into.get(cur) ?? 0) + v);
    }
    return { ours: [...ours], theirs: [...theirs] };
  }, [rows]);

  const ready = rows.filter(p => !whyNotConfirmable(p)).length;

  /**
   * Which proposals came out of one cell of their sheet.
   *
   * Built over the WHOLE queue rather than the page, because the five
   * tickets that shared a cell will not all be on the same page and
   * dividing four of them would be worse than dividing none.
   */
  const cells = useMemo(() => {
    const m = new Map<string, PendingTicket[]>();
    for (const p of pending) {
      if ((p.theirGroup ?? 1) < 2 || p.state !== 'PENDING') continue;
      const k = cellKey(p);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    // Stable order, so "the last one takes the remainder" means the same
    // ticket every time and the figures do not move between renders.
    for (const g of m.values()) g.sort((a, x) => a.ticketNo.localeCompare(x.ticketNo));
    return m;
  }, [pending]);

  const groupOf = useCallback(
    (p: PendingTicket) => cells.get(cellKey(p)) ?? [p], [cells]);

  /* ── what is on screen ────────────────────────────────────────────────
     Only the drawing is paged. Every count above is over the whole list. */
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const page = useMemo(
    () => rows.slice(pageNo * PER_PAGE, (pageNo + 1) * PER_PAGE),
    [rows, pageNo]);

  /* Back to the first page whenever the list underneath changes, so a
     filter that leaves four rows never lands on an empty page seven. And
     back inside the list when confirming the last row shortens it. */
  useEffect(() => { setPageNo(0); }, [tab, vendorFilter, search]);
  useEffect(() => { if (pageNo >= pages) setPageNo(pages - 1); }, [pages, pageNo]);

  const copy = useCallback(async (text: string) => {
    if (await writeClipboard(text)) {
      setCopied(text);
      setTimeout(() => setCopied(''), 1600);
    }
  }, []);

  /**
   * Run one action, and say something useful when it fails.
   *
   * "TypeError: Failed to fetch" is what the browser says when a request
   * never reached the server at all, and on its own it tells nobody
   * anything — least of all whether their edit was saved. So the message
   * names what was being done and what to do about it.
   */
  const run = useCallback(async (id: string, what: string, fn: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await fn(); }
    catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(/failed to fetch|networkerror|load failed/i.test(raw)
        ? `${what} did not reach the server — the connection dropped. Nothing was saved;`
          + ' check you are online and try it again.'
        : `${what} failed: ${raw}`);
    }
    finally { setBusy(''); }
  }, []);

  const patch = useCallback((p: PendingTicket, patchIn: Partial<PendingTicket>) => {
    if (onPatch) run(p.id, 'That change', () => onPatch(p.id, patchIn));
  }, [onPatch, run]);

  const confirm = useCallback((p: PendingTicket) => {
    if (onConfirm) run(p.id, `Recording ${p.ticketNo || p.pnr}`, () => onConfirm(p));
  }, [onConfirm, run]);

  const reopen = useCallback((p: PendingTicket) => {
    if (onReopen) run(p.id, 'Putting it back', () => onReopen(p.id));
  }, [onReopen, run]);

  const remove = useCallback((p: PendingTicket) => {
    if (onDelete) run(p.id, 'Removing it', () => onDelete(p.id));
  }, [onDelete, run]);

  /**
   * Divide one cell across the tickets that shared it.
   *
   * Their sheet prices the booking and never the tickets, so the parts
   * are approximate and the total is exact — which is the way round that
   * costs nothing when the request is costed. Said out loud before it
   * happens, because it is a claim about each passenger's fare that their
   * sheet does not actually make.
   */
  const split = useCallback((p: PendingTicket, group: PendingTicket[]) => {
    if (!onPatchMany) return;
    const total = Math.abs(p.theirCost ?? 0);
    const named = p.theirGroup ?? group.length;
    const parts = cellShares(group, p);
    const short = group.length < named;
    const ok = window.confirm(
      `${money(total)} ${p.currency} was charged for ${named} tickets on one line of`
      + ` their sheet.\n\n`
      + group.map((x, i) => `   ${x.ticketNo}   ${money(parts[i])}`).join('\n')
      + '\n\n'
      + (short
        ? `${group.length} of the ${named} are waiting here; the rest are already in our`
          + ` books with their own cost. Each of these gets a ${named}th, so the request`
          + ' picks up exactly the part of the booking that was missing from it.'
        : `They add back to ${money(total)} exactly.`)
      + ' Their sheet prices the booking and never the tickets, so the total is'
      + ' right and the split between passengers is even rather than known.'
      + ' Change any of them afterwards.');
    if (!ok) return;
    run(p.id, 'Splitting that cell',
      () => onPatchMany(group.map((x, i) => ({ id: x.id, amount: parts[i] }))));
  }, [onPatchMany, run]);

  const reject = useCallback((p: PendingTicket) => {
    if (!onReject) return;
    const why = window.prompt(
      'Why is this not a ticket for our books?\n\nWhat you write here is the only record'
      + ' that it was looked at rather than ignored.', '');
    if (why === null) return;
    run(p.id, 'Turning it down', () => onReject(p.id, why));
  }, [onReject, run]);

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
          somebody checks it and presses Confirm, and Confirm is what records it.
          {' '}<b className="text-slate-600">The price is theirs until you touch it</b>:
          it comes from their Net Cost, which matches ours about two times in three, and
          the row says so for as long as nobody has changed it.
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
              checked{' '}
              {waiting.ours.map(([c, v]) => (
                <b key={c} className="font-mono text-slate-700 mr-2">{money(v)} {c}</b>
              ))}
            </span>
          )}
          {waiting.theirs.length > 0 && (
            <span className="text-slate-500"
                  title="Their Net Cost, copied in and not yet looked at">
              still their figure{' '}
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
        {page.map(p => (
          <Row key={p.id} p={p} sources={sources} canWrite={canWrite}
            working={busy === p.id} field={field}
            group={groupOf(p)} onSplit={split}
            onCopy={copy} onPatch={patch} onConfirm={confirm}
            onReject={reject} onReopen={reopen} onDelete={remove} />
        ))}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button onClick={() => setPageNo(n => Math.max(0, n - 1))} disabled={pageNo === 0}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-500
                       hover:text-slate-800 disabled:opacity-30 px-2 py-1.5">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
          <span className="text-[11px] text-slate-500 font-mono">
            {pageNo * PER_PAGE + 1}–{Math.min((pageNo + 1) * PER_PAGE, rows.length)}
            {' '}of <b className="text-slate-700">{rows.length}</b>
          </span>
          <button onClick={() => setPageNo(n => Math.min(pages - 1, n + 1))}
            disabled={pageNo >= pages - 1}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-500
                       hover:text-slate-800 disabled:opacity-30 px-2 py-1.5">
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
