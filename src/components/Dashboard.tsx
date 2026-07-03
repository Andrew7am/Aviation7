import React, { useMemo } from 'react';
import { Ticket, VendorBalance, BalanceTopUp } from '../types';
import { useReports } from '../hooks/useReports';
import { TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Wallet, FileText } from 'lucide-react';

interface DashboardProps {
  tickets: Ticket[];
  vendorBalances: VendorBalance[];
  topUps?: BalanceTopUp[];
  currency?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ tickets, vendorBalances, topUps = [], currency = 'SAR' }) => {
  // Centralized stats — single source of truth, shared with Reports.tsx
  const { totalIssued, totalRefunds, bySource: sources, missingReq } = useReports(tickets, vendorBalances, topUps);

  const needsReqCount = missingReq.length;
  const matchedCount = tickets.length - needsReqCount;
  const duplicateCount = tickets.filter(t => t.isDuplicate).length;

  const lowBalanceVendors = vendorBalances.filter(v => {
    if (v.initialBalance <= 0) return false;
    return v.currentBalance < v.initialBalance * 0.2;
  });

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col h-full bg-slate-100">
      <div className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Dashboard Overview</h2>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 shrink-0">
        {[
          { label: 'Total Tickets', value: tickets.length, color: 'slate', icon: <FileText className="w-4 h-4" />, sub: `${currency} ${fmt(totalIssued - totalRefunds)} net` },
          { label: 'Matched', value: matchedCount, color: 'emerald', icon: <CheckCircle2 className="w-4 h-4" />, sub: `${((matchedCount / Math.max(tickets.length, 1)) * 100).toFixed(0)}% match rate` },
          { label: 'Missing REQ', value: needsReqCount, color: 'red', icon: <AlertCircle className="w-4 h-4" />, sub: 'need req number' },
          { label: 'Duplicates', value: duplicateCount, color: 'amber', icon: <AlertCircle className="w-4 h-4" />, sub: 'in current dataset' },
        ].map(card => (
          <div key={card.label} className={`bg-white border border-${card.color}-100 rounded-lg p-4 shadow-sm`}>
            <div className={`flex items-center justify-between mb-2 text-${card.color}-500`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider text-${card.color}-600`}>{card.label}</span>
              {card.icon}
            </div>
            <div className={`text-3xl font-mono font-black text-${card.color}-700`}>{card.value}</div>
            <div className={`text-[10px] text-${card.color}-400 mt-1 font-mono`}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4 flex-1 min-h-0 overflow-auto">
        {/* Source breakdown */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Source Breakdown</h3>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[9px] uppercase text-slate-400 tracking-wider">
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2 text-right">Tickets</th>
                <th className="px-4 py-2 text-right">Net Amount</th>
                <th className="px-4 py-2 text-right">Missing REQ</th>
              </tr>
            </thead>
            <tbody className="text-xs font-mono">
              {sources.map(s => (
                <tr key={s.name} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-sans font-bold text-slate-700 text-[11px]">{s.name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{s.count}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${s.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {currency} {fmt(s.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {s.missing > 0
                      ? <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[9px] font-bold">{s.missing}</span>
                      : <span className="text-slate-300 text-[9px]">—</span>
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

        {/* Vendor balances summary */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Vendor Credit Status</h3>
            {lowBalanceVendors.length > 0 && (
              <span className="bg-red-100 text-red-700 text-[9px] font-bold px-2 py-0.5 rounded-full">
                {lowBalanceVendors.length} LOW
              </span>
            )}
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[9px] uppercase text-slate-400 tracking-wider">
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
                  <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-sans font-bold text-slate-700 text-[11px] uppercase">{v.vendorName}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {isNeg && '-'}{currency} {fmt(Math.abs(v.currentBalance))}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <div className="w-16 bg-slate-100 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${isNeg ? 'w-full bg-red-500' : isLow ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                          />
                        </div>
                        <span className={`text-[9px] ${isLow ? 'text-amber-600' : 'text-slate-400'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {isNeg
                        ? <span className="bg-red-100 text-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded">OVERDRAFT</span>
                        : isLow
                        ? <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded">LOW</span>
                        : <span className="bg-emerald-50 text-emerald-600 text-[9px] font-bold px-1.5 py-0.5 rounded">OK</span>
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

        {/* Financial summary */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Financial Summary</h3>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100">
            <div className="p-4">
              <div className="flex items-center space-x-2 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-bold uppercase text-slate-500">Total Issued</span>
              </div>
              <div className="text-xl font-mono font-black text-emerald-700">{currency} {fmt(totalIssued)}</div>
              <div className="text-[10px] text-slate-400 mt-1">{tickets.filter(t => t.amount > 0).length} tickets</div>
            </div>
            <div className="p-4">
              <div className="flex items-center space-x-2 mb-1">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <span className="text-[10px] font-bold uppercase text-slate-500">Total Refunds</span>
              </div>
              <div className="text-xl font-mono font-black text-red-700">{currency} {fmt(totalRefunds)}</div>
              <div className="text-[10px] text-slate-400 mt-1">{tickets.filter(t => t.amount < 0).length} tickets</div>
            </div>
            <div className="p-4">
              <div className="flex items-center space-x-2 mb-1">
                <Wallet className="w-4 h-4 text-blue-500" />
                <span className="text-[10px] font-bold uppercase text-slate-500">Net Total</span>
              </div>
              <div className={`text-xl font-mono font-black ${(totalIssued - totalRefunds) < 0 ? 'text-red-700' : 'text-blue-700'}`}>
                {currency} {fmt(totalIssued - totalRefunds)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">across all sources</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
