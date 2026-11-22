import React, { useState } from 'react';
import { walletReference } from '../core/config/appSettings';
import { StatusBadge, badgeClass, ticketStatus } from './ui/StatusBadge';
import { PageHeader, PageTitle } from './ui/PageHeader';
import { VendorBalance, BalanceTopUp, Ticket } from '../types';
import {
  Plus, Trash2, Wallet, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, PlusCircle, Edit3
} from 'lucide-react';
import { Dialog, DialogClose } from './ui/Dialog';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';

interface VendorBalancesProps {
  vendorBalances: VendorBalance[];
  topUps: BalanceTopUp[];
  tickets: Ticket[];
  onSaveVendor: (v: VendorBalance) => void;
  onDeleteVendor: (id: string) => void;
  onTopUp: (topUp: BalanceTopUp) => void;
  /** False for a viewer: the wallets stay readable, the actions that change
   *  them are withheld. The database refuses those writes regardless. */
  canEdit?: boolean;
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
  'FlyDubai', 'AirArabia', 'RTS', 'Ibtekar', 'Gold Medal', 'NSA', 'Riyadh Air', 'Turkish Airlines', 'Emirates',
];

type ModalMode = null | 'add_existing' | 'add_new' | 'topup';

/**
 * When the opening balance starts counting.
 *
 * Without this the balance was charged for every ticket the vendor had ever
 * issued, including the ones settled long before it was opened — an IATA
 * balance of 817,284.78 immediately met 1,884 old tickets worth 6.29 million
 * and reported the account millions in the red.
 *
 * Today by default, because that is what opening a balance now means. Clearing
 * it charges the whole history, which is what a wallet created alongside the
 * data actually wants — so the field says both, rather than leaving the empty
 * case to be discovered.
 */
const OpeningDateField: React.FC<{ value: string; onChange: (v: string) => void }> =
({ value, onChange }) => (
  <div>
    <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">
      Balance starts from
    </label>
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/20"
    />
    <p className="text-micro text-slate-400 mt-1 leading-tight">
      {value
        ? 'Only tickets from this date onward are charged to this balance.'
        : 'Empty — every ticket this vendor ever issued is charged to it.'}
    </p>
  </div>
);

