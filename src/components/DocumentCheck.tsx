import React, { useState, useRef } from 'react';
import { Ticket, VendorStatement } from '../types';
import {
  Upload, FileCheck2, AlertTriangle, CheckCircle2, X, Loader2, ChevronDown, ChevronRight,
  Save, Receipt,
} from 'lucide-react';
import { parseIbtekarInvoicePdf } from '../core/parsers/ibtekarInvoicePdf';
import {
  parseIbtekarStatementPdf, documentKind, ParsedStatement,
} from '../core/parsers/ibtekarStatementPdf';
import { reconcileAll, InvoiceResult, LineVerdict } from '../core/helpers/invoiceReconcile';
import { checkStatement } from '../core/helpers/statementMath';
import { pdfToWords } from '../core/helpers/pdfWords';

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
        <span className="text-[10px] text-slate-400 font-mono">{inv.invoiceDate}</span>
        {!inv.taxInvoice && (
          <span className="bg-slate-100 text-slate-500 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            NOT A TAX INVOICE
          </span>
        )}
        <span className="text-[10px] text-slate-400">{inv.lines.length} line(s)</span>
        <span className="ml-auto flex items-center gap-4">
          <span className="text-right">
            <span className="block text-[9px] uppercase text-slate-400 font-bold">Invoice</span>
            <span className="font-mono text-xs text-slate-700">
              {inv.total === null ? '—' : fmt(inv.total)}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-[9px] uppercase text-slate-400 font-bold">Ledger</span>
            <span className="font-mono text-xs text-slate-700">{fmt(r.ledgerTotal)}</span>
          </span>
          <span className="text-right w-28">
            <span className="block text-[9px] uppercase text-slate-400 font-bold">Difference</span>
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
                <div className="text-[9px] uppercase text-slate-400 font-bold">{label as string}</div>
              </div>
            ))}
          </div>

          {inv.subTotal !== null && inv.vat !== null && (
            <p className="text-[10px] text-slate-500 font-mono">
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
                  <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
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
                      <td className="px-3 py-1.5 font-mono text-[10px] text-slate-700">
                        {l.line.airline}-{l.line.ticketNo}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{l.line.passenger}</td>
                      <td className="px-3 py-1.5 text-slate-500 text-[10px]">{l.line.sector}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{l.line.pnr}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                        {l.line.amount === null ? '—' : fmt(l.line.amount)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                        {l.ticket ? fmt(l.ticket.amount ?? 0) : '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${VERDICT[l.verdict].cls}`}>
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
              <span className="font-mono text-[10px]">
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

const StatementPanel: React.FC<{
  st: ParsedStatement;
  fileName: string;
  tickets: Ticket[];
  vendorName: string;
  saved: boolean;
  onSave?: () => void;
}> = ({ st, fileName, tickets, vendorName, saved, onSave }) => {
  const [open, setOpen] = useState(false);

  // The same comparison the period list makes, so the figure shown here and
  // the figure shown after saving are one calculation, not two.
  const check = checkStatement({
    id: 'preview', vendorName, periodStart: st.periodStart, periodEnd: st.periodEnd,
    currency: st.currency, openingBalance: st.openingBalance, closingBalance: st.closingBalance,
    billed: st.billed, paid: st.paid, otherCharges: 0,
  }, tickets);

  const agrees = Math.abs(check.billedGap) < 0.011;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Receipt className="w-3.5 h-3.5 text-purple-600" />
        <b className="text-slate-700">{fileName}</b>
        <span className="bg-purple-50 text-purple-700 text-[9px] font-bold px-2 py-0.5 rounded-full">
          STATEMENT OF ACCOUNT
        </span>
        <span className="font-mono text-[11px] text-slate-500">
          {st.periodStart} → {st.periodEnd}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-center">
        {([
          ['Opening', drCr(st.openingBalance), 'text-slate-600'],
          ['Billed', fmt(st.billed), 'text-slate-700'],
          ['Paid', st.paid ? `+${fmt(st.paid)}` : '—', 'text-emerald-600'],
          ['Closing', drCr(st.closingBalance), st.closingBalance < 0 ? 'text-red-600' : 'text-emerald-700'],
          ['Our ledger', `${fmt(check.ledgerBilled)} (${check.ledgerRows})`, 'text-slate-700'],
        ] as const).map(([label, value, cls]) => (
          <div key={label} className="bg-white border border-slate-200 rounded px-2 py-2">
            <div className={`font-mono font-bold text-xs ${cls}`}>{value}</div>
            <div className="text-[9px] uppercase text-slate-400 font-bold">{label}</div>
          </div>
        ))}
      </div>

      <div className={`rounded-lg border px-4 py-3 text-xs flex items-center justify-between
        ${st.foots ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                   : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        <span className="font-mono">
          {fmt(st.openingBalance)} + {fmt(st.paid)} − {fmt(st.billed)} = {drCr(st.impliedClosing)}
        </span>
        <span className="font-bold flex items-center gap-1.5">
          {st.foots
            ? <><CheckCircle2 className="w-3.5 h-3.5" /> the statement foots</>
            : <><AlertTriangle className="w-3.5 h-3.5" /> off by {fmt(st.impliedClosing - st.closingBalance)}</>}
        </span>
      </div>

      <div className={`rounded-lg border px-4 py-3 text-xs flex items-center justify-between
        ${agrees ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                 : 'bg-red-50 border-red-200 text-red-800'}`}>
        <span>
          {vendorName} billed <b className="font-mono">{fmt(st.billed)}</b> over these dates; the
          ledger holds <b className="font-mono">{fmt(check.ledgerBilled)}</b> across {check.ledgerRows} row(s).
        </span>
        <span className="font-bold font-mono">
          {agrees ? 'no difference' : `${check.billedGap > 0 ? '+' : '−'}${fmt(check.billedGap)} ${st.currency}`}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(o => !o)}
          className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {st.lines.length} movement(s) on the statement
        </button>
        {onSave && (
          <button onClick={onSave} disabled={saved}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded
              ${saved ? 'bg-emerald-50 text-emerald-700 cursor-default'
                      : 'bg-purple-600 text-white hover:bg-purple-700'}`}>
            {saved
              ? <><CheckCircle2 className="w-3.5 h-3.5" /> Saved to {vendorName}</>
              : <><Save className="w-3.5 h-3.5" /> Save to {vendorName}</>}
          </button>
        )}
      </div>

      {open && (
        <div className="bg-white border border-slate-200 rounded max-h-96 overflow-auto">
          <table className="w-full text-left min-w-[560px]">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-50 text-xs">
                  <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{l.date}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-slate-700">{l.document}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-slate-600">
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
}> = ({ tickets, vendorName = 'Ibtekar', onSaveStatement }) => {
  const [results, setResults] = useState<InvoiceResult[] | null>(null);
  const [statement, setStatement] = useState<ParsedStatement | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const clear = () => {
    setResults(null); setStatement(null); setFileName(''); setError(''); setSaved(false);
  };

  const read = async (file: File) => {
    setBusy(true); setError(''); setResults(null); setStatement(null);
    setSaved(false); setFileName(file.name);
    try {
      const words = await pdfToWords(await file.arrayBuffer());
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
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-700 uppercase text-[11px] tracking-wide flex items-center gap-2">
            <FileCheck2 className="w-3.5 h-3.5 text-purple-600" />
            Read a document
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Drop in a tax invoice and it says where it and the ledger disagree. Drop in a
            statement of account and it reads the period and the balances, ready to save.
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
                <span className="text-[10px]">
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

        {statement && (
          <StatementPanel
            st={statement} fileName={fileName} tickets={tickets} vendorName={vendorName}
            saved={saved}
            onSave={onSaveStatement && (() => { onSaveStatement(asStatement(statement)); setSaved(true); })}
          />
        )}
      </div>
    </div>
  );
};

export default DocumentCheck;
