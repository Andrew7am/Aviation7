import React, { useMemo, useState } from 'react';
import { Ticket, VendorStatement } from '../types';
import {
  FileText, Plus, Trash2, X, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Edit3, Link2Off,
} from 'lucide-react';
import {
  summariseVendor, unmatchedInPeriod, StatementCheck,
} from '../core/helpers/statementMath';

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
  onSave: (s: VendorStatement) => void;
  onDelete: (id: string) => void;
  canEdit?: boolean;
}

const blank = (vendor: string): VendorStatement => ({
  id: `stm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  vendorName: vendor,
  periodStart: today().slice(0, 8) + '01',
  periodEnd: today(),
  currency: vendor === 'NSA' ? 'SAR' : 'SAR',
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
          <div className="grid grid-cols-3 gap-4">
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

          <div className="grid grid-cols-2 gap-4">
            <Num label="Opening balance" value={s.openingBalance}
                 hint="As the statement prints it. Positive for their Cr — credit in our favour. Negative for Dr."
                 onChange={n => set({ openingBalance: n })} />
            <Num label="Closing balance" value={s.closingBalance}
                 hint="Their “Amount payable to you”, same sign rule."
                 onChange={n => set({ closingBalance: n })} />
          </div>

          <div className="grid grid-cols-3 gap-4">
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

          <div className="grid grid-cols-2 gap-4">
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

const GapCell: React.FC<{ n: number; currency: string }> = ({ n, currency }) => {
  const clear = Math.abs(n) < 0.011;
  return (
    <span className={`font-mono font-bold text-xs ${clear ? 'text-emerald-600' : 'text-red-600'}`}>
      {clear ? '—' : `${n > 0 ? '+' : '−'}${fmt(n)} ${currency}`}
    </span>
  );
};

const PeriodRow: React.FC<{
  c: StatementCheck; currency: string; canEdit: boolean;
  onEdit: () => void; onDelete: () => void;
}> = ({ c, currency, canEdit, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const s = c.statement;
  const unmatched = useMemo(() => unmatchedInPeriod(c), [c]);

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
          onClick={() => setOpen(o => !o)}>
        <td className="py-3 px-3 text-slate-400">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </td>
        <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
          {s.periodStart} → {s.periodEnd}
          {c.chainGap !== null && Math.abs(c.chainGap) >= 0.011 && (
            <span className="ml-2 bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  title="This period does not open where the last one closed — a statement in between is missing.">
              GAP {fmt(c.chainGap)}
            </span>
          )}
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-500">{drCr(s.openingBalance)}</td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-600">{fmt(s.billed)}</td>
        <td className="py-3 px-3 text-right font-mono text-xs text-emerald-600">
          {s.paid ? `+${fmt(s.paid)}` : '—'}
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-amber-600">
          {s.otherCharges ? fmt(s.otherCharges) : '—'}
        </td>
        <td className={`py-3 px-3 text-right font-mono font-bold text-xs
          ${s.closingBalance < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          {drCr(s.closingBalance)}
        </td>
        <td className="py-3 px-3 text-right font-mono text-xs text-slate-600">
          {fmt(c.ledgerBilled)}
          <span className="text-slate-400 ml-1 text-[10px]">({c.ledgerRows})</span>
        </td>
        <td className="py-3 px-3 text-right"><GapCell n={c.billedGap} currency={currency} /></td>
        <td className="py-3 px-3 text-center">
          {c.foots
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" />
            : <span title={`The statement's own numbers do not foot — off by ${fmt(c.footingGap)}`}>
                <AlertTriangle className="w-4 h-4 text-amber-500 inline" />
              </span>}
        </td>
        <td className="py-3 px-3 text-center" onClick={e => e.stopPropagation()}>
          {canEdit ? (
            <div className="flex items-center justify-center gap-2">
              <button onClick={onEdit} className="text-slate-400 hover:text-purple-600" title="Edit">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { if (confirm(`Delete the ${s.periodStart} → ${s.periodEnd} statement?`)) onDelete(); }}
                className="text-slate-300 hover:text-red-500" title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : <span className="text-slate-300 text-[9px]">—</span>}
        </td>
      </tr>

      {open && (
        <tr className="bg-slate-50">
          <td colSpan={11} className="p-0">
            <div className="pl-10 pr-4 py-3 space-y-3">
              {!c.foots && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-800">
                  <b>This statement does not foot.</b> Its own figures come to {drCr(c.impliedClosing)},
                  and it prints {drCr(s.closingBalance)} — a difference of {fmt(c.footingGap)} {currency}.
                  Something on the statement has not been entered; the comparison below is unreliable until it is.
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-bold
                                uppercase text-slate-500 flex items-center gap-1.5">
                  <FileText className="w-3 h-3" />
                  <span>Our rows in this period ({c.tickets.length})</span>
                </div>
                {c.tickets.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-slate-400 italic">
                    Nothing in the ledger falls inside these dates.
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-left">
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
                        {c.tickets.map(t => (
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

              {unmatched.length > 0 && (
                <div className="bg-white border border-red-100 rounded-lg px-4 py-2.5 text-xs text-slate-600
                                flex items-start gap-2">
                  <Link2Off className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                  <span>
                    <b>{unmatched.length}</b> of these {unmatched.length === 1 ? 'carries' : 'carry'} no
                    document number from the vendor, so nothing on their side has been matched to
                    {unmatched.length === 1 ? ' it' : ' them'}. {unmatched.length === 1 ? 'It is' : 'They are'} the
                    first place to look for the {fmt(c.billedGap)} {currency} difference.
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
  statements, tickets, onSave, onDelete, canEdit = false,
}) => {
  const [editing, setEditing] = useState<VendorStatement | null>(null);

  const summaries = useMemo(
    () => STATEMENT_VENDORS.map(v => summariseVendor(v, statements, tickets)),
    [statements, tickets],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            Vendor statements
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
            Ibtekar and NSA are settled on their books, not ours: we issue on their stock and they adjust
            the account afterwards with fees and corrections that never reach us as tickets. Each period
            below is their own statement — opening balance, what they billed, what we paid — set against
            what our ledger recorded for the same dates.
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

      {summaries.map(sum => (
        <div key={sum.vendorName} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-bold text-slate-700 uppercase text-[11px] tracking-wide">
                {sum.vendorName}
              </span>
              {sum.hasChainBreak && (
                <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded-full">
                  A PERIOD IS MISSING
                </span>
              )}
            </div>
            <div className="flex items-center gap-6 text-right">
              <div>
                <div className="text-[9px] uppercase text-slate-400 font-bold">Their balance</div>
                <div className={`font-mono text-sm font-bold
                  ${(sum.latestClosing ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {sum.latestClosing === null ? '—' : drCr(sum.latestClosing)}
                  {sum.latestAsOf && <span className="text-[9px] text-slate-400 ml-1.5">
                    as of {sum.latestAsOf}</span>}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-slate-400 font-bold">Difference to us</div>
                <div className="text-sm"><GapCell n={sum.totalBilledGap} currency={sum.currency} /></div>
              </div>
            </div>
          </div>

          {sum.checks.length === 0 ? (
            <p className="px-5 py-8 text-xs text-slate-400 italic text-center">
              No statement entered for {sum.vendorName} yet.
              {canEdit && ' Use “Add statement” and copy the figures off their statement of account.'}
            </p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[9px] uppercase
                               tracking-wider text-slate-400">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Opening</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Their charges</th>
                  <th className="px-3 py-2 text-right">Closing</th>
                  <th className="px-3 py-2 text-right">Our ledger</th>
                  <th className="px-3 py-2 text-right">Difference</th>
                  <th className="px-3 py-2 text-center">Foots</th>
                  <th className="px-3 py-2 text-center w-20" />
                </tr>
              </thead>
              <tbody>
                {sum.checks.map(c => (
                  <PeriodRow key={c.statement.id} c={c} currency={sum.currency} canEdit={canEdit}
                    onEdit={() => setEditing(c.statement)}
                    onDelete={() => onDelete(c.statement.id)} />
                ))}
              </tbody>
            </table>
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