export const VendorBalances: React.FC<VendorBalancesProps> = ({
  vendorBalances, topUps, tickets, onSaveVendor, onDeleteVendor, onTopUp, canEdit = true,
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

  /**
   * The day the opening balance is true as of.
   *
   * Defaults to today, which is what opening a balance now means: tickets
   * already in the ledger were settled beforehand and must not be charged to
   * it. Clearing the field charges every ticket the vendor ever issued, which
   * is right for a wallet that opened with the data itself.
   */
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));

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
      openingDate: openingDate || undefined,
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
      openingDate: openingDate || undefined,
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

  /** Every figure a vendor's row shows - one reading for the table and the
   *  phone's cards, so the two can never disagree. */
  const figuresOf = (vendor: VendorBalance) => {
    const vTickets = getVendorTickets(vendor);
    const vTopUps = getVendorTopUps(vendor.id);
    const totalTopUp = vTopUps.reduce((s, tu) => s + tu.amount, 0);
    const totalIssued = vTickets.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalRefunds = vTickets.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const remaining = vendor.currentBalance;
    const isNeg = remaining < 0;
    const ref = walletReference(vendor.vendorName, vendor.initialBalance);
    const pct = ref > 0 ? (remaining / ref) * 100 : 100;
    return { vTickets, vTopUps, totalTopUp, netIssued: totalIssued - totalRefunds, remaining, isNeg, pct,
             isLow: pct < 20 && remaining >= 0 };
  };
  const statusBadge = (isNeg: boolean, isLow: boolean) => isNeg
    ? <StatusBadge tone="danger">Overdraft</StatusBadge>
    : isLow
    ? <StatusBadge tone="warning">Low</StatusBadge>
    : <StatusBadge tone="success">OK</StatusBadge>;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <PageHeader icon={<Wallet />} title="Vendor credit"
        subtitle="What each supplier's wallet holds: its opening, the top-ups paid in, what our tickets drew, and what is left."
        actions={canEdit && <button
          onClick={() => setModalMode('add_existing')}
          className="flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add vendor</span>
        </button>} />
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">

      {/* Table.
          The wallet table is eight columns wide and cannot usefully be
          narrower - every one of them is a figure somebody reconciles against.
          On a phone it was simply cut off at the edge of the card, so the
          balance itself, the rightmost column, could not be seen at all. It
          scrolls sideways instead. */}
      {/* On a phone each vendor is a card: its balance first and large -
          the figure the screen is for - then what makes it up. Tapping it
          opens the same top-ups and tickets the table opens. */}
      <div className="md:hidden divide-y divide-slate-100">
        {vendorBalances.length === 0 && (
          <p className="px-4 py-10 text-center text-slate-400 text-sm">
            No vendors yet. Tap <strong>Add Vendor</strong> to get started.
          </p>
        )}
        {vendorBalances.map(vendor => {
          const f = figuresOf(vendor);
          const cur = sourceToCurrency(vendor.vendorName);
          const isExpanded = expandedId === vendor.id;
          const tone = f.isNeg ? 'text-red-600' : f.isLow ? 'text-amber-600' : 'text-emerald-700';
          const bar = f.isNeg ? 'bg-red-400' : f.isLow ? 'bg-amber-400' : 'bg-emerald-400';
          return (
            <div key={vendor.id} className={isExpanded ? 'bg-slate-50' : ''}>
              <button type="button" aria-expanded={isExpanded}
                onClick={() => setExpandedId(prev => prev === vendor.id ? null : vendor.id)}
                className="w-full text-left px-4 pt-3.5 pb-3 flex items-start gap-3 active:bg-slate-50">
                <span className="mt-0.5 text-slate-400 shrink-0">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-700 uppercase text-xs tracking-wide truncate">{vendor.vendorName}</span>
                    {statusBadge(f.isNeg, f.isLow)}
                  </span>
                  <span className={`block mt-1 font-mono font-bold text-lg ${tone}`}>
                    {f.isNeg ? '-' : ''}{cur} {fmt(Math.abs(f.remaining))}
                  </span>
                  <span className="block mt-1.5 w-full bg-slate-100 rounded-full h-1">
                    <span className={`block h-1 rounded-full ${bar}`}
                      style={{ width: f.isNeg ? '100%' : `${Math.min(Math.max(f.pct, 0), 100)}%` }} />
                  </span>
                  <span className="mt-2.5 grid grid-cols-3 gap-2 text-mini">
                    <span><span className="block text-slate-400 uppercase tracking-wide">Initial</span>
                      <span className="block font-mono text-slate-600">{fmt(vendor.initialBalance)}</span></span>
                    <span><span className="block text-slate-400 uppercase tracking-wide">Top-ups</span>
                      <span className="block font-mono text-emerald-600">{f.totalTopUp > 0 ? `+${fmt(f.totalTopUp)}` : '—'}</span></span>
                    <span><span className="block text-slate-400 uppercase tracking-wide">Net issued</span>
                      <span className="block font-mono text-slate-600">{fmt(f.netIssued)}</span></span>
                  </span>
                </span>
              </button>
              {canEdit && (
                <div className="flex gap-2 px-4 pb-3 pl-11">
                  <button type="button" onClick={e => openTopUp(vendor.id, e)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
                    <PlusCircle className="w-3.5 h-3.5" /> Add balance
                  </button>
                  <button type="button" onClick={() => { if (confirm(`Delete ${vendor.vendorName}?`)) onDeleteVendor(vendor.id); }}
                    aria-label={`Delete ${vendor.vendorName}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 text-slate-500 text-xs font-bold hover:text-red-600">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              )}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  {f.vTopUps.length > 0 && (
                    <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100 text-mini font-bold uppercase text-emerald-700 flex items-center gap-1.5">
                        <TrendingUp className="w-3 h-3" /> Balance top-ups
                      </div>
                      <ul className="divide-y divide-slate-50">
                        {f.vTopUps.map(tu => (
                          <li key={tu.id} className="px-3 py-2 flex items-start justify-between gap-3 text-xs">
                            <span className="min-w-0">
                              <span className="block font-mono text-mini text-slate-400">{tu.date}</span>
                              <span className="block text-slate-600 break-words">{tu.note}</span>
                            </span>
                            <span className="font-mono font-bold text-emerald-600 whitespace-nowrap">+{fmt(tu.amount)} {cur}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-mini font-bold uppercase text-slate-500 flex items-center gap-1.5">
                      <TrendingDown className="w-3 h-3" /> Tickets ({f.vTickets.length})
                    </div>
                    {f.vTickets.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-slate-400 italic">No tickets linked to this vendor yet.</p>
                    ) : (
                      <ul className="max-h-96 overflow-y-auto overscroll-contain divide-y divide-slate-50">
                        {f.vTickets.map(t => {
                          const isRefund = t.amount < 0, isCanc = t.amount === 0;
                          const impact = isCanc ? 'text-slate-400' : isRefund ? 'text-emerald-600' : 'text-red-600';
                          return (
                            <li key={t.id} className="px-3 py-2 flex items-start justify-between gap-3 font-mono text-xs">
                              <span className="min-w-0">
                                <span className="block text-slate-700 font-bold">{t.ticketNo}</span>
                                <span className="block text-mini text-slate-400">{t.date} · {t.pnr || '—'} · {t.status || '—'}</span>
                                <span className="block text-mini">
                                  {t.reqNum ? <span className="text-blue-600 font-bold">{t.reqNum}</span>
                                            : <span className="text-red-400 italic">missing req</span>}
                                </span>
                              </span>
                              <span className={`font-bold whitespace-nowrap ${impact}`}>
                                {isCanc ? '±0' : isRefund ? `+${fmt(Math.abs(t.amount))}` : `-${fmt(t.amount)}`}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="hidden md:block overflow-x-auto">
      <table className="data-table text-left min-w-[760px]">
        <thead>
          <tr className="border-b border-slate-200 text-micro font-bold text-slate-400 uppercase tracking-wider bg-slate-50">
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
            // One reading for every vendor now that calcVendorBalance uses one
            // convention: positive = credit the agency holds, negative = owed.
            const { vTickets, vTopUps, totalTopUp, netIssued, remaining, isNeg, pct, isLow } = figuresOf(vendor);
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
                  <td className="py-3 px-4 font-bold text-slate-700 uppercase text-xs tracking-wide">
                    {vendor.vendorName}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-slate-500">{fmt(vendor.initialBalance)}</td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-emerald-600">
                    {totalTopUp > 0 ? `+${fmt(totalTopUp)}` : '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-slate-600">{fmt(netIssued)}</td>
                  <td className={`py-3 px-4 text-right font-mono font-bold text-xs ${isNeg ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
                    {isNeg ? '-' : ''}{sourceToCurrency(vendor.vendorName)} {fmt(Math.abs(remaining))}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex flex-col items-center space-y-1">
                      {statusBadge(isNeg, isLow)}
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
                      {canEdit ? (
                        <>
                          <button
                            onClick={e => openTopUp(vendor.id, e)}
                            className="text-emerald-500 hover:text-emerald-700 transition-colors"
                            title="Add balance"
                          >
                            <PlusCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete ${vendor.vendorName}?`)) onDeleteVendor(vendor.id); }}
                            className="text-slate-400 hover:text-red-500 transition-colors"
                            title="Delete vendor"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <span className="text-slate-400 text-micro">—</span>
                      )}
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
                            <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-micro font-bold uppercase text-emerald-700 flex items-center space-x-1.5">
                              <TrendingUp className="w-3 h-3" />
                              <span>Balance Top-ups</span>
                            </div>
                            <table className="w-full text-left">
                              <tbody>
                                {vTopUps.map(tu => (
                                  <tr key={tu.id} className="border-b border-slate-50 text-xs hover:bg-slate-50">
                                    <td className="px-4 py-2 text-slate-500 font-mono text-mini">{tu.date}</td>
                                    <td className="px-4 py-2 text-slate-600">{tu.note}</td>
                                    <td className="px-4 py-2 text-right font-mono font-bold text-emerald-600">+{fmt(tu.amount)} {sourceToCurrency(vendor.vendorName)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Linked tickets */}
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-micro font-bold uppercase text-slate-500 flex items-center space-x-1.5">
                            <TrendingDown className="w-3 h-3" />
                            <span>Tickets ({vTickets.length})</span>
                          </div>
                          {/* The list keeps a height cap — NSA alone has
                              thousands of tickets and rendering them all would
                              bury the vendor list — but 56 was cramped enough
                              that a vendor with 29 tickets looked broken. The
                              page scrolls around this now. */}
                          {vTickets.length === 0 ? (
                            <p className="px-4 py-4 text-xs text-slate-400 italic">No tickets linked to this vendor yet.</p>
                          ) : (
                            <div className="max-h-96 overflow-y-auto">
                              <table className="w-full text-left">
                                <thead>
                                  <tr className="border-b border-slate-100 text-micro uppercase tracking-wider text-slate-400">
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
                                        <td className="px-3 py-2 text-slate-400 text-mini">{t.date}</td>
                                        <td className="px-3 py-2 text-mini text-slate-700">{t.ticketNo}</td>
                                        <td className="px-3 py-2 text-mini text-slate-500">{t.pnr || '—'}</td>
                                        <td className="px-3 py-2 text-mini">
                                          {t.reqNum
                                            ? <span className="text-blue-600 font-bold">{t.reqNum}</span>
                                            : <span className="text-red-400 italic">missing</span>
                                          }
                                        </td>
                                        <td className="px-3 py-2 text-micro font-bold text-slate-400">{t.status || '—'}</td>
                                        <td className="px-3 py-2 text-right text-mini">{fmt(Math.abs(t.amount))}</td>
                                        <td className={`px-3 py-2 text-right font-bold text-mini ${isCanc ? 'text-slate-400' : isRefund ? 'text-emerald-600' : 'text-red-600'}`}>
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
      </div>

      {/* ════════════════════════════════════════
          MODAL OVERLAY
      ════════════════════════════════════════ */}
      {modalMode && (
        <Dialog onClose={closeModal} label={modalMode === 'topup' ? 'Top up a vendor' : 'Add a vendor'}
          className="sm:max-w-md overflow-y-auto">

            {/* ── ADD VENDOR MODAL ── */}
            {(modalMode === 'add_existing' || modalMode === 'add_new') && (
              <>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
                  <div className="flex items-center space-x-2">
                    <Plus className="w-4 h-4 text-purple-600" />
                    <h3 className="font-bold text-sm uppercase tracking-wider text-slate-700">Add Vendor</h3>
                  </div>
                  <DialogClose onClick={closeModal} />
                </div>

                {/* Tab switcher */}
                <div className="flex border-b border-slate-100">
                  <button
                    onClick={() => setModalMode('add_existing')}
                    className={`flex-1 py-2.5 text-mini font-bold uppercase tracking-wider transition-colors ${modalMode === 'add_existing' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Known Vendors
                  </button>
                  <button
                    onClick={() => setModalMode('add_new')}
                    className={`flex-1 py-2.5 text-mini font-bold uppercase tracking-wider transition-colors ${modalMode === 'add_new' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Custom Vendor
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  {modalMode === 'add_existing' ? (
                    <>
                      <div>
                        <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">
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
                        <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">
                          Initial Balance
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
                      <OpeningDateField value={openingDate} onChange={setOpeningDate} />
                      <button
                        onClick={handleAddPreset}
                        disabled={!selectedPreset || isNaN(Number(presetBalance)) || presetBalance === ''}
                        className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded py-2 text-mini font-bold uppercase tracking-wider transition-colors"
                      >
                        Add {selectedPreset || 'Vendor'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">
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
                        <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">
                          Initial Balance
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
                      <OpeningDateField value={openingDate} onChange={setOpeningDate} />
                      <button
                        onClick={handleAddCustom}
                        disabled={!customName.trim() || isNaN(Number(customBalance)) || customBalance === ''}
                        className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded py-2 text-mini font-bold uppercase tracking-wider transition-colors"
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
                  <DialogClose onClick={closeModal} />
                </div>

                <div className="p-5 space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3 text-xs font-mono flex justify-between">
                    <span className="text-slate-500">Current Balance</span>
                    <span className={`font-bold ${topUpVendor.currentBalance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {sourceToCurrency(topUpVendor.vendorName)} {fmt(topUpVendor.currentBalance)}
                    </span>
                  </div>
                  <div>
                    <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">
                      Amount to Add ({sourceToCurrency(topUpVendor.vendorName)})
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
                    <label className="text-mini font-bold uppercase text-slate-500 block mb-1.5">
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
                        {sourceToCurrency(topUpVendor.vendorName)} {fmt(topUpVendor.currentBalance + Number(topUpAmount))}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={handleTopUpSubmit}
                    disabled={!topUpAmount || parseFloat(topUpAmount) <= 0}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded py-2 text-mini font-bold uppercase tracking-wider transition-colors"
                  >
                    Confirm Top-up
                  </button>
                </div>
              </>
            )}
        </Dialog>
      )}
    </div>
    </div>
  );
};
