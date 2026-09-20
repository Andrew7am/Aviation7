import React, { useState, useRef } from 'react';
import { Ticket } from '../types';
import {
  Upload, AlertTriangle, CheckCircle2, X, Loader2, FileSpreadsheet, Download,
  ChevronDown, ChevronRight, Info, ArrowLeftRight, FolderOpen,
} from 'lucide-react';
import { readFileAsText } from '../core/ImportEngine';
import { parseTeamSheet } from '../core/parsers/teamSheet';
import {
  compareTeamSheet, TeamSheetReport, Finding, Verdict, VERDICT_LABEL, VERDICT_RANK,
} from '../core/helpers/teamSheetCompare';

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
  NOT_ISSUED_YET:       { chip: 'bg-slate-100 text-slate-500',    band: 'border-slate-200',   money: false },
  VOID_NOT_BILLED:      { chip: 'bg-slate-100 text-slate-500',    band: 'border-slate-200',   money: false },
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
    'Both sides refunded, for different amounts. One of the two figures is wrong, and the'
    + ' difference is the amount at stake.',
  NOT_ISSUED_YET:
    'Their rows with no ticket number — still on hold. Nothing to compare until a ticket'
    + ' is issued.',
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

const Group: React.FC<{ verdict: Verdict; rows: Finding[] }> = ({ verdict, rows }) => {
  const tone = TONE[verdict];
  const [open, setOpen] = useState(verdict !== 'OK');
  if (!rows.length) return null;

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
            <table className="w-full text-left min-w-[860px]">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-100 text-[9px] uppercase
                               tracking-wider text-slate-400">
                  <th className="px-3 py-1.5">Ticket</th>
                  <th className="px-3 py-1.5">PNR</th>
                  <th className="px-3 py-1.5">Request <span className="normal-case">(ours → theirs)</span></th>
                  <th className="px-3 py-1.5">Their sheet</th>
                  <th className="px-3 py-1.5 text-right">Their cost</th>
                  <th className="px-3 py-1.5">Our books</th>
                  <th className="px-3 py-1.5 text-right">Our net</th>
                  <th className="px-3 py-1.5">What it means</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px]">
                {rows.map(f => (
                  <tr key={`${f.verdict}-${f.serial || f.pnr}-${f.sheet?.rowNo ?? 0}`}
                      className="border-b border-slate-50">
                    <td className="px-3 py-1.5 font-bold text-slate-700 whitespace-nowrap">
                      {f.serial
                        ? (f.airlineCode ? `${f.airlineCode}-${f.serial}` : f.serial)
                        : <span className="text-slate-300">— none —</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{f.pnr || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {f.verdict === 'REQ_DIFFERS' ? (
                        // Both, because which is which IS the finding.
                        <span className="flex items-center gap-1">
                          <span className="text-purple-700 font-bold">{f.reqNum || '— none —'}</span>
                          <ArrowLeftRight className="w-3 h-3 text-red-400 shrink-0" />
                          <span className="text-red-600 font-bold">{f.theirReq}</span>
                        </span>
                      ) : (
                        <span className="text-purple-700">{f.reqNum || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                      {f.sheet
                        ? <>{f.sheet.rawStatus || '—'}
                            <span className="text-slate-300"> · row {f.sheet.rowNo}</span></>
                        : <span className="text-slate-300">not on it</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600 whitespace-nowrap">
                      {f.sheet?.cost != null
                        ? `${money(f.sheet.cost)} ${f.sheet.currency}`.trim()
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                      {f.ours.length
                        ? f.ours.map(t => `${t.source} ${t.status || 'ISSUE'}`).join(' · ')
                        : <span className="text-slate-300">nothing</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {f.ours.length ? (
                        <span className={f.ours.some(t => (t.amount || 0) < 0)
                          ? 'text-emerald-600' : 'text-slate-600'}>
                          {money(f.ours.reduce((s, t) => s + (t.amount || 0), 0))}{' '}
                          <span className="text-slate-400">{f.ours[0].currency}</span>
                        </span>
                      ) : <span className="text-slate-300">—</span>}
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

export const TeamSheetCheck: React.FC<{ tickets: Ticket[] }> = ({ tickets }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<TeamSheetReport | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = async (file: File) => {
    setBusy(true); setError(''); setReport(null); setFileName(file.name);
    try {
      const text = await readFileAsText(file);
      const parsed = parseTeamSheet(text);
      if (parsed.problem) { setError(parsed.problem); return; }
      setReport(compareTeamSheet(parsed.rows, tickets));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  /** The findings as a sheet, worst first, same order as the screen. */
  const exportReport = async () => {
    if (!report) return;
    const XLSX = await xlsx();
    const ws = XLSX.utils.json_to_sheet(report.findings.map(f => ({
      'Verdict':      VERDICT_LABEL[f.verdict],
      'Ticket':       f.serial ? (f.airlineCode ? `${f.airlineCode}-${f.serial}` : f.serial) : '',
      'PNR':          f.pnr,
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
      ['Their sheet named its requests', report.sheetHasReq ? 'yes' : 'NO'],
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
          <button onClick={exportReport}
            className="flex items-center gap-1.5 bg-purple-600 text-white text-[11px] font-bold
                       px-3 py-1.5 rounded hover:bg-purple-700 shrink-0">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        )}
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
          {!report.sheetHasReq && (
            <div className="bg-slate-100 border border-slate-300 rounded-lg px-4 py-3
                            flex items-start gap-2.5">
              <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-700 leading-relaxed">
                <b>Their export carries no request number.</b> The tickets still match, so
                what is missing on each side is real — but the main question, whether a
                ticket sits under the same request on both sides, cannot be asked at all.
                Export their sheet again with the request column in it and every check below
                gets sharper. Any column named Req, Req Num, Request or Request Number is
                read.
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

          <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50
                          border border-slate-200 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
            <span>
              Checked against{' '}
              <b className="font-mono text-slate-700">
                {report.requests.length ? report.requests.join(', ') : 'no request'}
              </b>
              {' '}— the requests their matched tickets belong to. Costs are shown but never
              compared: their figure carries their markup and is often quoted in another
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
              <Group key={v} verdict={v}
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
