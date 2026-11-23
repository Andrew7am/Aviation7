import React, { useMemo, useState } from 'react';
import { shortDay } from '../core/helpers/statementReasons';
import { StatusBadge, badgeClass, ticketStatus } from './ui/StatusBadge';
import { PageHeader, PageTitle } from './ui/PageHeader';
import { Ticket, VendorStatement, VendorBalance, BalanceTopUp } from '../types';
import {
  FileText, Plus, Trash2, ChevronDown, ChevronRight, Wallet,
  AlertTriangle, CheckCircle2, Edit3, Link2Off,
} from 'lucide-react';
import { Dialog, DialogClose } from './ui/Dialog';
import {
  ledgerAccount, unmatchedInPeriod, LedgerPeriod, Payment,
} from '../core/helpers/statementMath';
import { DocumentCheck, type VoidDropped } from './DocumentCheck';
import type { Reprice } from '../core/helpers/statementAgainstBooks';
import { BalanceRange } from './BalanceRange';
import type { InvoiceNoFill } from '../core/helpers/statementInvoiceNos';

/**
 * The vendors whose account is settled on their figures rather than ours.
 *
 * Ibtekar and NSA give us ticketing access: we issue on their stock from our
 * own screen, and they then adjust the account on their side — a service fee,
 * a penalty, a correction — none of which arrives as a ticket. The wallet in
 * Vendor Credit computes a balance from rows we recorded, so it cannot see any
 * of that, and the two balances drift with nothing saying by how much.
 *
 * Everyone else sells us tickets against a prepaid wallet, where the wallet IS
 * the account and a second view of it would only be a second answer to the
 * same question.
 *
 * The table below reads OUR ledger, period by period, and its last closing
 * figure is the Vendor Credit balance to the piastre — the same arithmetic,
 * not a second version of it. The vendor's own statement sits beside it as
 * evidence to settle against, which is the right way round: the agency runs on
 * its books and reconciles to theirs, and a screen led by their figures leaves
 * the balance everyone actually works from nowhere on the page.
 */
const STATEMENT_VENDORS = ['Ibtekar', 'NSA'];

const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A balance the way the vendor prints it: Cr in our favour, Dr against. */
const drCr = (n: number) => `${fmt(n)} ${n < 0 ? 'Dr' : 'Cr'}`;

const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  statements: VendorStatement[];
  tickets: Ticket[];
  topUps: BalanceTopUp[];
  wallets: VendorBalance[];
  onSave: (s: VendorStatement) => void;
  onDelete: (id: string) => void;
  canEdit?: boolean;
  /** Put tickets right to a statement's figure. */
  onReprice?: (list: Reprice[]) => Promise<void>;
  /** File tickets under the invoice numbers a statement bills them on. */
  onFillInvoiceNos?: (list: InvoiceNoFill[], period: string) => Promise<void>;
  onConfirmFromStatement?: (list: { id: string; ticketNo: string; by: string }[]) => Promise<void>;
  /** Move tickets a statement stopped billing to Voids. */
  onVoidDropped?: VoidDropped;
}

