import React, { useState, useRef, useMemo, useEffect } from 'react';
import { invoiceNumbersFromStatement, confirmationsFromStatement, type InvoiceNoFill, type InvoiceNoConflict } from '../core/helpers/statementInvoiceNos';
import type { Confirmation } from '../core/helpers/supplierProof';
import { Ticket, VendorStatement, BalanceTopUp, VendorBalance } from '../types';
import {
  Upload, FileCheck2, AlertTriangle, CheckCircle2, X, Loader2, ChevronDown, ChevronRight,
  Save, Receipt,
} from 'lucide-react';
import { parseIbtekarInvoicePdf } from '../core/parsers/ibtekarInvoicePdf';
import {
  parseIbtekarStatementPdf, documentKind, ParsedStatement,
} from '../core/parsers/ibtekarStatementPdf';
import { reconcileAll, InvoiceResult, LineVerdict } from '../core/helpers/invoiceReconcile';
import { pdfContent } from '../core/helpers/pdfWords';
import { reviewStatement, Reprice, StatementReview } from '../core/helpers/statementAgainstBooks';
import { shortDay } from '../core/helpers/statementReasons';

/** Tickets a statement stopped billing, and why, to the Voids register. */
export type VoidDropped = (tickets: Ticket[], why: string, from?: string) => Promise<void>;
/**
 * Check a document the vendor sent against the ledger, without importing it.
 *
 * Ibtekar sends two kinds and they have to be told apart before either is
 * read. An invoice bills a list of tickets; a statement of account summarises
 * a period and carries the invoice NUMBERS in its Document column. Run a
 * statement through the invoice reader and it finds eleven invoice numbers,
 * no ticket blocks beneath any of them, and reports eleven empty invoices —
 * which is exactly what it did the first time one was dropped on it.
 *
 * Nothing here writes on its own. A document is a claim, and the useful
 * question about a claim is where it and the ledger disagree. A statement can
 * be saved to the period list from here, because that is transcription rather
 * than judgement and doing it by hand off a PDF is how digits get transposed.
 */
const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const VERDICT: Record<LineVerdict, { label: string; cls: string }> = {
  MATCHED:   { label: 'In the ledger',   cls: 'bg-emerald-50 text-emerald-700' },
  MISSING:   { label: 'Not recorded',    cls: 'bg-red-100 text-red-700' },
  ZERO_LINE: { label: 'Billed at zero',  cls: 'bg-slate-100 text-slate-500' },
  ELSEWHERE: { label: 'Other invoice',   cls: 'bg-amber-100 text-amber-700' },
};

