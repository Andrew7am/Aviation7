import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Ticket } from '../types';
import {
  Upload, AlertTriangle, CheckCircle2, X, Loader2, FileSpreadsheet, Download,
  ChevronDown, ChevronRight, Info, ArrowLeftRight, FolderOpen, Copy, ClipboardCheck,
} from 'lucide-react';
import { readFileAsText } from '../core/ImportEngine';
import { parseTeamSheet, TeamSheetRow } from '../core/parsers/teamSheet';
import {
  compareTeamSheet, TeamSheetReport, Finding, Verdict, VERDICT_LABEL, VERDICT_RANK,
} from '../core/helpers/teamSheetCompare';
import { writeClipboard } from '../utils/clipboard';

const xlsx = () => import('xlsx');

/**
 * The aviation team's sheet against ours, before a flight sheet is closed.
 *
 * The team books the travel and records every ticket against its request;
 * accounting records the same tickets from what the suppliers bill. The two
 * lists are meant to be the same list, and until now the only way to check
 * that was by eye, a page at a time, which is why nobody did it.
 *
 * Nothing here writes. Their sheet is a claim about what was booked, and the
 * useful question about a claim is where it and the ledger disagree - so the
 * screen answers that and stops. Acting on a finding is a separate decision
 * made on a separate screen, with the audit trail that comes with it.
 */

const money = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** How each verdict reads. Money findings in red; the two that are states of
 *  the world rather than disagreements in grey, so they never look like work. */
const TONE: Record<Verdict, { chip: string; band: string; money: boolean }> = {
  REQ_DIFFERS:          { chip: 'bg-red-100 text-red-700',        band: 'border-red-300',     money: true },
  NOT_IN_LEDGER:        { chip: 'bg-red-100 text-red-700',        band: 'border-red-200',     money: true },
  REFUND_NOT_IN_LEDGER: { chip: 'bg-red-100 text-red-700',        band: 'border-red-200',     money: true },
  NOT_ON_SHEET:         { chip: 'bg-amber-100 text-amber-800',    band: 'border-amber-200',   money: true },
  REFUND_NOT_ON_SHEET:  { chip: 'bg-amber-100 text-amber-800',    band: 'border-amber-200',   money: true },
  REFUND_DIFFERS:       { chip: 'bg-amber-100 text-amber-800',    band: 'border-amber-200',   money: true },
  TWICE_ON_THEIR_SHEET: { chip: 'bg-amber-100 text-amber-800',    band: 'border-amber-200',   money: true },
  NO_TICKET_NUMBER:     { chip: 'bg-amber-100 text-amber-800',    band: 'border-amber-200',   money: true },
  UNREADABLE:           { chip: 'bg-amber-100 text-amber-800',    band: 'border-amber-200',   money: true },
  REQ_RELATED:          { chip: 'bg-sky-100 text-sky-700',         band: 'border-sky-200',     money: false },
  FILED_ELSEWHERE:      { chip: 'bg-sky-100 text-sky-700',         band: 'border-sky-200',     money: false },
  CONJUNCT_ALREADY_HELD:{ chip: 'bg-sky-100 text-sky-700',         band: 'border-sky-200',     money: false },
  VOID_NOT_BILLED:      { chip: 'bg-slate-100 text-slate-500',    band: 'border-slate-200',   money: false },
  REISSUE_NO_CHARGE:    { chip: 'bg-slate-100 text-slate-500',    band: 'border-slate-200',   money: false },
  VOID_AND_ISSUED:      { chip: 'bg-amber-100 text-amber-800',    band: 'border-amber-200',   money: true },
  OK:                   { chip: 'bg-emerald-100 text-emerald-700',band: 'border-emerald-200', money: false },
};

/** What each verdict means, said once at the top of its group rather than
 *  repeated on every row. */
