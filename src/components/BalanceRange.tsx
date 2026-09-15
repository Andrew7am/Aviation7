import React, { useMemo, useState } from 'react';
import { Ticket, VendorStatement, VendorBalance, BalanceTopUp } from '../types';
import {
  CalendarRange, ArrowRight, TrendingDown, TrendingUp, Wallet, Info, AlertTriangle,
} from 'lucide-react';
import { balanceOverRange, Payment } from '../core/helpers/statementMath';

/**
 * The account between two dates the user picks, rather than the ones the
 * vendor cut on.
 *
 * "What was the balance on the 1st, what is it on the 15th, and what went out
 * and came back in between" is the question actually asked of these accounts,
 * and no statement answers it: Ibtekar's first period runs 01/08 to 14/09
 * because that is when someone happened to print it.
 *
 * The opening figure is carried from the last balance the vendor stated, using
 * our own rows for the days since. Where it came from is shown with it, every
 * time — a balance the vendor signed and a balance we worked out are not the
 * same kind of thing, and a screen that prints them identically invites them
 * to be trusted identically.
 */
const fmt = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drCr = (n: number) => `${fmt(n)} ${n < 0 ? 'Dr' : 'Cr'}`;

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';

interface Props {
  vendors: string[];
  statements: VendorStatement[];
  tickets: Ticket[];
  topUps: BalanceTopUp[];
  wallets: VendorBalance[];
}

const ANCHOR_STYLE = {
  statement: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  wallet:    'bg-amber-50 border-amber-200 text-amber-800',
  none:      'bg-slate-50 border-slate-200 text-slate-600',
} as const;