const blank = (vendor: string): VendorStatement => ({
  id: `stm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  vendorName: vendor,
  periodStart: today().slice(0, 8) + '01',
  periodEnd: today(),
  currency: 'SAR',
  openingBalance: 0, closingBalance: 0, billed: 0, paid: 0, otherCharges: 0,
  sourceFile: '', note: '',
});

const Num: React.FC<{
  label: string; hint?: string; value: number; onChange: (n: number) => void;
}> = ({ label, hint, value, onChange }) => (
  <div>
    <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">{label}</label>
    <input
      type="number" step="0.01" value={Number.isFinite(value) ? value : 0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono
                 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
    />
    {hint && <p className="text-micro text-slate-400 mt-1 leading-tight">{hint}</p>}
  </div>
);

const StatementForm: React.FC<{
  initial: VendorStatement;
  onSave: (s: VendorStatement) => void;
  onClose: () => void;
}> = ({ initial, onSave, onClose }) => {
  const [s, setS] = useState<VendorStatement>(initial);
  const set = (p: Partial<VendorStatement>) => setS(v => ({ ...v, ...p }));

  const implied = Math.round((s.openingBalance + s.paid - s.billed - s.otherCharges) * 100) / 100;
  const gap = Math.round((implied - s.closingBalance) * 100) / 100;
  const foots = Math.abs(gap) < 0.011;

  return (
    <Dialog onClose={onClose} label={`${s.vendorName} statement of account`} className="sm:max-w-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-bold text-sm text-slate-700">
            {s.vendorName} — statement of account
          </h3>
          <DialogClose onClick={onClose} />
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">Vendor</label>
              <select value={s.vendorName} onChange={e => set({ vendorName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm">
                {STATEMENT_VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">Period from</label>
              <input type="date" value={s.periodStart} onChange={e => set({ periodStart: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">Period to</label>
              <input type="date" value={s.periodEnd} onChange={e => set({ periodEnd: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Num label="Opening balance" value={s.openingBalance}
                 hint="As the statement prints it. Positive for their Cr — credit in our favour. Negative for Dr."
                 onChange={n => set({ openingBalance: n })} />
            <Num label="Closing balance" value={s.closingBalance}
                 hint="Their “Amount payable to you”, same sign rule."
                 onChange={n => set({ closingBalance: n })} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Num label="Billed" value={s.billed}
                 hint="Their ticket total for the period."
                 onChange={n => set({ billed: n })} />
            <Num label="Paid to them" value={s.paid}
                 hint="Receipt vouchers in the period."
                 onChange={n => set({ paid: n })} />
            <Num label="Their own charges" value={s.otherCharges}
                 hint="Fees or corrections they added on their side — never a ticket."
                 onChange={n => set({ otherCharges: n })} />
          </div>

          {/* The footing check, live, before anything is stored. A statement
              that does not foot has been read or typed wrong, and every
              comparison drawn from it afterwards would be built on it. */}
          <div className={`rounded-lg border px-4 py-3 text-xs font-mono flex items-center justify-between
            ${foots ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            <span>opening {fmt(s.openingBalance)} + paid {fmt(s.paid)} − billed {fmt(s.billed)}
              {s.otherCharges ? ` − charges ${fmt(s.otherCharges)}` : ''} = {drCr(implied)}</span>
            <span className="font-bold flex items-center gap-1.5">
              {foots
                ? <><CheckCircle2 className="w-3.5 h-3.5" /> it foots</>
                : <><AlertTriangle className="w-3.5 h-3.5" /> off by {fmt(gap)}</>}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">Source file</label>
              <input value={s.sourceFile ?? ''} onChange={e => set({ sourceFile: e.target.value })}
                placeholder="AlSafar AlMutmiz.pdf"
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">Note</label>
              <input value={s.note ?? ''} onChange={e => set({ note: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={() => { onSave(s); onClose(); }}
            className="px-4 py-2 text-xs font-bold bg-blue-700 text-white rounded hover:bg-blue-800">
            Save statement
          </button>
        </div>
    </Dialog>
  );
};

/**
 * One headline figure in a panel's header.
 *
 * Three of these sit on a row that has to survive a 375px phone. Laid out as
 * three right-aligned columns they break inside the number itself — "8,266.38"
 * on one line and "Cr" on the next, which reads as a different figure — so on
 * a narrow screen each becomes a label-and-value row of its own and the figure
 * is told never to wrap.
 */
const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 w-full sm:w-auto sm:block sm:text-right">
    <div className="text-micro uppercase text-slate-400 font-bold">{label}</div>
    <div className="text-sm whitespace-nowrap">{children}</div>
  </div>
);

const GapCell: React.FC<{ n: number | null; currency: string }> = ({ n, currency }) => {
  if (n === null) return <span className="text-slate-400 text-xs">—</span>;
  const clear = Math.abs(n) < 0.011;
  return (
    <span className={`font-mono font-bold text-xs ${clear ? 'text-emerald-600' : 'text-red-600'}`}>
      {clear ? '—' : `${n > 0 ? '+' : '−'}${fmt(n)} ${currency}`}
    </span>
  );
};

/**
 * One period of our own ledger.
 *
 * Opening, what we issued, what came back, what we paid, closing — five
 * figures that foot by construction, because the two balances are read off the
 * same running total the wallet keeps rather than computed a second way. The
 * vendor's closing for the same dates is the last column, and the difference
 * beside it is the whole reason the screen exists.
 */
type PeriodProps = {
  p: LedgerPeriod; currency: string; canEdit: boolean;
  onEdit: () => void; onDelete: () => void;
};

/** What a period's row and its phone card both read: their statement, its
 *  own footing, and our rows nothing of theirs has been matched to. */
function usePeriod(p: LedgerPeriod) {
  const s = p.statement;
  const unmatched = useMemo(() => unmatchedInPeriod(p), [p]);
  const footingGap = s
    ? Math.round((s.openingBalance + s.paid - s.billed - s.otherCharges - s.closingBalance) * 100) / 100
    : 0;
  return { s, unmatched, footingGap, foots: Math.abs(footingGap) < 0.011 };
}

const PeriodBadges: React.FC<{ p: LedgerPeriod; foots: boolean; footingGap: number }> = ({ p, foots, footingGap }) => (
  <>
    {!p.statement && (
      <span className={`ml-2 ${badgeClass('neutral')}`}
            title="The vendor has issued no statement covering these dates, so there is nothing of theirs to compare against.">
        Ours only
      </span>
    )}
    {p.statement && !foots && (
      <span className={`ml-2 ${badgeClass('warning')}`}
            title={`Their statement's own figures do not foot — off by ${fmt(footingGap)}`}>
        Theirs off by {fmt(footingGap)}
      </span>
    )}
  </>
);

/** What a period opens to: our arithmetic, their statement, what we paid,
 *  our rows. The same under a table row and under a phone's card. */
const PeriodDetail: React.FC<{
  p: LedgerPeriod; currency: string; foots: boolean; unmatched: ReturnType<typeof unmatchedInPeriod>;
}> = ({ p, currency, foots, unmatched }) => {
  const s = p.statement;
  // Ours less theirs; a ticket they bill later makes ours the lower by its price.
  const later = Math.round(p.billedLater.reduce((n, x) => n + (x.amount || 0), 0) * 100) / 100;
  const rest = Math.round(((p.balanceGap ?? 0) + later) * 100) / 100;
  return (
    <div className="pl-4 sm:pl-10 pr-4 py-3 space-y-3">
        {/* Our own arithmetic, spelled out, so the closing figure above
            can be checked by eye rather than taken on trust. */}
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-xs
                        font-mono text-slate-600">
          Our books: {drCr(p.opening)} + paid {fmt(p.paid)} + refunds {fmt(p.refunded)}
          {' '}− tickets {fmt(p.issued)} = <b className="text-slate-800">{drCr(p.closing)}</b>
        </div>

        {s && (
          <div className={`rounded-lg border px-4 py-2.5 text-xs
            ${Math.abs(p.balanceGap ?? 0) < 0.011
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-white border-slate-200 text-slate-600'}`}>
            <b>{s.vendorName}'s statement, {shortDay(s.periodStart)} to {shortDay(s.periodEnd)}:</b>{' '}
            {drCr(s.openingBalance)} + payments and refunds {fmt(s.paid)} − tickets {fmt(s.billed)}
            {s.otherCharges ? ` − other charges ${fmt(s.otherCharges)}` : ''} = <b>{drCr(s.closingBalance)}</b>.
            {s.periodStart < p.from && (
              <> It starts before this row because it overlaps the statement above.</>
            )}
            {!foots && (
              <> <b>Their own figures do not add up:</b> they come to {drCr(
                Math.round((s.openingBalance + s.paid - s.billed - s.otherCharges) * 100) / 100)}.</>
            )}
            {Math.abs(p.balanceGap ?? 0) >= 0.011 && (
              <ul className="mt-1.5 space-y-0.5">
                <li><b>Difference: {fmt(p.balanceGap!)} {currency}</b> — we have {p.balanceGap! > 0 ? 'more' : 'less'} than they say.</li>
                {p.billedLater.length > 0 && (
                  <li>{fmt(later)} of it: {p.billedLater.length} ticket(s) they added on a later statement
                    ({p.billedLater.map(t => t.ticketNo).join(', ')}). Nothing to do.</li>
                )}
                {p.billedLater.length > 0 && Math.abs(rest) < 0.05 && Math.abs(rest) >= 0.005 && <li>The last {fmt(rest)} is rounding.</li>}
                {Math.abs(rest) >= 0.05 && (
                  <li>{p.billedLater.length > 0 ? `Still to find: ${fmt(rest)}. ` : ''}Drop the statement PDF in "Read a document" above:
                    it lists each reason and what to do.</li>
                )}
              </ul>
            )}
          </div>
        )}

        {p.payments.length > 0 && (
          <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center
                            justify-between">
              <span className="text-micro font-bold uppercase text-emerald-700 flex items-center gap-1.5">
                <Wallet className="w-3 h-3" /> What we paid them ({p.payments.length})
              </span>
              <span className="font-mono text-xs font-bold text-emerald-600">
                +{fmt(p.paid)} {currency}
              </span>
            </div>
            <table className="w-full text-left">
              <tbody>
                {p.payments.map(x => (
                  <tr key={x.id} className="border-b border-slate-50 text-xs">
                    <td className="px-3 py-1.5 font-mono text-mini text-slate-500 w-28">{x.date}</td>
                    <td className="px-3 py-1.5 text-slate-600">{x.note}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600">
                      +{fmt(x.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-micro font-bold
                          uppercase text-slate-500 flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            <span>Our rows in this period ({p.tickets.length})</span>
          </div>
          {p.tickets.length === 0 ? (
            <p className="px-4 py-4 text-xs text-slate-400 italic">
              Nothing in the ledger falls inside these dates.
            </p>
          ) : (<>
            <ul className="md:hidden max-h-80 overflow-y-auto overscroll-contain divide-y divide-slate-50">
              {p.tickets.map(t => (
                <li key={t.id} className="px-3 py-2 flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-bold text-slate-700">{t.ticketNo}</span>
                    <span className="block text-slate-600 truncate">{t.passengerName}</span>
                    <span className="block font-mono text-mini text-slate-400">
                      {t.date} · {t.vendorReference || <span className="text-red-400">no vendor ref</span>}
                    </span>
                  </span>
                  <span className={`font-mono whitespace-nowrap ${(t.amount || 0) < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {(t.amount || 0) < 0 ? '−' : ''}{fmt(t.amount || 0)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="hidden md:block max-h-80 overflow-auto">
              <table className="w-full text-left min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-100 text-micro uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Ticket</th>
                    <th className="px-3 py-2">Passenger</th>
                    <th className="px-3 py-2">Vendor ref</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {p.tickets.map(t => (
                    <tr key={t.id} className="border-b border-slate-50 text-xs">
                      <td className="px-3 py-1.5 font-mono text-mini text-slate-500">{t.date}</td>
                      <td className="px-3 py-1.5 font-mono text-mini text-slate-700">{t.ticketNo}</td>
                      <td className="px-3 py-1.5 text-slate-600">{t.passengerName}</td>
                      <td className="px-3 py-1.5 font-mono text-mini text-slate-500">
                        {t.vendorReference || <span className="text-red-400">none</span>}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono
                        ${(t.amount || 0) < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                        {(t.amount || 0) < 0 ? '−' : ''}{fmt(t.amount || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>)}
        </div>

        {s && unmatched.length > 0 && (
          <div className="bg-white border border-red-100 rounded-lg px-4 py-2.5 text-xs text-slate-600
                          flex items-start gap-2">
            <Link2Off className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
            <span>
              <b>{unmatched.length}</b> {unmatched.length === 1 ? 'row has' : 'rows have'} no invoice number from the
              vendor yet. If there is a difference, look at {unmatched.length === 1 ? 'it' : 'them'} first.
            </span>
          </div>
        )}
      </div>
  );
};

/**
 * One period on a phone: a card instead of a ten-column row. The two
 * closings and the difference between them come first - they are why the
 * screen exists - and the four figures that make up our closing sit under
 * them. Tapping it opens the same detail the table row opens.
 */
const PeriodCard: React.FC<PeriodProps> = ({ p, currency, canEdit, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const { s, unmatched, footingGap, foots } = usePeriod(p);
  const fig = (label: string, value: React.ReactNode, cls = 'text-slate-600') => (
    <span><span className="block text-mini text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`block font-mono text-xs ${cls}`}>{value}</span></span>
  );
  return (
    <div className={open ? 'bg-slate-50' : ''}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 pt-3.5 pb-3 flex items-start gap-3 active:bg-slate-50">
        <span className="mt-0.5 text-slate-400 shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-y-1 font-mono text-xs text-slate-600">
            <span>{p.from} → {p.to}</span>
            <PeriodBadges p={p} foots={foots} footingGap={footingGap} />
          </span>
          <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            {fig('Our closing', drCr(p.closing), `font-bold ${p.closing < 0 ? 'text-red-600' : 'text-emerald-700'}`)}
            {fig('Their closing', s ? drCr(s.closingBalance) : '—', 'text-slate-500')}
          </span>
          <span className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-mini text-slate-400 uppercase tracking-wide">Difference</span>
            <GapCell n={p.balanceGap} currency={currency} />
          </span>
          <span className="mt-2.5 pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-x-3 gap-y-2">
            {fig('Our opening', drCr(p.opening), 'text-slate-500')}
            {fig('Issued', <>{fmt(p.issued)} <span className="text-slate-400 text-mini">({p.tickets.length})</span></>)}
            {fig('Refunded', p.refunded ? `+${fmt(p.refunded)}` : '—', 'text-emerald-600')}
            {fig('Paid', p.paid ? `+${fmt(p.paid)}` : '—', 'text-emerald-600')}
          </span>
        </span>
      </button>
      {canEdit && s && (
        <div className="flex gap-2 px-4 pb-3 pl-11">
          <button type="button" onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 text-slate-600 text-xs font-bold hover:text-purple-600">
            <Edit3 className="w-3.5 h-3.5" /> Edit statement
          </button>
          <button type="button"
            onClick={() => { if (confirm(`Delete the ${s.periodStart} → ${s.periodEnd} statement?`)) onDelete(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 text-slate-500 text-xs font-bold hover:text-red-600">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
      {open && <PeriodDetail p={p} currency={currency} foots={foots} unmatched={unmatched} />}
    </div>
  );
};

const PeriodRow: React.FC<PeriodProps> = ({ p, currency, canEdit, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const { s, unmatched, footingGap, foots } = usePeriod(p);

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
          onClick={() => setOpen(o => !o)}>
        <td className="py-3 px-3 text-slate-400">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </td>
        <td className="py-3 px-3 font-mono text-xs text-slate-600 whitespace-nowrap">
          {p.from} → {p.to}
          <PeriodBadges p={p} foots={foots} footingGap={footingGap} />
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-500">{drCr(p.opening)}</td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-600">
          {fmt(p.issued)}
          <span className="text-slate-400 ml-1 text-mini">({p.tickets.length})</span>
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-emerald-600">
          {p.refunded ? `+${fmt(p.refunded)}` : '—'}
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-emerald-600">
          {p.paid ? `+${fmt(p.paid)}` : '—'}
        </td>
        <td className={`py-3 px-3 text-right font-mono font-bold text-xs
          ${p.closing < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          {drCr(p.closing)}
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-500">
          {s ? drCr(s.closingBalance) : <span className="text-slate-400">—</span>}
        </td>
        <td className="py-3 px-3 text-right"><GapCell n={p.balanceGap} currency={currency} /></td>
        <td className="py-3 px-3 text-center" onClick={e => e.stopPropagation()}>
          {canEdit && s ? (
            <div className="flex items-center justify-center gap-2">
              <button onClick={onEdit} className="text-slate-400 hover:text-purple-600" title="Edit their statement">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { if (confirm(`Delete the ${s.periodStart} → ${s.periodEnd} statement?`)) onDelete(); }}
                className="text-slate-400 hover:text-red-500" title="Delete their statement">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : <span className="text-slate-400 text-micro">—</span>}
        </td>
      </tr>

      {open && (
        <tr className="bg-slate-50">
          <td colSpan={10} className="p-0">
            <PeriodDetail p={p} currency={currency} foots={foots} unmatched={unmatched} />
          </td>
        </tr>
      )}
    </>
  );
};

export const VendorStatements: React.FC<Props> = ({
  statements, tickets, topUps, wallets, onSave, onDelete, canEdit = false, onReprice, onFillInvoiceNos, onConfirmFromStatement, onVoidDropped,
}) => {
  const [editing, setEditing] = useState<VendorStatement | null>(null);

  const payments: Payment[] = useMemo(
    () => topUps.map(t => ({
      id: t.id, vendorName: t.vendorName, amount: t.amount, date: t.date, note: t.note,
    })),
    [topUps],
  );

  const accounts = useMemo(
    () => STATEMENT_VENDORS.map(v => {
      const w = wallets.find(x => x.vendorName === v);
      return ledgerAccount(v, statements, tickets, payments,
        w ? { initialBalance: w.initialBalance, openingDate: w.openingDate } : undefined,
        today());
    }),
    [statements, tickets, payments, wallets],
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageTitle icon={<FileText />} title="Vendor statements" className="flex-1 basis-64"
          subtitle={<>
            Our balance with {STATEMENT_VENDORS.join(' and ')}, period by period, beside the balance on their
            statement. Open a period to see why the two differ.</>} />
        {canEdit && (
          <button
            onClick={() => setEditing(blank('Ibtekar'))}
            className="shrink-0 flex items-center gap-1.5 bg-blue-700 text-white text-xs font-bold
                       px-3 py-2 rounded hover:bg-blue-800">
            <Plus className="w-3.5 h-3.5" /> Add statement
          </button>
        )}
      </div>

      <BalanceRange vendors={STATEMENT_VENDORS} statements={statements} tickets={tickets}
        topUps={topUps} wallets={wallets} />

      <DocumentCheck tickets={tickets} onSaveStatement={canEdit ? onSave : undefined}
        topUps={topUps} statements={statements} wallets={wallets}
        onReprice={canEdit ? onReprice : undefined}
        onFillInvoiceNos={canEdit ? onFillInvoiceNos : undefined}
        onConfirm={canEdit ? onConfirmFromStatement : undefined}
        onVoidDropped={canEdit ? onVoidDropped : undefined} />

      {accounts.map(a => (
        <div key={a.vendorName} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between
                          gap-4 flex-wrap">
            <span className="font-bold text-slate-700 uppercase text-xs tracking-wide">
              {a.vendorName}
            </span>
            {/* The headline is our own balance, because it is the one the
                agency is on and the one Vendor Credit prints. Theirs is beside
                it, dated, as the thing to settle against. */}
            <div className="flex flex-col items-stretch gap-1 w-full
                            sm:w-auto sm:flex-row sm:items-center sm:gap-6">
              <Stat label="Our balance">
                <span className={`font-mono font-bold
                  ${(a.balance ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {a.balance === null ? '—' : drCr(a.balance)}
                </span>
                {a.balanceAsOf && <span className="text-micro text-slate-400 ml-1.5">
                  as of {a.balanceAsOf}</span>}
              </Stat>
              <Stat label="They last stated">
                <span className={`font-mono font-bold
                  ${(a.statedBalance ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {a.statedBalance === null ? '—' : drCr(a.statedBalance)}
                </span>
                {a.statedAsOf && <span className="text-micro text-slate-400 ml-1.5">
                  on {a.statedAsOf}</span>}
              </Stat>
              <Stat label="Difference that day">
                <GapCell n={a.balanceGap} currency={a.currency} />
              </Stat>
            </div>
          </div>

          {a.periods.length === 0 ? (
            <p className="px-5 py-8 text-xs text-slate-400 italic text-center">
              Nothing in the ledger for {a.vendorName} yet.
            </p>
          ) : (
            /* Ten columns, every one of them a figure. Narrower is not an
               option, so it scrolls sideways rather than losing the right-hand
               end of the row — which is where the difference lives. */
            <>
            <div className="md:hidden divide-y divide-slate-100">
              {a.periods.map(p => (
                <PeriodCard key={`${p.from}_${p.to}`} p={p} currency={a.currency} canEdit={canEdit}
                  onEdit={() => p.statement && setEditing(p.statement)}
                  onDelete={() => p.statement && onDelete(p.statement.id)} />
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
            <table className="data-table text-left min-w-[880px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-micro uppercase
                               tracking-wider text-slate-400">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Our opening</th>
                  <th className="px-3 py-2 text-right">Issued</th>
                  <th className="px-3 py-2 text-right">Refunded</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Our closing</th>
                  <th className="px-3 py-2 text-right">Their closing</th>
                  <th className="px-3 py-2 text-right">Difference</th>
                  <th className="px-3 py-2 text-center w-20" />
                </tr>
              </thead>
              <tbody>
                {a.periods.map(p => (
                  <PeriodRow key={`${p.from}_${p.to}`} p={p} currency={a.currency} canEdit={canEdit}
                    onEdit={() => p.statement && setEditing(p.statement)}
                    onDelete={() => p.statement && onDelete(p.statement.id)} />
                ))}
              </tbody>
            </table>
            </div>
            </>
          )}

          {a.undated > 0 && (
            <p className="px-5 py-2.5 text-xs text-slate-500 border-t border-slate-100 bg-slate-50">
              {a.undated} {a.vendorName} row(s), {fmt(a.undatedAmount)} {a.currency}, have no date, so they are in
              the balances but not in any one period.
            </p>
          )}
        </div>
      ))}

      {editing && (
        <StatementForm initial={editing} onSave={onSave} onClose={() => setEditing(null)} />
      )}
    </div>
  );
};

export default VendorStatements;
