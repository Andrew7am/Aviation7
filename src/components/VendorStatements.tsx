import React, { useMemo, useState } from 'react';
import { Ticket, VendorStatement, VendorBalance, BalanceTopUp } from '../types';
import {
  FileText, Plus, Trash2, X, ChevronDown, ChevronRight, Wallet,
  AlertTriangle, CheckCircle2, Edit3, Link2Off,
} from 'lucide-react';
import {
  ledgerAccount, unmatchedInPeriod, LedgerPeriod, Payment,
} from '../core/helpers/statementMath';
import { DocumentCheck } from './DocumentCheck';
import { BalanceRange } from './BalanceRange';

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
    <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">{label}</label>
    <input
      type="number" step="0.01" value={Number.isFinite(value) ? value : 0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono
                 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
    />
    {hint && <p className="text-[9px] text-slate-400 mt-1 leading-tight">{hint}</p>}
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-bold text-sm text-slate-700">
            {s.vendorName} — statement of account
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Vendor</label>
              <select value={s.vendorName} onChange={e => set({ vendorName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm">
                {STATEMENT_VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Period from</label>
              <input type="date" value={s.periodStart} onChange={e => set({ periodStart: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Period to</label>
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
              <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Source file</label>
              <input value={s.sourceFile ?? ''} onChange={e => set({ sourceFile: e.target.value })}
                placeholder="AlSafar AlMutmiz.pdf"
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Note</label>
              <input value={s.note ?? ''} onChange={e => set({ note: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={() => { onSave(s); onClose(); }}
            className="px-4 py-2 text-xs font-bold bg-purple-600 text-white rounded hover:bg-purple-700">
            Save statement
          </button>
        </div>
      </div>
    </div>
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
    <div className="text-[9px] uppercase text-slate-400 font-bold">{label}</div>
    <div className="text-sm whitespace-nowrap">{children}</div>
  </div>
);

const GapCell: React.FC<{ n: number | null; currency: string }> = ({ n, currency }) => {
  if (n === null) return <span className="text-slate-300 text-xs">—</span>;
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
const PeriodRow: React.FC<{
  p: LedgerPeriod; currency: string; canEdit: boolean;
  onEdit: () => void; onDelete: () => void;
}> = ({ p, currency, canEdit, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const s = p.statement;
  const unmatched = useMemo(() => unmatchedInPeriod(p), [p]);
  const footingGap = s
    ? Math.round((s.openingBalance + s.paid - s.billed - s.otherCharges - s.closingBalance) * 100) / 100
    : 0;
  const foots = Math.abs(footingGap) < 0.011;

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
          onClick={() => setOpen(o => !o)}>
        <td className="py-3 px-3 text-slate-400">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </td>
        <td className="py-3 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
          {p.from} → {p.to}
          {!s && (
            <span className="ml-2 bg-slate-100 text-slate-500 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  title="The vendor has issued no statement covering these dates, so there is nothing of theirs to compare against.">
              OURS ONLY
            </span>
          )}
          {s && !foots && (
            <span className="ml-2 bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  title={`Their statement's own figures do not foot — off by ${fmt(footingGap)}`}>
              THEIRS OFF {fmt(footingGap)}
            </span>
          )}
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-500">{drCr(p.opening)}</td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-600">
          {fmt(p.issued)}
          <span className="text-slate-400 ml-1 text-[10px]">({p.tickets.length})</span>
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
          {s ? drCr(s.closingBalance) : <span className="text-slate-300">—</span>}
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
                className="text-slate-300 hover:text-red-500" title="Delete their statement">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : <span className="text-slate-300 text-[9px]">—</span>}
        </td>
      </tr>

      {open && (
        <tr className="bg-slate-50">
          <td colSpan={10} className="p-0">
            <div className="pl-4 sm:pl-10 pr-4 py-3 space-y-3">
              {/* Our own arithmetic, spelled out, so the closing figure above
                  can be checked by eye rather than taken on trust. */}
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-[11px]
                              font-mono text-slate-600">
                {drCr(p.opening)} + paid {fmt(p.paid)} + refunds {fmt(p.refunded)}
                {' '}− issued {fmt(p.issued)} = <b className="text-slate-800">{drCr(p.closing)}</b>
              </div>

              {s && (
                <div className={`rounded-lg border px-4 py-2.5 text-xs
                  ${Math.abs(p.balanceGap ?? 0) < 0.011
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-600'}`}>
                  <b>{p.statement!.vendorName}'s own statement for these dates</b> opens at{' '}
                  {drCr(s.openingBalance)}, bills {fmt(s.billed)}, records {fmt(s.paid)} paid
                  {s.otherCharges ? ` and ${fmt(s.otherCharges)} of their own charges` : ''}, and closes
                  at {drCr(s.closingBalance)}.
                  {p.billedGap !== null && Math.abs(p.billedGap) >= 0.011 && (
                    <> They billed <b>{fmt(p.billedGap)} {currency}</b>{' '}
                      {p.billedGap > 0 ? 'more' : 'less'} than our rows come to.</>
                  )}
                  {!foots && (
                    <> Their figures do not foot: they come to {drCr(
                      Math.round((s.openingBalance + s.paid - s.billed - s.otherCharges) * 100) / 100)},
                      not the {drCr(s.closingBalance)} printed.</>
                  )}
                </div>
              )}

              {p.payments.length > 0 && (
                <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center
                                  justify-between">
                    <span className="text-[9px] font-bold uppercase text-emerald-700 flex items-center gap-1.5">
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
                          <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500 w-28">{x.date}</td>
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
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-bold
                                uppercase text-slate-500 flex items-center gap-1.5">
                  <FileText className="w-3 h-3" />
                  <span>Our rows in this period ({p.tickets.length})</span>
                </div>
                {p.tickets.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-slate-400 italic">
                    Nothing in the ledger falls inside these dates.
                  </p>
                ) : (
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-left min-w-[560px]">
                      <thead>
                        <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
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
                            <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{t.date}</td>
                            <td className="px-3 py-1.5 font-mono text-[10px] text-slate-700">{t.ticketNo}</td>
                            <td className="px-3 py-1.5 text-slate-600">{t.passengerName}</td>
                            <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
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
                )}
              </div>

              {s && unmatched.length > 0 && (
                <div className="bg-white border border-red-100 rounded-lg px-4 py-2.5 text-xs text-slate-600
                                flex items-start gap-2">
                  <Link2Off className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                  <span>
                    <b>{unmatched.length}</b> of these {unmatched.length === 1 ? 'carries' : 'carry'} no
                    document number from the vendor, so nothing on their side has been matched to
                    {unmatched.length === 1 ? ' it' : ' them'}. {unmatched.length === 1 ? 'It is' : 'They are'} the
                    first place to look for the difference.
                  </span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export const VendorStatements: React.FC<Props> = ({
  statements, tickets, topUps, wallets, onSave, onDelete, canEdit = false,
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
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            Vendor statements
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
            Every figure below is <b>ours</b> — read off our own ledger, period by period, with the same
            arithmetic Vendor Credit uses, so the last closing balance on each table is the balance that
            screen shows to the piastre. Where {STATEMENT_VENDORS.join(' or ')} have issued a statement for
            the same dates, their closing figure sits in the next column and the difference beside it.
            Past their last statement the account keeps moving and only we have it, which is where today's
            balance actually lives.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(blank('Ibtekar'))}
            className="shrink-0 flex items-center gap-1.5 bg-purple-600 text-white text-xs font-bold
                       px-3 py-2 rounded hover:bg-purple-700">
            <Plus className="w-3.5 h-3.5" /> Add statement
          </button>
        )}
      </div>

      <BalanceRange vendors={STATEMENT_VENDORS} statements={statements} tickets={tickets}
        topUps={topUps} wallets={wallets} />

      <DocumentCheck tickets={tickets} onSaveStatement={canEdit ? onSave : undefined} />

      {accounts.map(a => (
        <div key={a.vendorName} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between
                          gap-4 flex-wrap">
            <span className="font-bold text-slate-700 uppercase text-[11px] tracking-wide">
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
                {a.balanceAsOf && <span className="text-[9px] text-slate-400 ml-1.5">
                  as of {a.balanceAsOf}</span>}
              </Stat>
              <Stat label="They last stated">
                <span className={`font-mono font-bold
                  ${(a.statedBalance ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {a.statedBalance === null ? '—' : drCr(a.statedBalance)}
                </span>
                {a.statedAsOf && <span className="text-[9px] text-slate-400 ml-1.5">
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
            <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[880px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[9px] uppercase
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
          )}

          {a.undated > 0 && (
            <p className="px-5 py-2.5 text-[11px] text-slate-500 border-t border-slate-100 bg-slate-50">
              {a.undated} {a.vendorName} row(s) worth {fmt(a.undatedAmount)} {a.currency} carry no date,
              so they cannot be placed in any period above. They are counted in every opening and closing
              figure alike — the wallet counts them — so each period still foots and the closing balance
              still agrees with Vendor Credit.
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
