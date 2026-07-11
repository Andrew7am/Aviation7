import React, { useState } from 'react';
import { VendorBalance, BalanceTopUp, Ticket } from '../types';
import {
  Plus, Trash2, Wallet, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, X, PlusCircle, Edit3
} from 'lucide-react';

interface VendorBalancesProps {
  vendorBalances: VendorBalance[];
  topUps: BalanceTopUp[];
  tickets: Ticket[];
  onSaveVendor: (v: VendorBalance) => void;
  onDeleteVendor: (id: string) => void;
  onTopUp: (topUp: BalanceTopUp) => void;
  currency: string;
}

// Known aliases for edge cases (spaces, abbreviations, etc.)
const VENDOR_ALIASES: Record<string, string[]> = {
  'flyadeal':   ['flyadeal ksa', 'flyadeal dxb', 'flyadeal'],
  'airarabia':  ['airarabia', 'air arabia'],
  'gold medal': ['gold medal', 'goldmedal'],
};

/**
 * Dynamic vendor↔ticket matching:
 * 1. Check alias table first (handles known edge cases)
 * 2. Fallback: source includes vendor name OR vendor name includes source
 * → Any custom vendor will auto-match tickets whose source contains that name
 */
function vendorTicketMatcher(vendorName: string, ticketSource: string): boolean {
  const vn = vendorName.toLowerCase().trim();
  const src = ticketSource.toLowerCase().trim();
  if (!vn || !src) return false;
  const aliases = VENDOR_ALIASES[vn];
  if (aliases) return aliases.some(a => src.includes(a));
  return src.includes(vn) || vn.includes(src);
}

const PRESET_VENDORS = [
  'IATA', 'Flynas', 'FlyAdeal KSA', 'FlyAdeal DXB',
  'FlyDubai', 'AirArabia', 'RTS', 'Ibtekar', 'Gold Medal', 'NSA',
];

type ModalMode = null | 'add_existing' | 'add_new' | 'topup';

