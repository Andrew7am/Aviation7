import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Receipt, Upload, Loader2, AlertTriangle, CheckCircle2, X, Search, Trash2,
  FileWarning, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { Ticket } from '../types';
import { coverageReport, Coverage } from '../core/helpers/taxInvoiceCoverage';
import type { StoredInvoice } from '../services/TaxInvoiceService';
import type { FileOutcome } from '../hooks/useTaxInvoices';

/**
 * Which tickets we can actually produce a tax invoice for.
 *
 * The ledger already carries an invoice number against every Ibtekar row and
 * it is not the answer to this question. That number was typed off a
 * statement of account; a statement summarises a period and lists document
 * numbers, and no auditor will let you reclaim VAT with one. On Ibtekar's
 * newer ZATCA template the number is not even printed on the invoice.
 *
 * So the reference is ignored here. A ticket is covered when its document
 * number is printed on a final tax invoice we hold — one carrying Ibtekar's
 * ZATCA QR code — and on nothing weaker. Their booking system heads its own
 * printouts TAX INVOICE too; those have no QR code and do not count. The invoices are read once and kept; the verdict is
 * worked out fresh every time, because a ticket imported after its invoice
 * has to light up on its own.
 */

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BADGE: Record<Coverage, { label: string; cls: string }> = {
  COVERED: { label: 'Tax invoice held', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NOT_TAX: { label: 'Not a final tax invoice', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  NONE:    { label: 'No invoice',        cls: 'bg-red-50 text-red-700 border-red-200' },
};

const Tile: React.FC<{
  label: string; value: string; sub?: string; tone: 'good' | 'warn' | 'bad' | 'plain';
  active?: boolean; onClick?: () => void;
}> = ({ label, value, sub, tone, active, onClick }) => {
  const tones = {
    good:  'border-emerald-200 bg-emerald-50/50',
    warn:  'border-amber-200 bg-amber-50/50',
    bad:   'border-red-200 bg-red-50/50',
    plain: 'border-slate-200 bg-white',
  };
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`text-left px-4 py-3 rounded-lg border ${tones[tone]}
        ${onClick ? 'hover:shadow-sm cursor-pointer' : 'cursor-default'}
        ${active ? 'ring-2 ring-slate-400' : ''}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-800 font-mono mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </button>
  );
};

const InvoiceRow: React.FC<{
  c: ReturnType<typeof coverageReport>['invoices'][number];
  currency: string;
  onDelete?: () => void;
}> = ({ c, currency, onDelete }) => {
  const [open, setOpen] = useState(false);
  const i = c.invoice;
  const off = c.difference !== null && Math.abs(c.difference) >= 0.02;

  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="text-slate-400 hover:text-slate-600">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <span className="font-mono font-bold text-xs text-slate-700 w-32">{i.invoiceNo}</span>
        {i.theirSerial && (
          <span className="text-[10px] text-slate-400 font-mono">their no. {i.theirSerial}</span>
        )}
        <span className="text-[10px] text-slate-400 font-mono w-24">{i.invoiceDate || '—'}</span>
        {i.kind === 'CREDIT_NOTE' && (
          <span className="bg-purple-50 text-purple-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            CREDIT NOTE{i.against ? ` against ${i.against}` : ''}
          </span>
        )}
        {i.isTaxInvoice ? (
          <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            title={i.qr ? `ZATCA QR: ${i.qr.seller} · VAT no. ${i.qr.vatNo} · ${i.qr.timestamp} · total ${i.qr.total} · VAT ${i.qr.vat}` : undefined}>
            QR ✓ FINAL
          </span>
        ) : (
          <span className="bg-red-50 text-red-700 border border-red-200 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            title="No ZATCA QR code on it. A printout headed TAX INVOICE is not a final tax invoice.">
            NOT FINAL — NO QR
          </span>
        )}
        {!i.isTaxInvoice && c.finalFor.length > 0 && (
          <span className="text-[10px] text-emerald-700">final one held: {c.finalFor.join(', ')}</span>
        )}
        {i.layout === 'ZATCA' && i.kind !== 'CREDIT_NOTE' && (
          <span className="bg-slate-100 text-slate-500 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            title="This template prints no per-ticket amounts — only its total can be compared.">
            TOTAL ONLY
          </span>
        )}
        <span className="text-[10px] text-slate-500 ml-auto">
          {i.serials.length} ticket(s)
        </span>
        <span className="font-mono text-xs text-slate-700 w-28 text-right">
          {i.total === null ? '—' : `${i.total < 0 ? '−' : ''}${fmt(i.total)}`}
        </span>
        <span className={`font-mono text-xs w-28 text-right ${off ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
          {c.difference === null ? '—' : off ? `${c.difference > 0 ? '+' : '−'}${fmt(c.difference)}` : 'agrees'}
        </span>
        {onDelete && (
          <button onClick={onDelete} title="Remove this invoice from the tracker"
            className="text-slate-300 hover:text-red-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-2">
          {c.credits.length > 0 && i.total !== null && (
            <div className="text-[11px] text-purple-700">
              {c.credits.map(cn => (
                <span key={cn.invoiceNo} className="mr-3">
                  less credit note {cn.theirSerial}: −{fmt(cn.total ?? 0)}
                </span>
              ))}
              → net <span className="font-mono font-bold">
                {fmt(i.total + c.credits.reduce((n, cn) => n + (cn.total ?? 0), 0))}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
            <div><span className="text-slate-400">Net</span>{' '}
              <span className="font-mono text-slate-700">{i.net === null ? '—' : fmt(i.net)}</span></div>
            <div><span className="text-slate-400">VAT</span>{' '}
              <span className="font-mono text-slate-700">{i.vat === null ? '—' : fmt(i.vat)}</span></div>
            <div><span className="text-slate-400">Our ledger</span>{' '}
              <span className="font-mono text-slate-700">{fmt(c.ledgerTotal)} {currency}</span></div>
            <div><span className="text-slate-400">From</span>{' '}
              <span className="text-slate-600">{i.sourceFile || '—'}</span></div>
          </div>

          {c.notInLedger.length > 0 && (
            <div className="text-[11px]">
              <div className="font-bold text-red-700 mb-1">
                {c.notInLedger.length} document(s) it bills that our books have never seen
              </div>
              <div className="font-mono text-[10px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                {c.notInLedger.map(s => <span key={s}>{s}</span>)}
              </div>
            </div>
          )}

          <div className="text-[11px]">
            <div className="font-bold text-slate-600 mb-1">
              {c.inLedger.length} in the ledger
            </div>
            <div className="font-mono text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
              {c.inLedger.slice(0, 60).map(t => <span key={t.id}>{t.ticketNo}</span>)}
              {c.inLedger.length > 60 && <span>… and {c.inLedger.length - 60} more</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const TaxInvoices: React.FC<{
  tickets: Ticket[];
  invoices: StoredInvoice[];
  vendorName?: string;
  busy?: boolean;
  onUpload?: (files: File[]) => Promise<FileOutcome[]>;
  onDelete?: (id: string) => Promise<void>;
}> = ({ tickets, invoices, vendorName = 'Ibtekar', busy, onUpload, onDelete }) => {
  const [tab, setTab] = useState<'tickets' | 'invoices'>('tickets');
  const [filter, setFilter] = useState<Coverage | 'ALL'>('NONE');
  const [search, setSearch] = useState('');
  const [reading, setReading] = useState(false);
  const [outcomes, setOutcomes] = useState<FileOutcome[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const ours = useMemo(
    () => tickets.filter(t => t.source === vendorName), [tickets, vendorName]);
  const report = useMemo(() => coverageReport(invoices, ours), [invoices, ours]);
  const currency = ours[0]?.currency ?? 'SAR';

  /* The uncovered list is the reason to open this screen, so it opens on it.
     But a screen that opens on an empty red list before a single invoice has
     been uploaded reads as an alarm rather than a starting point. */
  useEffect(() => {
    if (!invoices.length) setFilter('ALL');
  }, [invoices.length]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return report.tickets
      .filter(r => filter === 'ALL' || r.coverage === filter)
      .filter(r => !q
        || r.ticket.ticketNo.toLowerCase().includes(q)
        || (r.ticket.passengerName || '').toLowerCase().includes(q)
        || (r.ticket.reqNum || '').toLowerCase().includes(q)
        || r.invoices.some(i => i.toLowerCase().includes(q)))
      .sort((a, b) => (a.ticket.date || '').localeCompare(b.ticket.date || ''));
  }, [report, filter, search]);

  const take = async (files: File[]) => {
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name));
    if (!pdfs.length || !onUpload) return;
    setReading(true);
    try { setOutcomes(await onUpload(pdfs)); }
    finally { setReading(false); }
  };

  const working = reading || busy;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-purple-600" />
          Tax Invoices — {vendorName}
        </h2>
        <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">
          Not the invoice number on the sales sheet. That one was typed off a statement of
          account and proves nothing. A ticket counts as covered here only when its document
          number is printed on a final tax invoice — one with Ibtekar's ZATCA QR code. A printout
          headed TAX INVOICE without a QR code is not one.
        </p>
      </div>

      {/* ── upload ─────────────────────────────────────────────────────── */}
      {onUpload && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); take([...e.dataTransfer.files]); }}
          onClick={() => input.current?.click()}
          className={`border-2 border-dashed rounded-xl px-5 py-6 text-center cursor-pointer
            transition ${dragging ? 'border-purple-400 bg-purple-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
          <input ref={input} type="file" accept=".pdf" multiple className="hidden"
            onChange={e => { take([...(e.target.files ?? [])]); e.target.value = ''; }} />
          {working ? (
            <div className="flex items-center justify-center gap-2 text-slate-500 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading…
            </div>
          ) : (
            <>
              <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1.5" />
              <div className="text-xs font-bold text-slate-600">
                Drop {vendorName}'s tax invoices here — as many at once as you like
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Both templates and credit notes are read. Only a document with Ibtekar's ZATCA
                QR code counts as a final tax invoice; anything else is flagged.
              </div>
            </>
          )}
        </div>
      )}

      {outcomes && outcomes.some(o => o.notFinal.length) && (
        <div className="bg-red-50 border-2 border-red-300 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-red-700">
            <AlertTriangle className="w-4 h-4" />
            Not a final tax invoice — no ZATCA QR code
          </div>
          <div className="text-[11px] text-red-700 mt-1">
            {outcomes.flatMap(o => o.notFinal.map(n => n.split(':')[0])).join(', ')}{' '}
            {outcomes.flatMap(o => o.notFinal).length === 1 ? 'is' : 'are'} recorded, but cannot carry the VAT.
            Ask {vendorName} for the e-invoice from their ZATCA system — the one with the QR code.
          </div>
        </div>
      )}

      {outcomes && (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Last upload — {outcomes.length} file(s)
            </span>
            <button onClick={() => setOutcomes(null)} className="text-slate-300 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {outcomes.map(o => (
            <div key={o.file} className="px-4 py-2 text-[11px]">
              <div className="flex items-center gap-2">
                {o.failed || o.notFinal.length || (!o.saved.length && !o.alreadyHeld.length && !o.upgraded.length)
                  ? <FileWarning className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                <span className="font-mono text-slate-700">{o.file}</span>
                {o.saved.length > 0 && (
                  <span className="text-emerald-700">recorded {o.saved.join(', ')}</span>
                )}
                {o.upgraded.length > 0 && (
                  <span className="text-emerald-700">
                    replaced a poorer copy of {o.upgraded.join(', ')}
                  </span>
                )}
                {o.alreadyHeld.length > 0 && (
                  <span className="text-slate-500">already on file: {o.alreadyHeld.join(', ')}</span>
                )}
              </div>
              {o.notFinal.map((p, n) => (
                <div key={`nf${n}`} className="ml-5 text-red-700 font-bold flex items-start gap-1 mt-0.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {p}
                </div>
              ))}
              {(o.failed ? [o.failed] : o.problems).map((p, n) => (
                <div key={n} className="ml-5 text-amber-700 flex items-start gap-1 mt-0.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {p}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {report.awaitingFinal.length > 0 && (
        <button onClick={() => setTab('invoices')}
          className="w-full text-left bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5 hover:shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
            <FileWarning className="w-4 h-4" />
            {report.awaitingFinal.length} document(s) on file are not final tax invoices, and no final one
            covers their tickets yet
          </div>
          <div className="text-[11px] text-amber-800 mt-0.5 font-mono">
            {report.awaitingFinal.map(a => a.invoice.invoiceNo).join(', ')}
          </div>
          <div className="text-[10px] text-amber-700 mt-0.5">
            Ask {vendorName} for the e-invoice (with the QR code) for these.
          </div>
        </button>
      )}

      {/* ── the answer ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="No tax invoice" tone="bad"
          value={String(report.uncovered.length)}
          sub={`${fmt(report.uncoveredValue)} ${currency}`}
          active={filter === 'NONE'} onClick={() => { setTab('tickets'); setFilter('NONE'); }} />
        <Tile label="Covered" tone="good"
          value={String(report.covered.length)}
          sub={`${fmt(report.coveredValue)} ${currency}`}
          active={filter === 'COVERED'} onClick={() => { setTab('tickets'); setFilter('COVERED'); }} />
        <Tile label="Not a final tax invoice" tone="warn"
          value={String(report.notTax.length)}
          sub="only on a document with no ZATCA QR code"
          active={filter === 'NOT_TAX'} onClick={() => { setTab('tickets'); setFilter('NOT_TAX'); }} />
        <Tile label="Invoices held" tone="plain"
          value={String(invoices.length)}
          sub={report.billedNotHeld.length
            ? `${report.billedNotHeld.length} billed document(s) not in our books`
            : 'every document they bill is in our books'}
          onClick={() => setTab('invoices')} />
      </div>

      {/* ── tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {([['tickets', 'By ticket'], ['invoices', 'By invoice']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-b-2 -mb-px
              ${tab === id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1">
          {tab === 'tickets' && (
            <select value={filter} onChange={e => setFilter(e.target.value as Coverage | 'ALL')}
              className="text-[11px] border border-slate-200 rounded px-2 py-1 text-slate-600">
              <option value="NONE">No invoice</option>
              <option value="COVERED">Covered</option>
              <option value="NOT_TAX">Not a final tax invoice</option>
              <option value="ALL">All {report.tickets.length}</option>
            </select>
          )}
          <div className="relative">
            <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ticket, passenger, req, invoice"
              className="text-[11px] border border-slate-200 rounded pl-6 pr-2 py-1 w-56 text-slate-700" />
          </div>
        </div>
      </div>

      {tab === 'tickets' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Ticket</th>
                <th className="px-3 py-2 text-left">Passenger</th>
                <th className="px-3 py-2 text-left">Req</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Tax invoice</th>
                <th className="px-3 py-2 text-left">Sales ref</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map(r => (
                <tr key={r.ticket.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{r.ticket.date}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-700">{r.ticket.ticketNo}</td>
                  <td className="px-3 py-1.5 text-[11px] text-slate-600 max-w-[16rem] truncate">
                    {r.ticket.passengerName || '—'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-blue-600">{r.ticket.reqNum || '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px] text-slate-700">
                    {fmt(r.ticket.amount ?? 0)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${BADGE[r.coverage].cls}`}>
                      {r.invoices.length ? r.invoices.join(', ') : BADGE[r.coverage].label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400">
                    {r.ticket.vendorReference || '—'}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-400">
                  {invoices.length
                    ? 'Nothing here.'
                    : 'No invoices uploaded yet, so nothing can be covered.'}
                </td></tr>
              )}
            </tbody>
          </table>
          {rows.length > 500 && (
            <div className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100">
              showing the first 500 of {rows.length} — narrow it with the search
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {report.invoices.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-lg px-4 py-8 text-center text-xs text-slate-400">
              No invoices on file yet.
            </div>
          )}
          {report.invoices.map(c => (
            <InvoiceRow key={c.invoice.invoiceNo} c={c} currency={currency}
              onDelete={onDelete
                ? () => onDelete((c.invoice as StoredInvoice).id)
                : undefined} />
          ))}
        </div>
      )}
    </div>
  );
};