const InvoicePanel: React.FC<{ r: InvoiceResult }> = ({ r }) => {
  const [open, setOpen] = useState(!r.agrees);
  const inv = r.invoice;
  const missing = r.lines.filter(l => l.verdict === 'MISSING');
  const elsewhere = r.lines.filter(l => l.verdict === 'ELSEWHERE');
  const zero = r.lines.filter(l => l.verdict === 'ZERO_LINE');

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="font-mono font-bold text-xs text-slate-700">{inv.invoice}</span>
        <span className="text-mini text-slate-400 font-mono">{inv.invoiceDate}</span>
        {!inv.taxInvoice && (
          <span className="bg-slate-100 text-slate-500 text-micro font-bold px-1.5 py-0.5 rounded-full">
            NOT HEADED TAX INVOICE
          </span>
        )}
        <span className="text-mini text-slate-400">{inv.lines.length} line(s)</span>
        <span className="ml-auto flex items-center gap-4">
          <span className="text-right">
            <span className="block text-micro uppercase text-slate-400 font-bold">Invoice</span>
            <span className="font-mono text-xs text-slate-700">
              {inv.total === null ? '—' : fmt(inv.total)}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-micro uppercase text-slate-400 font-bold">Ledger</span>
            <span className="font-mono text-xs text-slate-700">{fmt(r.ledgerTotal)}</span>
          </span>
          <span className="text-right w-28">
            <span className="block text-micro uppercase text-slate-400 font-bold">Difference</span>
            <span className={`font-mono text-xs font-bold ${
              inv.total === null ? 'text-slate-400' : r.agrees ? 'text-emerald-600' : 'text-red-600'}`}>
              {inv.total === null ? 'unread'
                : r.agrees ? 'none'
                : `${r.difference > 0 ? '+' : '−'}${fmt(r.difference)}`}
            </span>
          </span>
          {inv.total !== null && r.agrees
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            : <AlertTriangle className="w-4 h-4 text-red-500" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50">
          {!r.foots.lines && (
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
              {inv.lines.length === 0 && inv.subTotal === null ? (
                <>Nothing was read under this number — no ticket lines and no totals. It is a
                  document number mentioned on the page rather than an invoice printed on it, so
                  there is nothing here to compare.</>
              ) : (
                <>The lines read off this invoice come to {fmt(r.foots.lineSum)}, and it prints a net
                  of {inv.subTotal === null ? 'nothing' : fmt(inv.subTotal)}. Part of it has not been
                  read correctly, so treat what follows with care.</>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
            {[
              ['In the ledger', r.lines.length - missing.length - elsewhere.length - zero.length, 'text-emerald-600'],
              ['Not recorded',  missing.length,   'text-red-600'],
              ['Other invoice', elsewhere.length, 'text-amber-600'],
              ['Billed at zero', zero.length,     'text-slate-400'],
            ].map(([label, n, cls]) => (
              <div key={label as string} className="bg-white border border-slate-200 rounded px-2 py-2">
                <div className={`font-mono font-bold text-sm ${cls}`}>{n as number}</div>
                <div className="text-micro uppercase text-slate-400 font-bold">{label as string}</div>
              </div>
            ))}
          </div>

          {inv.subTotal !== null && inv.vat !== null && (
            <p className="text-mini text-slate-500 font-mono">
              net {fmt(inv.subTotal)} + VAT {fmt(inv.vat)} = {fmt(inv.total ?? 0)}
              {inv.subTotal > 0 && (
                <span className="text-slate-400">
                  {'  '}({((inv.vat / inv.subTotal) * 100).toFixed(2)}% — under 15% means a zero-rated
                  international sector on this invoice)
                </span>
              )}
            </p>
          )}

          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left min-w-[720px]">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-100 text-micro uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2">Ticket</th>
                    <th className="px-3 py-2">Passenger</th>
                    <th className="px-3 py-2">Sector</th>
                    <th className="px-3 py-2">PNR</th>
                    <th className="px-3 py-2 text-right">Net billed</th>
                    <th className="px-3 py-2 text-right">Ledger</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 text-xs">
                      <td className="px-3 py-1.5 font-mono text-mini text-slate-700">
                        {l.line.airline}-{l.line.ticketNo}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{l.line.passenger}</td>
                      <td className="px-3 py-1.5 text-slate-500 text-mini">{l.line.sector}</td>
                      <td className="px-3 py-1.5 font-mono text-mini text-slate-500">{l.line.pnr}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                        {l.line.amount === null ? '—' : fmt(l.line.amount)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                        {l.ticket ? fmt(l.ticket.amount ?? 0) : '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-micro font-bold px-1.5 py-0.5 rounded-full ${VERDICT[l.verdict].cls}`}>
                          {VERDICT[l.verdict].label}
                          {l.heldUnder ? `: ${l.heldUnder}` : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {r.notOnInvoice.length > 0 && (
            <div className="bg-white border border-amber-200 rounded px-3 py-2 text-xs text-slate-600">
              <b className="text-amber-700">{r.notOnInvoice.length} row(s)</b> are filed under{' '}
              {inv.invoice} in the ledger but are not on this invoice:{' '}
              <span className="font-mono text-mini">
                {r.notOnInvoice.map(t => t.ticketNo).join(', ')}
              </span>
            </div>
          )}

          {r.refunds.length > 0 && (
            <div className="bg-white border border-slate-200 rounded px-3 py-2 text-xs text-slate-600">
              {r.refunds.length} refund(s) exist against tickets on this invoice, worth{' '}
              <span className="font-mono">{fmt(r.refunds.reduce((n, t) => n + (t.amount ?? 0), 0))}</span>.
              They are credited on a separate document, so they are not counted against this total.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** A balance the way the vendor prints it: Cr in our favour, Dr against. */
const drCr = (n: number) => `${fmt(n)} ${n < 0 ? 'Dr' : 'Cr'}`;
/** The same in words. */
const balanceWords = (n: number) => n < 0 ? 'we owe them' : 'our credit';

/**
 * The statement against our books, for somebody who only wants to know: is
 * there a difference, why, and what do I do. The answer first, then each
 * reason with its amount and its next step, adding up to the difference.
 */
const ReviewPanel: React.FC<{
  r: StatementReview; st: ParsedStatement; onReprice?: (list: Reprice[]) => Promise<void>;
  onVoidDropped?: VoidDropped;
}> = ({ r, st, onReprice, onVoidDropped }) => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [voided, setVoided] = useState<number | null>(null);
  const [voidError, setVoidError] = useState('');
  // A ticket of ours they never billed, once it is known to be void.
  const moveToVoids = async (t: Ticket) => {
    if (!onVoidDropped) return;
    const name = t.passengerName ? `, ${t.passengerName}` : '';
    if (!confirm(`Move ${t.ticketNo} (${fmt(t.amount)} ${st.currency}${name}) to Voids?\n\n`
      + `Do this only if you know it was voided: it may still be on ${r.vendor}'s next statement. Its sale leaves the ledger.`)) return;
    setBusy(true); setVoidError('');
    try {
      await onVoidDropped([t], `Voided with ${r.vendor}: not on their ${st.periodStart} to ${st.periodEnd} statement.`
        + ' Moved to Voids; its sale left the ledger.', 'Not on statement');
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : 'The ticket could not be moved.');
    } finally { setBusy(false); }
  };
  const agrees = Math.abs(r.closingGap) < 0.05;
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(n)}`;
  const toDo = r.reasons.filter(x => !x.harmless);
  const matched = r.lines.filter(c => c.verdict === 'AGREES').length;

  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-4 py-3 ${agrees
        ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : toDo.length
        ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-bold flex items-center gap-1.5">
            {agrees ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {agrees ? 'The balance matches'
              : toDo.length || Math.abs(r.unexplained) >= 0.05 ? 'The balance does not match' : 'Nothing is missing'}
          </span>
          {!agrees && <span className="text-sm font-bold font-mono">{fmt(r.closingGap)} {st.currency}</span>}
        </div>
        {!agrees && (
          <p className="mt-1 text-xs">
            {r.vendor}'s balance is <b className="font-mono">{fmt(r.closingGap)}</b> {r.closingGap > 0 ? 'higher' : 'lower'} than ours.
            {!toDo.length && Math.abs(r.unexplained) < 0.05 && ' The reasons below explain all of it.'}
          </p>
        )}
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
          <span>{r.vendor}, {shortDay(st.periodEnd)}: <b className="font-mono">{fmt(st.closingBalance)}</b> {balanceWords(st.closingBalance)}</span>
          <span>Our books, {shortDay(st.periodEnd)}: <b className="font-mono">{fmt(r.ourClosing)}</b> {balanceWords(r.ourClosing)}</span>
        </div>
      </div>

      {r.reasons.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-600">
            {agrees ? 'Small things to know' : 'Why'}
            {r.reasons.length > 1 && <span className="ml-2 font-normal text-slate-500">+ makes their balance higher than ours, − makes it lower</span>}
          </div>
          <ol className="divide-y divide-slate-100">
            {r.reasons.map((x, i) => (
              <li key={x.kind} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-bold text-slate-700">{i + 1}. {x.title}{x.items.length > 1 ? ` (${x.items.length})` : ''}</span>
                  <span className={`font-mono font-bold whitespace-nowrap ${x.harmless ? 'text-slate-500' : 'text-red-600'}`}>
                    {signed(x.amount) || '0.00'}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {x.items.map((it, j) => (
                    <li key={j} className="flex items-baseline justify-between gap-3 text-slate-600">
                      <span className="min-w-0"><span className="font-mono text-slate-800">{it.ref}</span> — {it.text}</span>
                      <span className="flex items-baseline gap-3 shrink-0">
                        {x.items.length > 1 && <span className="font-mono whitespace-nowrap text-slate-500">{signed(it.amount)}</span>}
                        {it.voidable && onVoidDropped && (
                          <button type="button" disabled={busy} onClick={() => void moveToVoids(it.voidable!)}
                            aria-label={`Move ${it.ref} to Voids`}
                            className="px-2 py-1 rounded border border-red-200 text-red-700 font-bold whitespace-nowrap hover:bg-red-50 disabled:opacity-40">
                            Move to Voids</button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={`mt-1.5 ${x.harmless ? 'text-slate-500' : 'text-blue-700'}`}>
                  {x.harmless ? '' : 'What to do: '}{x.todo}
                </div>
                {voidError && x.kind === 'TICKET_NOT_THEIRS' && (
                  <div role="alert" className="mt-1 text-red-600">{voidError}</div>
                )}
              </li>
            ))}
            {Math.abs(r.unexplained) >= 0.05 && (
              <li className="px-4 py-3 text-xs flex items-start justify-between gap-3">
                <span className="font-bold text-red-700">Not explained yet</span>
                <span className="font-mono font-bold text-red-600">{signed(r.unexplained)}</span>
              </li>
            )}
            {!agrees && (
              <li className="px-4 py-2 bg-slate-50 text-xs flex items-center justify-between gap-3 font-bold text-slate-700">
                <span>Total difference</span><span className="font-mono">{signed(r.closingGap)} {st.currency}</span>
              </li>
            )}
          </ol>
        </div>
      )}

      <ul className="text-xs text-slate-500 px-1 space-y-1">
        <li>{matched} of {r.lines.length} ticket lines match our books
          {r.receipts.length > 0 && <>; {r.receipts.filter(x => x.recorded).length} of {r.receipts.length} payments are entered</>}.</li>
        {r.fees.count > 0 && (
          <li>Service fee: {r.fees.count} ticket(s), {r.fees.min === r.fees.max ? fmt(r.fees.min)
            : `${fmt(r.fees.min)} to ${fmt(r.fees.max)}`} each above the fare, {fmt(r.fees.total)} {st.currency} in all.
            It is already in our prices.</li>
        )}
        {r.since && Math.abs(r.since.change) < 0.005 && <li>Nothing changed on their side since their last statement.</li>}
        {r.since && r.since.late.length > 0 && (
          <li>Their last statement ({shortDay(r.since.previous.periodStart)} to {shortDay(r.since.previous.periodEnd)}) was printed
            before these {r.since.late.length} ticket(s) were added: {r.since.late.map(l => l.ticketNo).join(', ')}. They are on this
            one. Nothing else changed.</li>
        )}
      </ul>

      {r.since && Math.abs(r.since.change) >= 0.005 && r.since.late.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <b>{r.vendor} changed an old balance.</b> For {shortDay(r.since.on)} their last statement said{' '}
          <b className="font-mono">{fmt(r.since.was)}</b> {balanceWords(r.since.was)}; this one says <b className="font-mono">{fmt(r.since.now)}</b> {balanceWords(r.since.now)}{' '}
          (<b className="font-mono">{signed(r.since.change)}</b>, {r.since.change > 0 ? 'in our favour' : 'against us'}).{' '}
          {agrees ? 'Our books already match the new one.' : 'Ask them what they changed.'}
        </div>
      )}

      {(r.reprice.length > 0 || r.dropped) && (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
          {r.reprice.length > 0 && (
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <b className="text-slate-700">Put the statement's price on these tickets</b>
                {onReprice && (
                  <button disabled={busy || done != null}
                    onClick={async () => {
                      setBusy(true);
                      try { await onReprice(r.reprice); setDone(r.reprice.length); } finally { setBusy(false); }
                    }}
                    className={`text-xs font-bold px-3 py-1.5 rounded ${done != null
                      ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-700 text-white hover:bg-blue-800'}`}>
                    {done != null ? `${done} corrected` : busy ? 'Correcting…' : `Correct ${r.reprice.length} ticket(s)`}
                  </button>
                )}
              </div>
              {r.reprice.map(x => (
                <div key={x.id} className="font-mono text-xs text-slate-600 flex gap-3 flex-wrap">
                  <span className="text-slate-800">{x.ticketNo}</span>
                  <span>{fmt(x.was)} → <b>{fmt(x.amount)}</b></span>
                  <span className={x.amount > x.was ? 'text-red-600' : 'text-emerald-600'}>{signed(x.amount - x.was)}</span>
                </div>
              ))}
            </div>
          )}
          {r.dropped && (
            <div className="px-4 py-3 space-y-2 bg-red-50/40">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <b className="text-red-700">Cancelled on their side — move to Voids</b>
                {onVoidDropped && (
                  <button disabled={busy || voided != null}
                    onClick={async () => {
                      const d = r.dropped!;
                      if (!confirm(`Move ${d.tickets.length} ticket(s), ${fmt(d.total)} ${st.currency}, to Voids? Their sale leaves the ledger.`)) return;
                      setBusy(true);
                      try {
                        await onVoidDropped(d.tickets, `Voided with ${r.vendor}: billed on their ${d.previous.periodStart} to ${d.previous.periodEnd}`
                          + ` statement, gone from the ${st.periodStart} to ${st.periodEnd} one, which puts ${d.previous.periodEnd}`
                          + ` ${fmt(d.total)} higher (${drCr(d.was)} then, ${drCr(d.now)} now). Moved to Voids; its sale left the ledger.`);
                        setVoided(d.tickets.length);
                      } finally { setBusy(false); }
                    }}
                    className={`text-xs font-bold px-3 py-1.5 rounded ${voided != null
                      ? 'bg-emerald-50 text-emerald-700' : 'bg-red-600 text-white hover:bg-red-700'}`}>
                    {voided != null ? `${voided} moved to Voids` : busy ? 'Moving…' : `Move ${r.dropped.tickets.length} to Voids`}
                  </button>
                )}
              </div>
              <div className="text-xs text-slate-600">
                They were on the last statement ({shortDay(r.dropped.previous.periodStart)} to {shortDay(r.dropped.previous.periodEnd)}) and
                are not on this one, and the balance went up by exactly their price: <b className="font-mono">{fmt(r.dropped.total)}</b>.
              </div>
              {r.dropped.tickets.map(t => (
                <div key={t.id} className="font-mono text-xs text-slate-600">
                  {t.date} {t.ticketNo} {fmt(t.amount)} {t.reqNum} {t.pnr}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const StatementPanel: React.FC<{
  st: ParsedStatement;
  fileName: string;
  tickets: Ticket[];
  vendorName: string;
  saved: boolean;
  onSave?: () => void;
  topUps: BalanceTopUp[];
  statements: VendorStatement[];
  wallet?: VendorBalance;
  onReprice?: (list: Reprice[]) => Promise<void>;
  onVoidDropped?: VoidDropped;
}> = ({ st, fileName, tickets, vendorName, saved, onSave, topUps, statements, wallet, onReprice, onVoidDropped }) => {
  const [open, setOpen] = useState(false);
  // Line by line against our books: what agrees, what the statement settles,
  // what it changed since their last one, and the ten riyals on each ticket.
  const review = useMemo(() => reviewStatement(st, vendorName, tickets, topUps, statements,
    wallet && { initialBalance: wallet.initialBalance, openingDate: wallet.openingDate }),
    [st, vendorName, tickets, topUps, statements, wallet]);
  const byTicket = useMemo(() => new Map(review.lines.map(c => [c.line.ticketNo, c])), [review]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Receipt className="w-3.5 h-3.5 text-purple-600" />
        <b className="text-slate-700">{fileName}</b>
        <span className="bg-purple-50 text-purple-700 text-micro font-bold px-2 py-0.5 rounded-full">
          STATEMENT OF ACCOUNT
        </span>
        <span className="font-mono text-xs text-slate-500">
          {st.periodStart} → {st.periodEnd}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {([
          [`Opening — ${balanceWords(st.openingBalance)}`, fmt(st.openingBalance), st.openingBalance < 0 ? 'text-red-600' : 'text-slate-600'],
          ['Payments and refunds', st.paid ? `+${fmt(st.paid)}` : '—', 'text-emerald-600'],
          ['Tickets', `−${fmt(st.billed)}`, 'text-slate-700'],
          [`Closing — ${balanceWords(st.closingBalance)}`, fmt(st.closingBalance), st.closingBalance < 0 ? 'text-red-600' : 'text-emerald-700'],
        ] as const).map(([label, value, cls]) => (
          <div key={label} className="bg-white border border-slate-200 rounded px-2 py-2">
            <div className={`font-mono font-bold text-xs ${cls}`}>{value}</div>
            <div className="text-micro uppercase text-slate-400 font-bold">{label}</div>
          </div>
        ))}
      </div>

      <ReviewPanel r={review} st={st} onReprice={onReprice} onVoidDropped={onVoidDropped} />

      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(o => !o)}
          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {open ? 'Hide' : 'Show'} the {st.lines.length} lines of the statement
        </button>
        {onSave && (
          <button onClick={onSave} disabled={saved}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded
              ${saved ? 'bg-emerald-50 text-emerald-700 cursor-default'
                      : 'bg-blue-700 text-white hover:bg-blue-800'}`}>
            {saved
              ? <><CheckCircle2 className="w-3.5 h-3.5" /> Saved to {vendorName}</>
              : <><Save className="w-3.5 h-3.5" /> Save to {vendorName}</>}
          </button>
        )}
      </div>

      {open && (
        <div className="bg-white border border-slate-200 rounded max-h-96 overflow-auto">
          <table className="w-full text-left min-w-[720px]">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-100 text-micro uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2 text-right">Billed</th>
                <th className="px-3 py-2 text-right">Paid or refunded</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-right">Our books</th>
                <th className="px-3 py-2 text-right" title="The statement's figure less the ticket's own fare">Above fare</th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-50 text-xs">
                  <td className="px-3 py-1.5 font-mono text-mini text-slate-500">{l.date}</td>
                  <td className="px-3 py-1.5 font-mono text-mini text-slate-700">{l.document}</td>
                  <td className="px-3 py-1.5 font-mono text-mini text-slate-600">
                    {l.airline ? `${l.airline}-${l.ticketNo}` : l.ticketNo}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                    {l.debit ? fmt(l.debit) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-600">
                    {l.credit ? `+${fmt(l.credit)}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                    {l.balance === null ? '—' : fmt(l.balance)}
                  </td>
                  {(() => {
                    const c = l.section === 'RECEIPT' ? undefined : byTicket.get(l.ticketNo);
                    if (!c) return <><td className="px-3 py-1.5" /><td className="px-3 py-1.5" /></>;
                    return <>
                      <td className={`px-3 py-1.5 text-right font-mono ${c.verdict === 'AGREES' ? 'text-slate-400'
                        : c.verdict === 'NOT_IN_BOOKS' ? 'text-red-600' : 'text-amber-700 font-bold'}`} title={c.why}>
                        {c.verdict === 'NOT_IN_BOOKS' ? 'none' : c.verdict === 'AGREES' ? '✓' : fmt(c.held)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-purple-700">
                        {c.fee != null && c.fee >= 1 ? fmt(c.fee) : '—'}
                      </td>
                    </>;
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const DocumentCheck: React.FC<{
  tickets: Ticket[];
  vendorName?: string;
  onSaveStatement?: (s: VendorStatement) => void;
  topUps?: BalanceTopUp[];
  statements?: VendorStatement[];
  wallets?: VendorBalance[];
  /** Put tickets right to the statement's figure. Absent for a viewer. */
  onReprice?: (list: Reprice[]) => Promise<void>;
  /** Write the statement's invoice numbers onto our tickets. Absent for a viewer. */
  onFillInvoiceNos?: (list: InvoiceNoFill[], period: string) => Promise<void>;
  /** Mark rows from their sheet or by hand that the statement bills as recorded. Absent for a viewer. */
  onConfirm?: (list: Confirmation[]) => Promise<void>;
  /** Move tickets their statement stopped billing to Voids. Absent for a viewer. */
  onVoidDropped?: VoidDropped;
}> = ({ tickets, vendorName = 'Ibtekar', onSaveStatement, topUps = [], statements = [], wallets = [], onReprice, onFillInvoiceNos, onConfirm, onVoidDropped }) => {
  const [results, setResults] = useState<InvoiceResult[] | null>(null);
  const [statement, setStatement] = useState<ParsedStatement | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  /* Whether the file carries a ZATCA QR code. This screen reads the older
     template line by line, and that template is Ibtekar's booking-system
     printout: headed TAX INVOICE, never through ZATCA, no QR code. */
  const [hasQr, setHasQr] = useState(true);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  /* Reading a statement files each ticket under the invoice number it is
     billed on - what a request for its ZATCA tax invoice has to quote. Done
     as the file is read, once per file, and said here. */
  const [invoiceNos, setInvoiceNos] = useState<{ filled: InvoiceNoFill[]; conflicts: InvoiceNoConflict[] } | null>(null);
  const filledFor = useRef('');
  useEffect(() => {
    if (!statement || !onFillInvoiceNos) return;
    const key = `${fileName}|${statement.periodStart}|${statement.periodEnd}|${statement.closingBalance}`;
    if (filledFor.current === key) return;
    filledFor.current = key;
    const { fill, conflicts } = invoiceNumbersFromStatement(statement, tickets, vendorName);
    setInvoiceNos({ filled: fill, conflicts });
    if (fill.length) void onFillInvoiceNos(fill, `${statement.periodStart} to ${statement.periodEnd}`)
      .catch(() => setInvoiceNos({ filled: [], conflicts }));
    // ...and what we keyed by hand that it bills at our figure is confirmed.
    const confirm = confirmationsFromStatement(statement, tickets, vendorName);
    if (confirm.length && onConfirm) void onConfirm(confirm).catch(e => console.error('statement confirmations', e));
  }, [statement, fileName, tickets, vendorName, onFillInvoiceNos, onConfirm]);

  const clear = () => {
    setResults(null); setStatement(null); setFileName(''); setError(''); setSaved(false); setInvoiceNos(null);
  };

  const read = async (file: File) => {
    setBusy(true); setError(''); setResults(null); setStatement(null);
    setSaved(false); setFileName(file.name);
    try {
      const { words, qrCodes } = await pdfContent(await file.arrayBuffer());
      setHasQr(qrCodes.length > 0);
      if (!words.length) {
        setError('There is no text in this PDF to read. A scanned or photographed document is '
               + 'a picture of a page, not a page — ask Ibtekar for the file their system produced.');
        return;
      }

      // Which document this is decides which reader runs. Guessing from what
      // happens to parse is what reported a statement as eleven empty invoices.
      const kind = documentKind(words);

      if (kind === 'statement') {
        const st = parseIbtekarStatementPdf(words);
        if (!st) { setError('This looks like a statement of account, but none of its figures could be read.'); return; }
        setStatement(st);
        return;
      }

      const invoices = parseIbtekarInvoicePdf(words);
      if (!invoices.length) {
        setError('This is neither an Ibtekar invoice nor a statement of account. Their invoices '
               + 'carry a number written "Inv. No: INV261733", and their statements are titled '
               + '"STATEMENT OF ACCOUNTS".');
        return;
      }
      setResults(reconcileAll(invoices, tickets));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const totalDiff = results
    ? Math.round(results.reduce((n, r) => n + r.difference, 0) * 100) / 100
    : 0;

  /** The statement as the period list stores it, ready to save. */
  const asStatement = (st: ParsedStatement): VendorStatement => ({
    id: `stm_${vendorName.toLowerCase()}_${st.periodStart.replace(/-/g, '')}_${st.periodEnd.replace(/-/g, '')}`,
    vendorName,
    periodStart: st.periodStart,
    periodEnd: st.periodEnd,
    currency: st.currency,
    openingBalance: st.openingBalance,
    closingBalance: st.closingBalance,
    billed: st.billed,
    paid: st.paid,
    otherCharges: 0,
    sourceFile: fileName,
    note: `${st.lines.length} line(s) read from the statement.`,
    lines: st.lines.filter(l => l.section !== 'RECEIPT' && l.ticketNo)
      .map(l => ({ ticketNo: l.ticketNo, date: l.date, document: l.document, debit: l.debit, credit: l.credit })),
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-700 uppercase text-xs tracking-wide flex items-center gap-2">
            <FileCheck2 className="w-3.5 h-3.5 text-purple-600" />
            Read a document
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Drop a vendor's statement or invoice here to see if it matches our books, and why if it
            does not. To keep an invoice, use Tax Invoices.
          </p>
        </div>
        {(results || statement) && (
          <button onClick={clear}
            className="text-slate-400 hover:text-slate-600" title="Clear">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {!results && !statement && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault(); setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) read(f);
            }}
            onClick={() => input.current?.click()}
            className={`border-2 border-dashed rounded-lg px-6 py-10 text-center cursor-pointer
              transition-colors ${dragging ? 'border-purple-400 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}
          >
            <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
            {busy ? (
              <div className="flex flex-col items-center gap-2 text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs">Reading {fileName}…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Upload className="w-5 h-5" />
                <span className="text-xs font-bold text-slate-600">Drop a PDF here, or click to choose</span>
                <span className="text-mini">
                  A tax invoice, a bundle of them, or a statement of account.
                </span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded px-4 py-3 text-xs text-red-800">
            {error}
          </div>
        )}

        {results && (
          <>
            {!hasQr && (
              <div className="bg-red-50 border-2 border-red-300 rounded-lg px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-red-700">
                  <AlertTriangle className="w-4 h-4" />
                  Not a final tax invoice — there is no ZATCA QR code on it
                </div>
                <div className="text-xs text-red-700 mt-0.5">
                  The figures can still be checked against the ledger here, but this printout cannot
                  carry the VAT. Ask Ibtekar for the e-invoice from their ZATCA system, the one with
                  the QR code.
                </div>
              </div>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">
                <b className="text-slate-700">{fileName}</b> — {results.length} invoice(s),{' '}
                {results.reduce((n, r) => n + r.invoice.lines.length, 0)} line(s)
              </span>
              <span className={`font-mono font-bold ${Math.abs(totalDiff) < 0.02 ? 'text-emerald-600' : 'text-red-600'}`}>
                {Math.abs(totalDiff) < 0.02
                  ? 'The ledger agrees with every invoice in this file'
                  : `${totalDiff > 0 ? '+' : '−'}${fmt(totalDiff)} across the file`}
              </span>
            </div>
            <div className="space-y-2">
              {results.map((r, i) => <InvoicePanel key={`${r.invoice.invoice}-${i}`} r={r} />)}
            </div>
          </>
        )}

        {statement && invoiceNos && (invoiceNos.filled.length > 0 || invoiceNos.conflicts.length > 0) && (
          <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-900">
            {invoiceNos.filled.length > 0 && (
              <div>
                <b>Invoice numbers filled on {invoiceNos.filled.length} ticket{invoiceNos.filled.length === 1 ? '' : 's'}</b> from
                this statement.
              </div>
            )}
            {invoiceNos.conflicts.length > 0 && (
              <div className="text-amber-800 mt-0.5">
                {invoiceNos.conflicts.length} not changed, because our books already have another invoice number:{' '}
                <span className="font-mono">{invoiceNos.conflicts.slice(0, 8).map(c => `${c.ticketNo} has ${c.has}, statement ${c.statement}`).join('; ')}
                {invoiceNos.conflicts.length > 8 ? ` and ${invoiceNos.conflicts.length - 8} more` : ''}</span>
              </div>
            )}
          </div>
        )}
        {statement && (
          <StatementPanel
            st={statement} fileName={fileName} tickets={tickets} vendorName={vendorName}
            saved={saved}
            onSave={onSaveStatement && (() => { onSaveStatement(asStatement(statement)); setSaved(true); })}
            topUps={topUps} statements={statements} onReprice={onReprice} onVoidDropped={onVoidDropped}
            wallet={wallets.find(w => w.vendorName.toLowerCase() === vendorName.toLowerCase())}
          />
        )}
      </div>
    </div>
  );
};

export default DocumentCheck;
