import React, { useMemo } from 'react';
import { Ticket, VendorBalance, BalanceTopUp } from '../types';
import { useReports } from '../hooks/useReports';
import { sourceToCurrency, ticketCurrency } from '../core/helpers/sourceCurrency';
import { TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Wallet, FileText } from 'lucide-react';

interface DashboardProps {
  tickets: Ticket[];
  vendorBalances: VendorBalance[];
  topUps?: BalanceTopUp[];
}

/** The icon chip of a KPI card, per tone. */
const TONE: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-500',
};

export const Dashboard: React.FC<DashboardProps> = ({ tickets, vendorBalances, topUps = [] }) => {
  // Centralized stats — single source of truth, shared with Reports.tsx
  const { totalIssued, totalRefunds, bySource: sources, missingReq } = useReports(tickets, vendorBalances, topUps);

  const needsReqCount = missingReq.length;
  const matchedCount = tickets.length - needsReqCount;
  const duplicateCount = tickets.filter(t => t.isDuplicate).length;

  const lowBalanceVendors = vendorBalances.filter(v => {
    if (v.initialBalance <= 0) return false;
    return v.currentBalance < v.initialBalance * 0.2;
  });

  const sarNet = useMemo(() => tickets.filter(t => ticketCurrency(t) === 'SAR').reduce((s, t) => s + t.amount, 0), [tickets]);
  const aedNet = useMemo(() => tickets.filter(t => ticketCurrency(t) === 'AED').reduce((s, t) => s + t.amount, 0), [tickets]);
  const sarIssued = useMemo(() => tickets.filter(t => ticketCurrency(t) === 'SAR' && t.amount > 0).reduce((s, t) => s + t.amount, 0), [tickets]);
  const aedIssued = useMemo(() => tickets.filter(t => ticketCurrency(t) === 'AED' && t.amount > 0).reduce((s, t) => s + t.amount, 0), [tickets]);
  const sarRefundsAmt = useMemo(() => tickets.filter(t => ticketCurrency(t) === 'SAR' && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0), [tickets]);
  const aedRefundsAmt = useMemo(() => tickets.filter(t => ticketCurrency(t) === 'AED' && t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0), [tickets]);

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col min-h-full lg:h-full bg-app">
      <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-white shrink-0">
        <h2 className="text-base font-semibold text-slate-900">Dashboard</h2>
        <p className="text-xs text-slate-500 mt-0.5">The ledger at a glance: what is recorded, matched and still owed a request.</p>
      </div>

      {/* KPI cards. The figure is the card: large, in ink, not in colour. The
          colour sits in the small icon chip and only says something when
          there is something to say - a red chip for missing requests when
          there are some, a quiet one when there are none - and the line
          under the figure says it in words as well. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 shrink-0">
        {[
          { label: 'Total tickets', value: tickets.length, tone: 'blue', icon: <FileText className="w-4 h-4" />, sub: `SAR ${fmt(sarNet)} · AED ${fmt(aedNet)}` },
          { label: 'Matched', value: matchedCount, tone: 'emerald', icon: <CheckCircle2 className="w-4 h-4" />, sub: `${((matchedCount / Math.max(tickets.length, 1)) * 100).toFixed(0)}% match rate` },
          { label: 'Missing REQ', value: needsReqCount, tone: needsReqCount > 0 ? 'red' : 'slate', icon: <AlertCircle className="w-4 h-4" />, sub: needsReqCount > 0 ? 'need a request number' : 'none missing' },
          { label: 'Duplicates', value: duplicateCount, tone: duplicateCount > 0 ? 'amber' : 'slate', icon: <AlertCircle className="w-4 h-4" />, sub: duplicateCount > 0 ? 'in the current dataset' : 'none found' },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-lg p-4 shadow-[0_1px_2px_rgba(17,28,45,0.04)]">
            {/* shrink-0 on the icon and min-w-0 on the label: two cards
                across a phone leaves the label wider than the card, and flex
                answers that by squeezing the icon to nothing rather than
                letting the label wrap. */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-mini font-semibold uppercase tracking-wider min-w-0 text-slate-500">{card.label}</span>
              <span className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${TONE[card.tone]}`}>{card.icon}</span>
            </div>
            <div className="text-2xl sm:text-[1.75rem] leading-none font-semibold text-slate-900 tracking-tight">
              {card.value.toLocaleString('en-US')}
            </div>
            <div className="text-mini text-slate-500 mt-2 font-mono truncate" title={card.sub}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Below lg this is an ordinary stack that grows with its content and
          lets the page scroll; only at lg does it become a pane that fills the
          viewport and scrolls inside itself.
          
          It had to stop being height-constrained rather than merely be told to
          pack its rows to the top. Each card holds a table in a sideways
          scroller, and a scroll container's automatic minimum size is zero —
          so the cards could be squeezed to nothing, the grid split the height
          three equal ways, and each card clipped its own table. Source
          Breakdown showed two vendors of twelve and cut the second in half. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4
                      lg:flex-1 lg:min-h-0 lg:overflow-auto">
        {/* Source breakdown.
        
            A flex column with the heading pinned and the table scrolling
            inside it. At lg the grid still stretches the card to fill the
            viewport, and a card that clips is fine as long as its contents can
            be reached — before this they could not: twelve vendors in a card
            sized for eight, with the last two cut in half and no way to scroll
            to them, because the card clipped and the grid had nothing to
            scroll. */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(17,28,45,0.04)] overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 shrink-0">
            <h3 className="text-sm font-semibold text-slate-800">Source breakdown</h3>
          </div>
          <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-left min-w-[440px]">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-micro uppercase text-slate-500 tracking-wider">
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2 text-right">Tickets</th>
                <th className="px-4 py-2 text-right">Net Amount</th>
                <th className="px-4 py-2 text-right">Missing REQ</th>
              </tr>
            </thead>
            <tbody className="text-xs font-mono">
              {sources.map(s => (
                <tr key={s.name} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-sans font-semibold text-slate-800 text-xs">{s.name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{s.count}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${s.amount < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                    {sourceToCurrency(s.name)} {fmt(s.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {s.missing > 0
                      ? <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-micro font-bold">{s.missing}</span>
                      : <span className="text-slate-300 text-micro">—</span>
                    }
                  </td>
                </tr>
              ))}
              {sources.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400 font-sans text-xs">No tickets imported yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Vendor balances summary */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(17,28,45,0.04)] overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center shrink-0">
            <h3 className="text-sm font-semibold text-slate-800">Vendor credit status</h3>
            {lowBalanceVendors.length > 0 && (
              <span className="bg-red-100 text-red-700 text-micro font-bold px-2 py-0.5 rounded-full">
                {lowBalanceVendors.length} LOW
              </span>
            )}
          </div>
          <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-left min-w-[440px]">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-micro uppercase text-slate-500 tracking-wider">
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2 text-right">Usage</th>
                <th className="px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="text-xs font-mono">
              {vendorBalances.map(v => {
                const pct = v.initialBalance > 0 ? (v.currentBalance / v.initialBalance) * 100 : 100;
                const isLow = pct < 20;
                const isNeg = v.currentBalance < 0;
                return (
                  <tr key={v.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-sans font-semibold text-slate-800 text-xs uppercase">{v.vendorName}</td>
                    <td className={`px-4 py-2.5 text-right font-bold whitespace-nowrap ${isNeg ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {isNeg && '-'}{sourceToCurrency(v.vendorName)} {fmt(Math.abs(v.currentBalance))}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <div className="w-16 bg-slate-100 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${isNeg ? 'w-full bg-red-500' : isLow ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                          />
                        </div>
                        <span className={`text-micro ${isLow ? 'text-amber-600' : 'text-slate-400'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {isNeg
                        ? <span className="bg-red-100 text-red-700 text-micro font-bold px-1.5 py-0.5 rounded">OVERDRAFT</span>
                        : isLow
                        ? <span className="bg-amber-100 text-amber-700 text-micro font-bold px-1.5 py-0.5 rounded">LOW</span>
                        : <span className="bg-emerald-50 text-emerald-600 text-micro font-bold px-1.5 py-0.5 rounded">OK</span>
                      }
                    </td>
                  </tr>
                );
              })}
              {vendorBalances.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400 font-sans text-xs">No vendors configured yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Financial summary */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(17,28,45,0.04)] overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">Financial summary</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 text-center">
            <div className="p-4">
              <div className="flex items-center space-x-2 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-mini font-bold uppercase text-slate-500">Total Issued</span>
              </div>
              <div className="text-sm font-mono font-black text-emerald-700">SAR {fmt(sarIssued)}</div>
              <div className="text-sm font-mono font-black text-emerald-600">AED {fmt(aedIssued)}</div>
              <div className="text-mini text-slate-400 mt-1">{tickets.filter(t => t.amount > 0).length} tickets</div>
            </div>
            <div className="p-4">
              <div className="flex items-center space-x-2 mb-1">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <span className="text-mini font-bold uppercase text-slate-500">Total Refunds</span>
              </div>
              <div className="text-sm font-mono font-black text-red-700">SAR {fmt(sarRefundsAmt)}</div>
              <div className="text-sm font-mono font-black text-red-600">AED {fmt(aedRefundsAmt)}</div>
              <div className="text-mini text-slate-400 mt-1">{tickets.filter(t => t.amount < 0).length} tickets</div>
            </div>
            <div className="p-4">
              <div className="flex items-center space-x-2 mb-1">
                <Wallet className="w-4 h-4 text-blue-500" />
                <span className="text-mini font-bold uppercase text-slate-500">Net Total</span>
              </div>
              <div className={`text-sm font-mono font-black ${sarNet < 0 ? 'text-red-700' : 'text-blue-700'}`}>
                SAR {fmt(sarNet)}
              </div>
              <div className={`text-sm font-mono font-black ${aedNet < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                AED {fmt(aedNet)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