export const VendorBalances: React.FC<VendorBalancesProps> = ({
  vendorBalances, topUps, tickets, onSaveVendor, onDeleteVendor, onTopUp, currency,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [topUpVendorId, setTopUpVendorId] = useState<string | null>(null);

  // Add existing vendor modal state
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetBalance, setPresetBalance] = useState('');

  // Add new (custom) vendor modal state
  const [customName, setCustomName] = useState('');
  const [customBalance, setCustomBalance] = useState('');

  // Top-up modal state
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpNote, setTopUpNote] = useState('');

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ── helpers ── */
  const getVendorTickets = (vendor: VendorBalance) =>
    tickets.filter(t => vendorTicketMatcher(vendor.vendorName, t.source));

  const getVendorTopUps = (vendorId: string) =>
    topUps.filter(tu => tu.vendorId === vendorId);

  const existingVendorNames = vendorBalances.map(v => v.vendorName.toLowerCase());
  const availablePresets = PRESET_VENDORS.filter(
    p => !existingVendorNames.includes(p.toLowerCase())
  );

  /* ── handlers ── */
  const closeModal = () => {
    setModalMode(null);
    setSelectedPreset('');
    setPresetBalance('');
    setCustomName('');
    setCustomBalance('');
    setTopUpVendorId(null);
    setTopUpAmount('');
    setTopUpNote('');
  };

  const handleAddPreset = () => {
    if (!selectedPreset || isNaN(Number(presetBalance))) return;
    const id = `vendor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const initial = Number(presetBalance);
    onSaveVendor({
      id, vendorName: selectedPreset,
      initialBalance: initial, currentBalance: initial, userId: 'temp',
    });
    closeModal();
  };

  const handleAddCustom = () => {
    if (!customName.trim() || isNaN(Number(customBalance))) return;
    const id = `vendor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const initial = Number(customBalance);
    onSaveVendor({
      id, vendorName: customName.trim(),
      initialBalance: initial, currentBalance: initial, userId: 'temp',
    });
    closeModal();
  };

  const handleTopUpSubmit = () => {
    const vendor = vendorBalances.find(v => v.id === topUpVendorId);
    const amt = parseFloat(topUpAmount);
    if (!vendor || !amt || amt <= 0) return;
    const id = `topup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    onTopUp({
      id, vendorId: vendor.id, vendorName: vendor.vendorName,
      amount: amt,
      note: topUpNote.trim() || 'Balance Top-up',
      date: new Date().toISOString().split('T')[0],
      userId: 'temp',
    });
    closeModal();
  };

  const openTopUp = (vendorId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTopUpVendorId(vendorId);
    setModalMode('topup');
  };

  const topUpVendor = vendorBalances.find(v => v.id === topUpVendorId);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-w-6xl mx-auto overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center space-x-3">
          <Wallet className="text-purple-600 w-5 h-5" />
          <h2 className="text-sm font-bold uppercase text-slate-700 tracking-wider">Vendor Credit Balances</h2>
        </div>
        <button
          onClick={() => setModalMode('add_existing')}
          className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Vendor</span>
        </button>
      </div>

      {/* Table */}
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-[9px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">
            <th className="py-3 px-4 w-8"></th>
            <th className="py-3 px-4">Vendor</th>
            <th className="py-3 px-4 text-right">Initial</th>
            <th className="py-3 px-4 text-right">Top-ups</th>
            <th className="py-3 px-4 text-right">Net Issued</th>
            <th className="py-3 px-4 text-right">Remaining</th>
            <th className="py-3 px-4 text-center">Status</th>
            <th className="py-3 px-4 text-center">Actions</th>
          </tr>
        </thead>
        <tbody className="text-sm divide-y divide-slate-100">
          {vendorBalances.length === 0 && (
            <tr>
              <td colSpan={8} className="px-6 py-10 text-center text-slate-400 text-sm">
                No vendors yet. Click <strong>Add Vendor</strong> to get started.
              </td>
            </tr>
          )}

          {vendorBalances.map(vendor => {
            const vTickets = getVendorTickets(vendor);
            const vTopUps = getVendorTopUps(vendor.id);
            const totalTopUp = vTopUps.reduce((s, tu) => s + tu.amount, 0);
            const totalIssued = vTickets.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
            const totalRefunds = vTickets.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
            const netIssued = totalIssued - totalRefunds;
            const remaining = vendor.currentBalance;
            // Ibtekar's sheet balance is already negative when the agency has credit,
            // so negative remaining = good (show OK), positive = agency owes (show OVERDUE).
            // All other vendors keep standard logic: positive = credit, negative = overdraft.
            const isCreditNegative = vendor.vendorName === 'Ibtekar';
            const isNeg = isCreditNegative ? remaining > 0 : remaining < 0;
            const pct = vendor.initialBalance > 0 ? (remaining / vendor.initialBalance) * 100 : 0;
            const isLow = !isCreditNegative && pct < 20 && remaining >= 0;
            const isExpanded = expandedId === vendor.id;

            return (
              <React.Fragment key={vendor.id}>
                <tr
                  className={`hover:bg-slate-50 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                  onClick={() => setExpandedId(prev => prev === vendor.id ? null : vendor.id)}
                >
                  <td className="py-3 px-4 text-slate-400">
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5" />
                      : <ChevronRight className="w-3.5 h-3.5" />
                    }
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-700 uppercase text-[11px] tracking-wide">
                    {vendor.vendorName}
                  </td>
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
                        onClick={e => openTopUp(vendor.id, e)}
                        className="text-emerald-500 hover:text-emerald-700 transition-colors"
                        title="Add balance"
                      >
                        <PlusCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete ${vendor.vendorName}?`)) onDeleteVendor(vendor.id); }}
                        className="text-slate-300 hover:text-red-500 transition-colors"
                        title="Delete vendor"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Expanded detail */}
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

                        {/* Linked tickets */}
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-bold uppercase text-slate-500 flex items-center space-x-1.5">
                            <TrendingDown className="w-3 h-3" />
                            <span>Tickets ({vTickets.length})</span>
                          </div>
                          {vTickets.length === 0 ? (
                            <p className="px-4 py-4 text-xs text-slate-400 italic">No tickets linked to this vendor yet.</p>
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
        </tbody>
      </table>

      {/* ════════════════════════════════════════
          MODAL OVERLAY
      ════════════════════════════════════════ */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >

            {/* ── ADD VENDOR MODAL ── */}
            {(modalMode === 'add_existing' || modalMode === 'add_new') && (
              <>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
                  <div className="flex items-center space-x-2">
                    <Plus className="w-4 h-4 text-purple-600" />
                    <h3 className="font-bold text-sm uppercase tracking-wider text-slate-700">Add Vendor</h3>
                  </div>
                  <button onClick={closeModal} className="text-slate-400 hover:text-slate-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Tab switcher */}
                <div className="flex border-b border-slate-100">
                  <button
                    onClick={() => setModalMode('add_existing')}
                    className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${modalMode === 'add_existing' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Known Vendors
                  </button>
                  <button
                    onClick={() => setModalMode('add_new')}
                    className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${modalMode === 'add_new' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Custom Vendor
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  {modalMode === 'add_existing' ? (
                    <>
                      <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">
                          Select Vendor
                        </label>
                        {availablePresets.length === 0 ? (
                          <p className="text-xs text-slate-400 italic py-2">All known vendors already added. Use Custom Vendor tab.</p>
                        ) : (
                          <select
                            value={selectedPreset}
                            onChange={e => setSelectedPreset(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 text-sm font-bold uppercase text-slate-700 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                          >
                            <option value="">— Choose vendor —</option>
                            {availablePresets.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">
                          Initial Balance ({currency})
                        </label>
                        <input
                          type="number"
                          value={presetBalance}
                          onChange={e => setPresetBalance(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAddPreset()}
                          placeholder="0.00"
                          className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                      <button
                        onClick={handleAddPreset}
                        disabled={!selectedPreset || isNaN(Number(presetBalance)) || presetBalance === ''}
                        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded py-2 text-[10px] font-bold uppercase tracking-wider transition-colors"
                      >
                        Add {selectedPreset || 'Vendor'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">
                          Vendor Name
                        </label>
                        <input
                          type="text"
                          value={customName}
                          onChange={e => setCustomName(e.target.value)}
                          placeholder="e.g. My Custom Airline"
                          className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">
                          Initial Balance ({currency})
                        </label>
                        <input
                          type="number"
                          value={customBalance}
                          onChange={e => setCustomBalance(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                          placeholder="0.00"
                          className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                      <button
                        onClick={handleAddCustom}
                        disabled={!customName.trim() || isNaN(Number(customBalance)) || customBalance === ''}
                        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded py-2 text-[10px] font-bold uppercase tracking-wider transition-colors"
                      >
                        Add Custom Vendor
                      </button>
                    </>
                  )}
                </div>
              </>
            )}

            {/* ── TOP-UP MODAL ── */}
            {modalMode === 'topup' && topUpVendor && (
              <>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-emerald-50">
                  <div className="flex items-center space-x-2">
                    <Edit3 className="w-4 h-4 text-emerald-600" />
                    <h3 className="font-bold text-sm uppercase tracking-wider text-emerald-700">
                      Add Balance — {topUpVendor.vendorName}
                    </h3>
                  </div>
                  <button onClick={closeModal} className="text-slate-400 hover:text-slate-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3 text-xs font-mono flex justify-between">
                    <span className="text-slate-500">Current Balance</span>
                    <span className={`font-bold ${topUpVendor.currentBalance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {currency} {fmt(topUpVendor.currentBalance)}
                    </span>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">
                      Amount to Add ({currency})
                    </label>
                    <input
                      type="number"
                      value={topUpAmount}
                      onChange={e => setTopUpAmount(e.target.value)}
                      placeholder="0.00"
                      autoFocus
                      className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">
                      Note (optional)
                    </label>
                    <input
                      type="text"
                      value={topUpNote}
                      onChange={e => setTopUpNote(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleTopUpSubmit()}
                      placeholder="e.g. January top-up"
                      className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  {topUpAmount && !isNaN(Number(topUpAmount)) && Number(topUpAmount) > 0 && (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-xs font-mono flex justify-between">
                      <span className="text-emerald-600">New Balance After Top-up</span>
                      <span className="font-bold text-emerald-700">
                        {currency} {fmt(topUpVendor.currentBalance + Number(topUpAmount))}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={handleTopUpSubmit}
                    disabled={!topUpAmount || parseFloat(topUpAmount) <= 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded py-2 text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    Confirm Top-up
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