const WHY: Record<Verdict, string> = {
  REQ_DIFFERS:
    'Both sides hold the ticket and each has filed it under a different request. This is'
    + ' the one disagreement where every count still looks right: two requests are wrong at'
    + ' once — one carrying a cost that is not its own, the other short of one that is —'
    + ' and neither total says so. Settle which request is correct before closing either.',
  NOT_IN_LEDGER:
    'On their sheet and nowhere in our books. Either the supplier has not billed it yet,'
    + ' or an import missed it. Worth checking before the sheet is signed off.',
  REFUND_NOT_IN_LEDGER:
    'They booked a refund and our books hold none. This is money we are owed and have'
    + ' not recorded receiving.',
  NOT_ON_SHEET:
    'In our books under a request their sheet covers, and not on their sheet at all.'
    + ' Either their record is short a ticket, or ours carries one that belongs elsewhere.',
  REFUND_NOT_ON_SHEET:
    'We hold a refund their sheet does not show. Their record may be behind, or the credit'
    + ' belongs to another booking.',
  REFUND_DIFFERS:
    'Both sides refunded, and the two figures are further apart than rounding can'
    + ' explain. Their refund carries the same uplift their cost does — measured across a'
    + ' full export it runs under three per cent — so only the gaps wider than that are'
    + ' listed here. Something on one of the two sides is wrong.',
  TWICE_ON_THEIR_SHEET:
    'Their sheet states a refund for one ticket on more than one row. Their normal shape is'
    + ' two rows — one Issued, one Cancelled/Refunded — with only the second carrying a'
    + ' figure; these carry two. Until their record settles on one number there is nothing'
    + ' ours can be compared against, so the refund check stands aside for them.',
  REQ_RELATED:
    'Each side files it under a different request, and the ledger already records those'
    + ' two as one piece of work — a cash-paid ticket raised under its own number beside'
    + ' the request it was split from. Listed so it is seen, not so it is chased.',
  UNREADABLE:
    'Their export lost these ticket numbers — a 13-digit number stored as a number comes'
    + ' out as 6.55512E+11 with the digits gone for good. Nothing about these rows can be'
    + ' checked. Ask them to export the ticket column as text.',
  FILED_ELSEWHERE:
    'The carriers that issue no IATA ticket give a booking reference that is both the'
    + ' booking and the document, and the two systems put it in different columns — theirs'
    + ' in the ticket column, ours in the PNR. Nothing is missing here; it is the same'
    + ' booking read from two sides.',
  NO_TICKET_NUMBER:
    'Their sheet marks these issued or refunded and leaves the ticket number blank, so'
    + ' nothing can be matched on them. Their held options are not here — a booking on hold'
    + ' has no ticket for our books to be missing, and those are counted at the top instead.'
    + ' These are different: the ticket exists and its number was never written down.',
  VOID_AND_ISSUED:
    'Their sheet both issues and voids these, on the same date, so it cannot say which came'
    + ' last. A ticket voided and then issued again under the same number is live and we do'
    + ' not have it; one voided after issue is nothing at all. Four of them carry five'
    + ' figures, which is why they are asked about rather than assumed.',
  REISSUE_NO_CHARGE:
    'Their sheet reissues these and charges nothing for them — the fare was paid on the'
    + ' original ticket and this is the same journey re-documented, usually a change the'
    + ' airline made. No supplier bills them, so our books are right to be without them.'
    + ' Shown in grey because there is nothing to do: a reissue that DOES carry a charge'
    + ' is real money and stays in the list above.',
  CONJUNCT_ALREADY_HELD:
    'One passenger, one fare, two ticket numbers. Their sheet names both coupons; the'
    + ' supplier bills the fare on one of them and the other carries nothing of its own,'
    + ' so our books hold the booking under the sibling and not under this number.'
    + ' Nothing is missing — comparing document numbers made it look that way, and each'
    + ' of these rows was about to be offered for entry at half the fare a second time.',
  VOID_NOT_BILLED:
    'Issued and voided on their side, so no supplier ever billed it. Its absence from our'
    + ' books is correct — listed so nobody goes looking for it.',
  OK: 'The ticket is in both, and the refunds agree.',
};

const Tile: React.FC<{ label: string; value: React.ReactNode; tone?: string }> =
  ({ label, value, tone }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
    <div className={`font-mono font-bold text-lg ${tone ?? 'text-slate-700'}`}>{value}</div>
    <div className="text-[9px] uppercase text-slate-400 font-bold mt-0.5">{label}</div>
  </div>
);