const TicketList: React.FC<{
  title: string; rows: Ticket[]; total: number; currency: string;
  tone: 'out' | 'in'; icon: React.ReactNode;
}> = ({ title, rows, total, currency, tone, icon }) => (
  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
      <span className="text-[9px] font-bold uppercase text-slate-500 flex items-center gap-1.5">
        {icon}{title} ({rows.length})
      </span>
      <span className={`font-mono text-xs font-bold ${tone === 'in' ? 'text-emerald-600' : 'text-slate-700'}`}>
        {tone === 'in' ? '+' : '−'}{fmt(total)} {currency}
      </span>
    </div>
    {rows.length === 0 ? (
      <p className="px-4 py-3 text-xs text-slate-400 italic">Nothing in these dates.</p>
    ) : (
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Ticket</th>
              <th className="px-3 py-2">Passenger</th>
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.id} className="border-b border-slate-50 text-xs">
                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{t.date}</td>
                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-700">
                  {t.airlineCode ? `${t.airlineCode}-${t.ticketNo}` : t.ticketNo}
                </td>
                <td className="px-3 py-1.5 text-slate-600">{t.passengerName}</td>
                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                  {t.vendorReference || <span className="text-slate-300">—</span>}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono
                  ${tone === 'in' ? 'text-emerald-600' : 'text-slate-700'}`}>
                  {fmt(t.amount || 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export const BalanceRange: React.FC<Props> = ({
  vendors, statements, tickets, topUps, wallets,
}) => {
  const [vendor, setVendor] = useState(vendors[0] ?? 'Ibtekar');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const payments: Payment[] = useMemo(
    () => topUps.map(t => ({
      id: t.id, vendorName: t.vendorName, amount: t.amount, date: t.date, note: t.note,
    })),
    [topUps],
  );

  const wallet = useMemo(
    () => wallets.find(w => w.vendorName === vendor),
    [wallets, vendor],
  );

  const r = useMemo(
    () => balanceOverRange(vendor, from, to, statements, tickets, payments,
      wallet ? { initialBalance: wallet.initialBalance, openingDate: wallet.openingDate } : undefined),
    [vendor, from, to, statements, tickets, payments, wallet],
  );

  const bad = from > to;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <h3 className="font-bold text-slate-700 uppercase text-[11px] tracking-wide flex items-center gap-2 mr-auto">
          <CalendarRange className="w-3.5 h-3.5 text-purple-600" />
          The account between two dates
        </h3>
        <select value={vendor} onChange={e => setVendor(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-bold">
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-mono" />
        <ArrowRight className="w-3 h-3 text-slate-300" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-mono" />
      </div>

      <div className="p-5 space-y-4">
        {bad ? (
          <div className="bg-amber-50 border border-amber-200 rounded px-4 py-3 text-xs text-amber-800
                          flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            The first date is after the second one.
          </div>
        ) : (
          <>
            {/* The five figures, in the order the arithmetic runs. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-center">
              {([
                ['Balance on ' + from,
                 r.openingBalance === null ? '—' : drCr(r.openingBalance),
                 r.openingBalance === null ? 'text-slate-300'
                   : r.openingBalance < 0 ? 'text-red-600' : 'text-emerald-700'],
                ['Issued', `−${fmt(r.issued)}`, 'text-slate-700'],
                ['Refunded', r.refunded ? `+${fmt(r.refunded)}` : '—', 'text-emerald-600'],
                ['Paid to them', r.paid ? `+${fmt(r.paid)}` : '—', 'text-emerald-600'],
                ['Balance on ' + to,
                 r.closingBalance === null ? '—' : drCr(r.closingBalance),
                 r.closingBalance === null ? 'text-slate-300'
                   : r.closingBalance < 0 ? 'text-red-600' : 'text-emerald-700'],
              ] as const).map(([label, value, cls]) => (
                <div key={label} className="bg-slate-50 border border-slate-200 rounded px-2 py-2.5">
                  <div className={`font-mono font-bold text-sm ${cls}`}>{value}</div>
                  <div className="text-[9px] uppercase text-slate-400 font-bold mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            <div className={`rounded-lg border px-4 py-2.5 text-[11px] flex items-start gap-2
              ${ANCHOR_STYLE[r.anchor]}`}>
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{r.anchorLabel}</span>
            </div>

            {/* The other balance, and what the two disagree by.
                
                The figure above is the vendor's, carried forward. The one here
                is ours from the beginning — the same arithmetic Vendor Credit
                does, so on today's date it is the number that screen shows, to
                the piastre. They answer different questions and for NSA they
                differ by 32,940.30, all of it reconciliation difference. Two
                screens printing different balances with nothing between them
                invites the reader to decide one is broken. */}
            {r.ledgerBalance !== null && (
              <div className={`rounded-lg border px-4 py-3 text-xs
                ${r.balanceGap !== null && Math.abs(r.balanceGap) < 0.011
                  ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                  <span className="text-slate-600">
                    Our own books on {to} — opening balance, every payment, every ticket:
                  </span>
                  <span className={`font-mono font-bold text-sm
                    ${r.ledgerBalance < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {drCr(r.ledgerBalance)}
                  </span>
                </div>
                {r.balanceGap !== null && (
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 mt-2 pt-2
                                  border-t border-slate-100">
                    <span className="text-slate-500 text-[11px]">
                      {Math.abs(r.balanceGap) < 0.011
                        ? `This agrees with ${vendor}'s own figure.`
                        : `Our books and ${vendor}'s figure disagree. Every period's difference is `
                          + `listed below; this is all of them added up.`}
                    </span>
                    <span className={`font-mono font-bold text-xs
                      ${Math.abs(r.balanceGap) < 0.011 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Math.abs(r.balanceGap) < 0.011 ? 'no difference'
                        : `${r.balanceGap > 0 ? '+' : '−'}${fmt(r.balanceGap)} ${r.currency}`}
                    </span>
                  </div>
                )}
              </div>
            )}

            {r.undated > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded px-4 py-2 text-[11px] text-slate-500">
                {r.undated} {vendor} row(s) carry no date at all, so they cannot be placed in these
                dates or outside them. They are in no period on this screen.
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <TicketList title="Issued" rows={r.issues} total={r.issued} currency={r.currency}
                tone="out" icon={<TrendingDown className="w-3 h-3" />} />
              <TicketList title="Refunded" rows={r.refunds} total={r.refunded} currency={r.currency}
                tone="in" icon={<TrendingUp className="w-3 h-3" />} />
            </div>

            {r.payments.length > 0 && (
              <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase text-emerald-700 flex items-center gap-1.5">
                    <Wallet className="w-3 h-3" /> Paid to {vendor} ({r.payments.length})
                  </span>
                  <span className="font-mono text-xs font-bold text-emerald-600">
                    +{fmt(r.paid)} {r.currency}
                  </span>
                </div>
                <table className="w-full text-left">
                  <tbody>
                    {r.payments.map(p => (
                      <tr key={p.id} className="border-b border-slate-50 text-xs">
                        <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500 w-28">{p.date}</td>
                        <td className="px-3 py-1.5 text-slate-600">{p.note}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-emerald-600">
                          +{fmt(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default BalanceRange;
