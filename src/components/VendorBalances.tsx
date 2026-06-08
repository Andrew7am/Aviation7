import React, { useState } from 'react';
import { VendorBalance, BalanceTopUp, Ticket } from '../types';
import { Plus, Trash2, Wallet, ChevronDown, ChevronRight, PlusCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface VendorBalancesProps {
  vendorBalances: VendorBalance[];
  topUps: BalanceTopUp[];
  tickets: Ticket[];
  onSaveVendor: (v: VendorBalance) => void;
  onDeleteVendor: (id: string) => void;
  onTopUp: (topUp: BalanceTopUp) => void;
  currency: string;
}

const SOURCE_TO_VENDOR: Record<string, string[]> = {
  'iata': ['iata'],
  'flynas': ['flynas'],
  'flyadeal ksa': ['flyadeal ksa'],
  'flyadeal dxb': ['flyadeal dxb'],
  'flyadeal': ['flyadeal ksa', 'flyadeal dxb', 'flyadeal'],
  'ibtekar': ['ibtekar'],
  'airarabia': ['airarabia', 'air arabia'],
  'rts': ['rts'],
  'gold medal': ['gold medal', 'goldmedal'],
};

export const VendorBalances: React.FC<VendorBalancesProps> = ({
  vendorBalances, topUps, tickets, onSaveVendor, onDeleteVendor, onTopUp, currency,
}) => {
  const [newName, setNewName] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [topUpVendorId, setTopUpVendorId] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpNote, setTopUpNote] = useState('');

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const getVendorTickets = (vendor: VendorBalance) => {
    const vn = vendor.vendorName.toLowerCase();
    const aliases = SOURCE_TO_VENDOR[vn] ?? [vn];
    return tickets.filter(t =>
      aliases.some(alias => t.source.toLowerCase().includes(alias))
    );
  };

  const getVendorTopUps = (vendorId: string) =>
    topUps.filter(tu => tu.vendorId === vendorId);

  const handleAdd = () => {
    if (!newName.trim() || isNaN(Number(newBalance))) return;
    const id = `vendor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const initial = Number(newBalance);
    onSaveVendor({ id, vendorName: newName.trim(), initialBalance: initial, currentBalance: initial, userId: 'temp' });
    setNewName(''); setNewBalance('');
  };

  const handleTopUpSubmit = (vendor: VendorBalance) => {
    const amt = parseFloat(topUpAmount);
    if (!amt || amt <= 0) return;
    const id = `topup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    onTopUp({
      id,
      vendorId: vendor.id,
      vendorName: vendor.vendorName,
      amount: amt,
      note: topUpNote.trim() || 'Top-up',
      date: new Date().toISOString().split('T')[0],
      userId: 'temp',
    });
    setTopUpVendorId(null);
    setTopUpAmount('');
    setTopUpNote('');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-w-6xl mx-auto overflow-hidden">
      <div className="flex items-center space-x-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
        <Wallet className="text-purple-600 w-5 h-5" />
        <h2 className="text-sm font-bold uppercase text-slate-700 tracking-wider">Vendor Credit Balances</h2>
      </div>

      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-[9px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">
            <th className="py-3 px-4 w-8"></th>
            <th className="py-3 px-4">Vendor</th>
            <th className="py-3 px-4 text-right">Initial</th>
            <th className="py-3 px-4 text-right">Top-ups</th>
            <th className="py-3 px-4 text-right">Issued</th>
            <th className="py-3 px-4 text-right">Remaining</th>
            <th className="py-3 px-4 text-center">Status</th>
            <th className="py-3 px-4 text-center">Actions</th>
          </tr>
        </thead>
        <tbody className="text-sm divide-y divide-slate-100">
          {vendorBalances.map(vendor => {
            const vTickets = getVendorTickets(vendor);
            const vTopUps = getVendorTopUps(vendor.id);
            const totalTopUp = vTopUps.reduce((s, tu) => s + tu.amount, 0);
            const totalIssued = vTickets.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
            const totalRefunds = vTickets.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
            const netIssued = totalIssued - totalRefunds;
            const remaining = vendor.currentBalance;
            const pct = vendor.initialBalance > 0 ? (remaining / vendor.initialBalance) * 100 : 0;
            const isLow = pct < 20 && remaining >= 0;
            const isNeg = remaining < 0;
            const isExpanded = expandedId === vendor.id;
            const isTopUpOpen = topUpVendorId === vendor.id;

            return (
              <React.Fragment key={vendor.id}>
                <tr
                  className={`hover:bg-slate-50 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                  onClick={() => setExpandedId(prev => prev === vendor.id ? null : vendor.id)}
                >
                  <td className="py-3 px-4 text-slate-400">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-700 uppercase text-[11px] tracking-wide">{vendor.vendorName}</td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-slate-500">{fmt(vendor.initialBalance)}</td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-emerald-600">
                    {totalTopUp > 0 ? `+${fmt(totalTopUp)}` : '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-slate-600">{fmt(netIssued)}</td>
                  <td className={`py-3 px-4 text-right font-mono font-bold text-xs ${isNeg ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                    {isNeg ? '-' : ''}{currency} {fmt(Math.abs(remaining))}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex flex-col items-center space-y-1">
                      {isNeg
                        ? <span className="bg-red-100 text-red-700 text-[9px] font-bold px-2 py-0.5 rounded-full">OVERDRAFT</span>
                        : isLow
                        ? <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded-full">LOW ⚠</span>
                        : <span className="bg-emerald-50 text-emerald-600 text-[9px] font-bold px-2 py-0.5 rounded-full">OK</span>
                      }
                      <div className="w-20 bg-slate-100 rounded-full h-1">
                        <div
                          className={`h-1 rounded-full transition-all ${isNeg ? 'w-full bg-red-400' : isLow ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center space-x-2" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setTopUpVendorId(prev => prev === vendor.id ? null : vendor.id)}
                        className="text-emerald-500 hover:text-emerald-700 transition-colors"
                        title="Top-up balance"
                      >
                        <PlusCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDeleteVendor(vendor.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors"
                        title="Delete vendor"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Top-up form */}
                {isTopUpOpen && (
                  <tr className="bg-emerald-50 border-b border-emerald-100">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="flex items-center space-x-3 pl-8">
                        <span className="text-[10px] font-bold uppercase text-emerald-700">Add Balance:</span>
                        <input
                          type="number"
                          placeholder="Amount"
                          value={topUpAmount}
                          onChange={e => setTopUpAmount(e.target.value)}
                          className="border border-emerald-300 bg-white rounded px-2 py-1 text-xs font-mono w-32 focus:outline-none focus:ring-2 ring-emerald-200"
                        />
                        <input
                          type="text"
                          placeholder="Note (optional)"
                          value={topUpNote}
                          onChange={e => setTopUpNote(e.target.value)}
                          className="border border-emerald-300 bg-white rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-2 ring-emerald-200"
                        />
                        <button
                          onClick={() => handleTopUpSubmit(vendor)}
                          disabled={!topUpAmount || parseFloat(topUpAmount) <= 0}
                          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded px-3 py-1 text-[10px] font-bold uppercase transition-colors"
                        >
                          Confirm Top-up
                        </button>
                        <button
                          onClick={() => setTopUpVendorId(null)}
                          className="text-slate-400 hover:text-slate-600 text-[10px] uppercase font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Expanded transaction detail */}
                {isExpanded && (
                  <tr className="bg-slate-50">
                    <td colSpan={8} className="p-0">
                      <div className="pl-12 pr-4 py-3 space-y-3">
                        {/* Top-ups history */}
                        {vTopUps.length > 0 && (
                          <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
                            <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-[9px] font-bold uppercase text-emerald-700 flex items-center space-x-1.5">
                              <TrendingUp className="w-3 h-3" />
                              <span>Balance Top-ups</span>
                            </div>
                            <table className="w-full text-left">
                              <tbody>
                                {vTopUps.map(tu => (
                                  <tr key={tu.id} className="border-b border-slate-50 text-xs hover:bg-slate-50">
                                    <td className="px-4 py-2 text-slate-500 font-mono text-[10px]">{tu.date}</td>
                                    <td className="px-4 py-2 text-slate-600">{tu.note}</td>
                                    <td className="px-4 py-2 text-right font-mono font-bold text-emerald-600">+{fmt(tu.amount)} {currency}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Tickets */}
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-bold uppercase text-slate-500 flex items-center space-x-1.5">
                            <TrendingDown className="w-3 h-3" />
                            <span>Tickets ({vTickets.length})</span>
                          </div>
                          {vTickets.length === 0 ? (
                            <p className="px-4 py-4 text-xs text-slate-400 italic">No tickets linked to this vendor.</p>
                          ) : (
                            <div className="max-h-56 overflow-y-auto">
                              <table className="w-full text-left">
                                <thead>
                                  <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
                                    <th className="px-3 py-2">Date</th>
                                    <th className="px-3 py-2">Ticket No</th>
                                    <th className="px-3 py-2">PNR</th>
                                    <th className="px-3 py-2">Req Num</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2 text-right">Amount</th>
                                    <th className="px-3 py-2 text-right">Impact</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {vTickets.map(t => {
                                    const isRefund = t.amount < 0;
                                    const isCanc = t.amount === 0;
                                    return (
                                      <tr key={t.id} className="border-b border-slate-50 text-xs hover:bg-slate-50 font-mono">
                                        <td className="px-3 py-2 text-slate-400 text-[10px]">{t.date}</td>
                                        <td className="px-3 py-2 text-[10px] text-slate-700">{t.ticketNo}</td>
                                        <td className="px-3 py-2 text-[10px] text-slate-500">{t.pnr || '—'}</td>
                                        <td className="px-3 py-2 text-[10px]">
                                          {t.reqNum
                                            ? <span className="text-blue-600 font-bold">{t.reqNum}</span>
                                            : <span className="text-red-400 italic">missing</span>
                                          }
                                        </td>
                                        <td className="px-3 py-2 text-[9px] font-bold text-slate-400">{t.status || '—'}</td>
                                        <td className="px-3 py-2 text-right text-[10px]">{fmt(Math.abs(t.amount))}</td>
                                        <td className={`px-3 py-2 text-right font-bold text-[10px] ${isCanc ? 'text-slate-400' : isRefund ? 'text-emerald-600' : 'text-red-600'}`}>
                                          {isCanc ? '±0' : isRefund ? `+${fmt(Math.abs(t.amount))}` : `-${fmt(t.amount)}`}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}

          {/* Add new vendor row */}
          <tr className="bg-slate-50/60 border-t-2 border-slate-200">
            <td className="py-3 px-4"></td>
            <td className="py-3 px-4">
              <input
                type="text"
                placeholder="Vendor name (e.g. Flynas)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className="bg-white border border-slate-200 rounded px-2 py-1 text-xs font-bold uppercase w-full focus:outline-none focus:ring-2 ring-purple-100 focus:border-purple-400 placeholder:font-normal placeholder:normal-case placeholder:text-slate-300"
              />
            </td>
            <td className="py-3 px-4 text-right" colSpan={3}>
              <input
                type="number"
                placeholder="Initial balance"
                value={newBalance}
                onChange={e => setNewBalance(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className="bg-white border border-slate-200 rounded px-2 py-1 text-xs font-mono w-36 text-right focus:outline-none focus:ring-2 ring-purple-100 focus:border-purple-400"
              />
            </td>
            <td colSpan={2}></td>
            <td className="py-3 px-4 text-center">
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || isNaN(Number(newBalance))}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded p-1.5 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