const Group: React.FC<{
  verdict: Verdict; rows: Finding[]; onCopy: (text: string) => void;
}> = ({ verdict, rows, onCopy }) => {
  const tone = TONE[verdict];
  const [open, setOpen] = useState(verdict !== 'OK');
  if (!rows.length) return null;

  /**
   * A finding about refunds shows the refunds.
   *
   * The money columns used to show their COST beside our NET whatever the
   * finding was, which on a refund row put two figures side by side that
   * often agree — 770.00 against 770.00 — under a note claiming a
   * difference of 240.90. The evidence for the finding was the one thing
   * not on the screen.
   */
  const refundRow = verdict === 'REFUND_DIFFERS' || verdict === 'TWICE_ON_THEIR_SHEET'
    || verdict === 'REFUND_NOT_IN_LEDGER' || verdict === 'REFUND_NOT_ON_SHEET';

  return (
    <div className={`bg-white border ${tone.band} rounded-lg overflow-hidden`}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-left">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tone.chip}`}>
          {VERDICT_LABEL[verdict]}
        </span>
        <span className="font-mono text-xs font-bold text-slate-700">{rows.length}</span>
      </button>

      {open && (
        <>
          <p className="px-4 pb-2 text-[11px] text-slate-500 leading-relaxed">{WHY[verdict]}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[960px]">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-100 text-[9px] uppercase
                               tracking-wider text-slate-400">
                  <th className="px-3 py-1.5">Ticket</th>
                  <th className="px-3 py-1.5">PNR</th>
                  <th className="px-3 py-1.5">Issued from</th>
                  <th className="px-3 py-1.5">Request</th>
                  <th className="px-3 py-1.5">Their sheet</th>
                  <th className="px-3 py-1.5 text-right">
                    {refundRow ? 'Their refund' : 'Their cost'}
                  </th>
                  <th className="px-3 py-1.5">Our books</th>
                  <th className="px-3 py-1.5 text-right">
                    {refundRow ? 'Our refund' : 'Our net'}
                  </th>
                  <th className="px-3 py-1.5">What it means</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px]">
                {rows.map(f => (
                  <tr key={`${f.verdict}-${f.serial || f.pnr}-${f.sheet?.rowNo ?? 0}`}
                      className="border-b border-slate-50">
                    {/* The number is the thing that travels: into a message to
                        the team, into a supplier's portal, into the search box
                        of whatever system is being checked against. Typing it
                        off a screen is how a digit gets dropped. */}
                    <td className="px-3 py-1.5 font-bold text-slate-700 whitespace-nowrap">
                      {f.serial ? (
                        <button type="button"
                          onClick={() => onCopy(f.airlineCode ? `${f.airlineCode}-${f.serial}` : f.serial)}
                          title="Copy the ticket number"
                          className="group flex items-center gap-1.5 font-bold text-slate-700
                                     rounded px-1 -mx-1 hover:bg-slate-100 transition-colors">
                          <Copy className="w-3 h-3 text-slate-300 shrink-0
                                           group-hover:text-slate-500" />
                          {f.airlineCode ? `${f.airlineCode}-${f.serial}` : f.serial}
                        </button>
                      ) : <span className="text-slate-300">— none —</span>}
                    </td>
                    {/* The PNR travels as often as the number does: it is
                        what an airline's own site asks for, and what finds a
                        booking again when the ticket number will not. */}
                    <td className="px-3 py-1.5 text-slate-500">
                      {f.pnr ? (
                        <button type="button"
                          onClick={() => onCopy(f.pnr)}
                          title="Copy the PNR"
                          className="group flex items-center gap-1.5 text-slate-500
                                     rounded px-1 -mx-1 hover:bg-slate-100 transition-colors">
                          <Copy className="w-3 h-3 text-slate-300 shrink-0
                                           group-hover:text-slate-500" />
                          {f.pnr}
                        </button>
                      ) : '—'}
                    </td>
                    {/* Where it was bought. The first question anybody asks
                        about a ticket that is missing from our books is where
                        to go and find it, and their sheet has always known. */}
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {f.issuedFrom ? (
                        <span className={f.heldBack ? 'text-amber-700' : 'text-slate-600'}
                              title={f.heldBackWhy || f.portal}>
                          {f.issuedFrom}
                          {f.heldBack && (
                            <span className="text-[9px] font-sans text-amber-600"> · held</span>
                          )}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {f.verdict === 'REQ_DIFFERS' || f.verdict === 'REQ_RELATED' ? (
                        // Both, because which is which IS the finding.
                        <span className="flex items-center gap-1">
                          <span className="text-purple-700 font-bold">{f.reqNum || '— none —'}</span>
                          <ArrowLeftRight className={`w-3 h-3 shrink-0 ${
                            f.verdict === 'REQ_RELATED' ? 'text-sky-400' : 'text-red-400'}`} />
                          <span className={`font-bold ${
                            f.verdict === 'REQ_RELATED' ? 'text-sky-700' : 'text-red-600'}`}>
                            {f.theirReq}
                          </span>
                        </span>
                      ) : f.reqNum ? (
                        <span className="text-purple-700">{f.reqNum}</span>
                      ) : f.theirReq ? (
                        // Nothing of ours to file it under, so the only
                        // request there is theirs — labelled as theirs.
                        <span className="text-slate-500">
                          {f.theirReq}<span className="text-slate-400"> (theirs)</span>
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                      {f.sheet
                        ? <>{f.sheet.rawStatus || '—'}
                            <span className="text-slate-300"> · row {f.sheet.rowNo}</span>
                            {/* Their cell, when the number above is not in
                                it as text. A conjunction is written
                                "176-5513261452-53" and the second document
                                is 5513261453 — correct, and not findable by
                                searching their sheet for it. */}
                            {f.serial && !f.sheet.rawTicket.includes(f.serial) && (
                              <span className="block text-[9px] text-sky-700 font-mono">
                                their cell: {f.sheet.rawTicket.length > 34
                                  ? f.sheet.rawTicket.slice(0, 34) + '…'
                                  : f.sheet.rawTicket}
                              </span>
                            )}</>
                        : <span className="text-slate-300">not on it</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600 whitespace-nowrap">
                      {refundRow ? (
                        f.sheet?.refund != null
                          ? `${money(f.sheet.refund)} ${f.sheet.currency}`.trim()
                          : <span className="text-slate-300">none stated</span>
                      ) : f.sheet?.cost != null ? (
                        <>
                          {`${money(f.sheet.cost)} ${f.sheet.currency}`.trim()}
                          {/* Their cell named several tickets, so the figure
                              beside it is the booking's, not this one's. */}
                          {f.sheet.groupSize > 1 && (
                            <span className="block text-[9px] text-slate-400 font-sans">
                              for {f.sheet.groupSize} tickets
                            </span>
                          )}
                        </>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                      {f.ours.length
                        ? f.ours.map(t => `${t.source} ${t.status || 'ISSUE'}`).join(' · ')
                        : <span className="text-slate-300">nothing</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {f.ours.length ? (() => {
                        const refunds = f.ours.filter(t => (t.amount || 0) < 0);
                        const shown = refundRow
                          ? refunds.reduce((s, t) => s + Math.abs(t.amount || 0), 0)
                          : f.ours.reduce((s, t) => s + (t.amount || 0), 0);
                        if (refundRow && !refunds.length)
                          return <span className="text-slate-300">none</span>;
                        return (
                          <span className={refundRow || refunds.length
                            ? 'text-emerald-600' : 'text-slate-600'}>
                            {money(shown)}{' '}
                            <span className="text-slate-400">{f.ours[0].currency}</span>
                          </span>
                        );
                      })() : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 font-sans max-w-[320px]">
                      {f.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

interface Props {
  tickets: Ticket[];
  /**
   * Send what the check found to the review queue.
   *
   * Absent for a reader, which is why the button is not always there: the
   * screen itself still writes nothing, and this hands the findings to the
   * one place that does. Returns what actually happened, because a second
   * run of the same sheet mostly finds rows somebody has already decided
   * about and saying "0 added" without saying why would look broken.
   */
  onSendToReview?: (findings: Finding[]) =>
    Promise<{ added: number; refreshed: number; settled: number }>;
}

export const TeamSheetCheck: React.FC<Props> = ({ tickets, onSendToReview }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<TeamSheetRow[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /**
   * The request their sheet is for, typed by hand.
   *
   * Their export does not carry it today, and without it the main question
   * - is this ticket in the same file on both sides - cannot be asked at
   *   all. Typing it costs one field and turns the check back on.
   *
   * It is a person's claim rather than a column in their file, so it is
   * labelled as one wherever it shows, and it never overwrites a request
   * their sheet does state.
   *
   * Several may be given, separated by commas, for a sheet covering more
   * than one. That cannot say which row belongs to which, so the filing
   * check narrows to the question it can still answer honestly: is this
   * ticket filed under one of them at all.
   */
  /** What was last put on the clipboard, named rather than merely confirmed:
   *  two tickets a row apart differ by one digit. */
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(''), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async (text: string) => {
    if (await writeClipboard(text)) setCopied(text);
  };

  const [declaredText, setDeclaredText] = useState('');
  /**
   * The stretch of time this copy of their sheet is for.
   *
   * The sheet is taken every few weeks, and without this every check
   * reports the same couple of hundred findings from February and the new
   * ones are lost among them. Both ends are optional: left empty, the
   * check behaves exactly as it did before, floored at their own first
   * ticket.
   */
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const declared = useMemo(
    () => declaredText.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean),
    [declaredText]);

  /* Recomputed rather than re-read: changing the request after the file is
     in must not mean finding the file again. */
  const report = useMemo<TeamSheetReport | null>(
    () => (rows ? compareTeamSheet(rows, tickets, declared, { from: fromDate, to: toDate }) : null),
    [rows, tickets, declared, fromDate, toDate]);

  const run = async (file: File) => {
    setBusy(true); setError(''); setRows(null); setFileName(file.name);
    try {
      const text = await readFileAsText(file);
      const parsed = parseTeamSheet(text);
      if (parsed.problem) { setError(parsed.problem); return; }
      setRows(parsed.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  /** The findings as a sheet, worst first, same order as the screen. */
  /* ── send the missing ones for review ──────────────────────────────────
     Only the two verdicts that describe a ticket our books do not have.
     Everything else the check finds is a disagreement to settle rather than
     a ticket to add, and offering to "add" a misfiled ticket would create a
     second copy of one we already hold. */
  const proposable = useMemo(() => (report?.findings ?? []).filter(f =>
    f.verdict === 'NOT_IN_LEDGER' || f.verdict === 'REFUND_NOT_IN_LEDGER'), [report]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');

  const sendToReview = async () => {
    if (!onSendToReview || sending || !proposable.length) return;
    setSending(true); setSent(''); setError('');
    try {
      const r = await onSendToReview(proposable);
      setSent(
        [r.added && `${r.added} sent for review`,
         r.refreshed && `${r.refreshed} already waiting, updated`,
         r.settled && `${r.settled} already decided, left alone`]
          .filter(Boolean).join(' · ') || 'Nothing to send');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSending(false); }
  };

  const exportReport = async () => {
    if (!report) return;
    const XLSX = await xlsx();
    const ws = XLSX.utils.json_to_sheet(report.findings.map(f => ({
      'Verdict':      VERDICT_LABEL[f.verdict],
      'Ticket':       f.serial ? (f.airlineCode ? `${f.airlineCode}-${f.serial}` : f.serial) : '',
      'PNR':          f.pnr,
      'Issued from':  f.issuedFrom,
      'Their portal': f.portal,
      'Our request':   f.reqNum,
      'Their request': f.theirReq,
      'Their row':    f.sheet?.rowNo ?? '',
      'Their status': f.sheet?.rawStatus ?? '',
      'Their cost':   f.sheet?.cost ?? '',
      'Their refund': f.sheet?.refund ?? '',
      'Currency':     f.sheet?.currency ?? (f.ours[0]?.currency ?? ''),
      'Our rows':     f.ours.length,
      'Our sources':  [...new Set(f.ours.map(t => t.source))].join(', '),
      'Our net':      f.ours.reduce((s, t) => s + (t.amount || 0), 0),
      'Our currency': f.ours[0]?.currency ?? '',
      'Passenger':    f.ours[0]?.passengerName ?? '',
      'What it means': f.note,
    })));
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['THEIR SHEET', fileName],
      ['Requests covered', report.requests.join(', ')],
      ['Request taken from',
        report.reqSource === 'sheet' ? 'their own export'
        : report.reqSource === 'typed' ? `typed by hand: ${report.declared.join(', ')}`
        : 'nowhere — the filing check did not run'],
      ['Requests that agree',
        `${report.byRequest.filter(r => r.agrees).length} of ${report.byRequest.length}`],
      ['Rows on their sheet', report.theirRows],
      ['Tickets on their sheet', report.theirTickets],
      ['Matched to our books', report.matched],
      ['Our rows in scope', report.ourRows],
      ['Checked', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    ], { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Team sheet check');
    XLSX.writeFile(wb, `Team_sheet_check_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const order = (Object.keys(VERDICT_RANK) as Verdict[])
    .sort((a, b) => VERDICT_RANK[a] - VERDICT_RANK[b]);
  const needsWork = report
    ? report.findings.filter(f => TONE[f.verdict].money).length : 0;

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">
            Team sheet check
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Drop the aviation team's ticket export here and it is read against our books,
            request by request: does each request hold the same tickets on both sides, is
            any ticket filed under a different request here than there, and what is on one
            list and not the other. Nothing is imported and nothing is changed — this only
            reports.
          </p>
        </div>
        {report && (
          <div className="flex items-center gap-2 shrink-0">
            {onSendToReview && proposable.length > 0 && (
              <button onClick={sendToReview} disabled={sending}
                title={`${proposable.length} ticket(s) on their sheet and in nobody's books`}
                className="flex items-center gap-1.5 bg-emerald-600 text-white text-[11px]
                           font-bold px-3 py-1.5 rounded hover:bg-emerald-700
                           disabled:opacity-50">
                {sending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <ClipboardCheck className="w-3.5 h-3.5" />}
                Send {proposable.length} for review
              </button>
            )}
            <button onClick={exportReport}
              className="flex items-center gap-1.5 bg-purple-600 text-white text-[11px] font-bold
                         px-3 py-1.5 rounded hover:bg-purple-700">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
        )}
      </div>

      {sent && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5
                        text-[11px] text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>
            {sent}. Nothing has been recorded yet — they are waiting on{' '}
            <b>To review</b>, where each one is priced and confirmed one at a time.
          </span>
        </div>
      )}

      {/* Before the drop zone, because it is meant to be filled in first. */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
        <label className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider shrink-0">
            Request number
          </span>
          <input
            value={declaredText}
            onChange={e => setDeclaredText(e.target.value.toUpperCase())}
            placeholder="KSAML2053"
            className="font-mono text-xs px-2.5 py-1.5 border border-slate-200 rounded w-56
                       focus:outline-none focus:ring-2 focus:ring-purple-500/20
                       focus:border-purple-400" />
          <span className="text-[11px] text-slate-500">
            Which request their sheet is for. Their export does not carry it, so typing it
            here turns the filing check on. Several, separated by commas, for a sheet
            covering more than one.
          </span>
        </label>

        {/* The period. Second, because a sheet for one request usually needs
            no dates and a periodic copy of the whole sheet usually needs no
            request - whichever you are doing, one of these two rows is the
            one you fill in. */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider shrink-0">
            Period
          </span>
          <div className="flex items-center gap-2">
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="font-mono text-xs px-2.5 py-1.5 border border-slate-200 rounded
                         focus:outline-none focus:ring-2 focus:ring-purple-500/20
                         focus:border-purple-400" />
            <span className="text-[11px] text-slate-400">to</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="font-mono text-xs px-2.5 py-1.5 border border-slate-200 rounded
                         focus:outline-none focus:ring-2 focus:ring-purple-500/20
                         focus:border-purple-400" />
            {(fromDate || toDate) && (
              <button onClick={() => { setFromDate(''); setToDate(''); }}
                className="text-[11px] text-slate-400 hover:text-slate-700 px-1">clear</button>
            )}
          </div>
          <span className="text-[11px] text-slate-500 flex-1 min-w-[280px]">
            What this copy of their sheet covers. Their rows outside it are set aside, and
            nothing of ours outside it is reported as missing.{' '}
            <b className="text-slate-600">Your books are searched in full whatever you put
            here</b> — their date is when a ticket was issued and ours is when the supplier
            billed it, and those cross a month end.
          </span>
        </div>
      </div>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) run(f); }}
        onClick={() => input.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-lg px-6 py-8 text-center
                   cursor-pointer hover:border-purple-400 hover:bg-purple-50/30 transition">
        <input ref={input} type="file" accept=".csv,.txt,.xls,.xlsx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
        {busy ? (
          <span className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Reading {fileName}…
          </span>
        ) : (
          <>
            <Upload className="w-6 h-6 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-500">
              Drop their CSV or Excel export here, or click to choose one
            </p>
            {fileName && !busy && (
              <p className="text-[10px] text-slate-400 mt-1 font-mono">{fileName}</p>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-2.5">
          <X className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <span className="text-xs text-red-800">{error}</span>
        </div>
      )}

      {report && (
        <>
          {report.clean ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3
                            flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <span className="text-xs text-emerald-900">
                <b>Both lists agree.</b> Every ticket on their sheet is in our books with the
                same refunds, and our books hold nothing under these requests that their
                sheet does not show. This sheet can be closed.
              </span>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3
                            flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <span className="text-xs text-amber-900">
                <b>{needsWork} {needsWork === 1 ? 'thing needs' : 'things need'} settling
                before this sheet is closed.</b>{' '}
                They are listed worst first below. Anything marked in grey is a state of the
                world rather than a disagreement.
              </span>
            </div>
          )}

          {/* Said plainly rather than hidden: without their request column the
              screen cannot answer the question it exists to answer. */}
          {report.reqSource === 'none' && (
            <div className="bg-slate-100 border border-slate-300 rounded-lg px-4 py-3
                            flex items-start gap-2.5">
              <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-700 leading-relaxed">
                <b>No request number, so the filing check did not run.</b> The tickets still
                match, and what is missing on each side is real — but whether a ticket sits
                under the same request on both sides cannot be asked. Type the request in
                the field above, or export their sheet again with a column named Req, Req
                Num, Request or Request Number.
              </span>
            </div>
          )}

          {/* A typed request is a person's claim, never presented as though
              their file had said it. */}
          {report.reqSource === 'typed' && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3
                            flex items-start gap-2.5">
              <Info className="w-4 h-4 text-sky-600 mt-0.5 shrink-0" />
              <span className="text-xs text-sky-900 leading-relaxed">
                {report.declared.length === 1 ? (
                  <>Read as request <b className="font-mono">{report.declared[0]}</b> —
                  from what you typed, not from their file. Every row on their sheet is
                  being treated as belonging to it.</>
                ) : (
                  <>Read as covering <b className="font-mono">{report.declared.join(', ')}</b> —
                  from what you typed, not from their file. With more than one, nothing says
                  which row belongs to which, so a ticket is only questioned when it is
                  filed under none of them.</>
                )}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <Tile label="Rows on their sheet" value={report.theirRows} />
            <Tile label="Tickets on it" value={report.theirTickets} />
            <Tile label="Matched to ours" value={report.matched}
              tone={report.matched === report.theirTickets ? 'text-emerald-600' : 'text-slate-700'} />
            <Tile label="Our rows in scope" value={report.ourRows} />
            <Tile label="Needs settling" value={needsWork}
              tone={needsWork ? 'text-red-600' : 'text-emerald-600'} />
          </div>

          {/* Their sheet has a beginning, and our ledger is older than it.
              Said out loud, because the count is also the honest measure
              of how much of our books this check can speak to. */}
          {(report.beforeTheirSystem > 0 || report.onHold > 0
            || report.theirOutsidePeriod > 0) && (
            <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50
                            border border-slate-200 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
              <span>
                {report.onHold > 0 && (
                  <><b>{report.onHold}</b> of their rows are options still on hold, with no
                  ticket issued — nothing for our books to be missing, so they are left out.
                  {' '}</>
                )}
                {/* A period somebody typed and a floor taken from their own
                    sheet are different claims and are never worded alike. */}
                {report.periodFromSource === 'typed' || report.periodToSource === 'typed' ? (
                  <>
                    This sheet was read as{' '}
                    <b className="font-mono text-slate-700">
                      {report.period.from || 'the beginning'}
                    </b>{' '}to{' '}
                    <b className="font-mono text-slate-700">
                      {report.period.to || 'today'}
                    </b>.
                    {report.theirOutsidePeriod > 0 && (
                      <> <b>{report.theirOutsidePeriod}</b> of their rows fall outside it and
                      were set aside.</>
                    )}
                    {report.beforeTheirSystem > 0 && (
                      <> <b>{report.beforeTheirSystem}</b> of ours do too, so they are not
                      reported as missing from a sheet that does not cover them.</>
                    )}
                    {' '}Your books were searched in full whatever their date.
                  </>
                ) : (
                  <>
                    Their sheet begins{' '}
                    <b className="font-mono text-slate-700">{report.sheetFrom}</b>.
                    {' '}<b>{report.beforeTheirSystem}</b> of our tickets under these requests
                    were issued before that, so they are outside this comparison rather than
                    missing from it — there was no sheet for them to be on.
                  </>
                )}
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50
                          border border-slate-200 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
            <span>
              Checked against{' '}
              <b className="font-mono text-slate-700">
                {report.requests.length ? report.requests.join(', ') : 'no request'}
              </b>
              {' '}— the requests their matched tickets belong to. Costs are shown but never
              compared: their net and ours are recorded at different moments and often in another
              currency, so a difference there is not a finding.
            </span>
          </div>

          {/* Request by request: the row a sheet is actually closed on. */}
          {report.byRequest.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center
                              justify-between text-[9px] font-bold uppercase text-slate-500">
                <span>Request by request</span>
                <span className={report.byRequest.every(r => r.agrees)
                  ? 'text-emerald-600' : 'text-red-600'}>
                  {report.byRequest.filter(r => r.agrees).length} of {report.byRequest.length} agree
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[620px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-[9px] uppercase
                                   tracking-wider text-slate-400">
                      <th className="px-3 py-1.5">Request</th>
                      <th className="px-3 py-1.5 text-right">On their sheet</th>
                      <th className="px-3 py-1.5 text-right">In our books</th>
                      <th className="px-3 py-1.5 text-right">Only theirs</th>
                      <th className="px-3 py-1.5 text-right">Only ours</th>
                      <th className="px-3 py-1.5 text-right">Misfiled</th>
                      <th className="px-3 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {report.byRequest.map(r => (
                      <tr key={r.reqNum}
                          className={`border-b border-slate-50 ${r.agrees ? '' : 'bg-red-50/40'}`}>
                        <td className="px-3 py-1.5 font-bold text-purple-700 whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <FolderOpen className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                            {r.reqNum}
                            {/* A request whose other half is elsewhere. Without
                                this, its count reads as short. */}
                            {r.related.length > 0 && (
                              <span className="text-[9px] font-sans font-bold text-sky-700
                                               bg-sky-50 border border-sky-200 rounded px-1 py-0.5"
                                title="Recorded in the ledger as one piece of work with these">
                                with {r.related.join(', ')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{r.theirTickets}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{r.ourTickets}</td>
                        <td className={`px-3 py-1.5 text-right font-bold
                          ${r.onlyTheirs ? 'text-red-600' : 'text-slate-300'}`}>
                          {r.onlyTheirs || '—'}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-bold
                          ${r.onlyOurs ? 'text-amber-600' : 'text-slate-300'}`}>
                          {r.onlyOurs || '—'}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-bold
                          ${r.misfiled ? 'text-red-600' : 'text-slate-300'}`}>
                          {r.misfiled || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {r.agrees
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-red-500 inline" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {order.map(v => (
              <Group key={v} verdict={v} onCopy={copy}
                rows={report.findings.filter(f => f.verdict === v)} />
            ))}
          </div>
        </>
      )}

      {!report && !busy && !error && (
        <p className="text-[11px] text-slate-400 italic flex items-center gap-1.5">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Their export needs a ticket number column, and should carry the request number —
          that is what the comparison is built on. PNR, status and refund are used when
          they are there.
        </p>
      )}
    </div>
  );
};

export default TeamSheetCheck;
