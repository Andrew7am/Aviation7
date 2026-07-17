import React, { useMemo, useState } from 'react';
import { Ticket, VendorBalance, BalanceTopUp } from '../types';
import { useReports } from '../hooks/useReports';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';
import { Download, FileText, TrendingDown, Wallet } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ReportsProps {
  tickets: Ticket[];
  vendorBalances: VendorBalance[];
  topUps: BalanceTopUp[];
}

type ReportTab = 'summary' | 'overdraft' | 'vendor_detail' | 'missing_req' | 'ledger';

export const Reports: React.FC<ReportsProps> = ({ tickets, vendorBalances, topUps }) => {
  const [tab, setTab] = useState<ReportTab>('summary');
  const [selectedVendor, setSelectedVendor] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Centralized stats — single source of truth, no duplicated calculations
  const { totalIssued, totalRefunds, netTotal, bySource, missingReq, duplicates } = useReports(tickets, vendorBalances, topUps);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      if (selectedVendor !== 'ALL' && t.source !== selectedVendor) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      return true;
    });
  }, [tickets, selectedVendor, dateFrom, dateTo]);

  const overdraftVendors = vendorBalances.filter(v => v.currentBalance < 0);
  const lowVendors = vendorBalances.filter(v => v.currentBalance >= 0 && v.initialBalance > 0 && (v.currentBalance / v.initialBalance) < 0.2);

  const sources = useMemo(() =>
    ['ALL', ...Array.from(new Set(tickets.map(t => t.source).filter(Boolean)))],
    [tickets]
  );

  const exportSummary = () => {
    const rows = vendorBalances.map(v => {
      const vTopUps = topUps.filter(tu => tu.vendorId === v.id);
      const totalTopUp = vTopUps.reduce((s, tu) => s + tu.amount, 0);
      return {
        'Vendor': v.vendorName,
        'Initial Balance': v.initialBalance,
        'Top-ups': totalTopUp,
        'Remaining Balance': v.currentBalance,
        'Status': v.currentBalance < 0 ? 'OVERDRAFT' : (v.currentBalance / (v.initialBalance || 1)) < 0.2 ? 'LOW' : 'OK',
        'Currency': sourceToCurrency(v.vendorName),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendor Summary');
    XLSX.writeFile(wb, 'Vendor_Balances_Report.xlsx');
  };

  const exportMissingReq = () => {
    const data = missingReq.map(t => ({
      'Ticket No.': t.ticketNo,
      'Source': t.source || '',
      'Date': t.date,
      'Net Amount': t.amount,
      'PNR': t.pnr || '',
      'Passenger': t.passengerName || '',
      'Req Num': '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Missing REQ');
    XLSX.writeFile(wb, 'Missing_REQ_Export.xlsx');
  };

  const exportVendorDetail = () => {
    const data = filteredTickets.map(t => ({
      'A/L':        t.airlineCode || '',
      'Ticket No.': t.ticketNo,
      'Source':     t.source,
      'Status': t.status || '',
      'Date': t.date,
      'Total Doc': t.totalDoc || '',
      'Commission': t.commission || '',
      'Net Amount': t.amount,
      'Currency':   t.currency || 'SAR',   // always from ticket
      'PNR':        t.pnr || '',
      'Passenger': t.passengerName || '',
      'Req Num': t.reqNum || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    XLSX.writeFile(wb, `Transaction_History_${selectedVendor}.xlsx`);
  };

  const TABS: { key: ReportTab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary',        label: 'Vendor Summary',       icon: <Wallet className="w-3.5 h-3.5" /> },
    { key: 'overdraft',      label: 'Overdraft / Low',      icon: <TrendingDown className="w-3.5 h-3.5" /> },
    { key: 'ledger',         label: 'Wallet Ledger',        icon: <Wallet className="w-3.5 h-3.5" /> },
    { key: 'vendor_detail',  label: 'Transaction History',  icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'missing_req',    label: `Missing REQ (${missingReq.length})`, icon: <FileText className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-100">
      <div className="px-6 py-4 bg-white border-b border-slate-200 shrink-0">
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Reports & Exports</h2>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-4 shrink-0">
        <div className="flex space-x-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center space-x-1.5 px-4 py-3 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-400 hover:text-slate-700'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">

        {/* ── VENDOR SUMMARY TAB ── */}
        {tab === 'summary' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100 bg-slate-50">
              <span className="text-[10px] font-bold uppercase text-slate-500">All Vendor Balances</span>
              <button onClick={exportSummary} className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase hover:bg-blue-700">
                <Download className="w-3 h-3" />
                <span>Export</span>
              </button>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[9px] uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2 text-right">Initial</th>
                  <th className="px-4 py-2 text-right">Top-ups</th>
                  <th className="px-4 py-2 text-right">Issued</th>
                  <th className="px-4 py-2 text-right">Refunds</th>
                  <th className="px-4 py-2 text-right">Remaining</th>
                  <th className="px-4 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="text-xs font-mono divide-y divide-slate-50">
                {vendorBalances.map(v => {
                  const vTickets = tickets.filter(t => t.source.toLowerCase().includes(v.vendorName.toLowerCase()));
                  const vTopUps = topUps.filter(tu => tu.vendorId === v.id);
                  const totalTopUp = vTopUps.reduce((s, tu) => s + tu.amount, 0);
                  const issued = vTickets.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
                  const refunds = vTickets.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
                  const rem = v.currentBalance;
                  const isNeg = rem < 0;
                  const isLow = !isNeg && v.initialBalance > 0 && (rem / v.initialBalance) < 0.2;
                  return (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-sans font-bold text-slate-700 text-[11px] uppercase">{v.vendorName}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{fmt(v.initialBalance)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{totalTopUp > 0 ? `+${fmt(totalTopUp)}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{fmt(issued)}</td>
                      <td className="px-4 py-2.5 text-right text-red-500">{refunds > 0 ? fmt(refunds) : '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {isNeg ? '-' : ''}{sourceToCurrency(v.vendorName)} {fmt(Math.abs(rem))}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isNeg
                          ? <span className="bg-red-100 text-red-700 text-[9px] font-bold px-2 py-0.5 rounded">OVERDRAFT</span>
                          : isLow
                          ? <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded">LOW</span>
                          : <span className="bg-emerald-50 text-emerald-600 text-[9px] font-bold px-2 py-0.5 rounded">OK</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── OVERDRAFT TAB ── */}
        {tab === 'overdraft' && (
          <div className="space-y-4">
            {overdraftVendors.length > 0 && (
              <div className="bg-white border border-red-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-red-50 border-b border-red-100">
                  <span className="text-[10px] font-bold uppercase text-red-700">Overdraft Vendors ({overdraftVendors.length})</span>
                </div>
                {overdraftVendors.map(v => (
                  <div key={v.id} className="flex justify-between items-center px-4 py-3 border-b border-red-50">
                    <span className="font-bold text-sm uppercase text-slate-700">{v.vendorName}</span>
                    <span className="font-mono font-black text-red-600 text-lg">{sourceToCurrency(v.vendorName)} {fmt(Math.abs(v.currentBalance))} OVERDRAWN</span>
                  </div>
                ))}
              </div>
            )}
            {lowVendors.length > 0 && (
              <div className="bg-white border border-amber-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
                  <span className="text-[10px] font-bold uppercase text-amber-700">Low Balance (Below 20%) — {lowVendors.length} Vendors</span>
                </div>
                {lowVendors.map(v => {
                  const pct = (v.currentBalance / v.initialBalance) * 100;
                  return (
                    <div key={v.id} className="flex justify-between items-center px-4 py-3 border-b border-amber-50">
                      <span className="font-bold text-sm uppercase text-slate-700">{v.vendorName}</span>
                      <div className="flex items-center space-x-3">
                        <div className="w-24 bg-amber-100 rounded-full h-2">
                          <div className="bg-amber-400 h-2 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono font-bold text-amber-700 text-sm">{sourceToCurrency(v.vendorName)} {fmt(v.currentBalance)} ({pct.toFixed(0)}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {overdraftVendors.length === 0 && lowVendors.length === 0 && (
              <div className="bg-white border border-emerald-200 rounded-lg p-8 text-center shadow-sm">
                <p className="text-emerald-600 font-bold text-sm">✓ All vendor balances are healthy</p>
              </div>
            )}
          </div>
        )}

        {/* ── TRANSACTION HISTORY TAB ── */}
        {tab === 'vendor_detail' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex flex-wrap gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <select
                value={selectedVendor}
                onChange={e => setSelectedVendor(e.target.value)}
                className="bg-white border border-slate-200 text-xs font-bold uppercase px-3 py-1.5 rounded focus:outline-none"
              >
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="bg-white border border-slate-200 text-xs px-3 py-1.5 rounded focus:outline-none" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="bg-white border border-slate-200 text-xs px-3 py-1.5 rounded focus:outline-none" />
              <button onClick={exportVendorDetail}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase hover:bg-blue-700 ml-auto">
                <Download className="w-3 h-3" />
                <span>Export {filteredTickets.length} rows</span>
              </button>
            </div>
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-left min-w-[800px]">
                <thead className="sticky top-0 bg-slate-50 shadow-sm">
                  <tr className="border-b border-slate-200 text-[9px] uppercase tracking-wider text-slate-400">
                    {['Date', 'Ticket No.', 'Source', 'Status', 'PNR', 'Passenger', 'Net Amt', 'Req Num'].map(c => (
                      <th key={c} className="px-3 py-2">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-xs font-mono divide-y divide-slate-50">
                  {filteredTickets.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{t.date}</td>
                      <td className="px-3 py-2 font-bold">{t.ticketNo}</td>
                      <td className="px-3 py-2 text-slate-500">{t.source}</td>
                      <td className="px-3 py-2 text-slate-400 text-[9px]">{t.status || '—'}</td>
                      <td className="px-3 py-2">{t.pnr || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{t.passengerName || '—'}</td>
                      <td className={`px-3 py-2 font-bold ${t.amount < 0 ? 'text-red-600' : ''}`}>
                        {t.amount < 0 ? '-' : ''}{fmt(Math.abs(t.amount))}
                      </td>
                      <td className={`px-3 py-2 ${t.reqNum ? 'text-blue-600' : 'text-red-400 italic'}`}>
                        {t.reqNum || 'MISSING'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── MISSING REQ TAB ── */}
        {tab === 'missing_req' && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-slate-100 bg-red-50">
              <span className="text-[10px] font-bold uppercase text-red-700">{missingReq.length} Tickets Missing Req Num</span>
              <button onClick={exportMissingReq}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-600 text-white rounded text-[10px] font-bold uppercase hover:bg-red-700">
                <Download className="w-3 h-3" />
                <span>Export & Fill In Excel</span>
              </button>
            </div>
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[10px] text-amber-700 font-mono">
              💡 Export → Fill in the "Req Num" column → Re-import via Import Data. The system will match by Ticket No. and update existing records.
            </div>
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-50 shadow-sm">
                  <tr className="border-b border-slate-200 text-[9px] uppercase tracking-wider text-slate-400">
                    {['Ticket No.', 'Source', 'Date', 'Amount', 'PNR', 'Passenger'].map(c => (
                      <th key={c} className="px-3 py-2">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-xs font-mono divide-y divide-slate-50">
                  {missingReq.map(t => (
                    <tr key={t.id} className="hover:bg-red-50/30">
                      <td className="px-3 py-2 font-bold text-slate-700">{t.ticketNo}</td>
                      <td className="px-3 py-2 text-slate-500">{t.source}</td>
                      <td className="px-3 py-2 text-slate-400">{t.date}</td>
                      <td className={`px-3 py-2 font-bold ${t.amount < 0 ? 'text-red-600' : ''}`}>
                        {fmt(Math.abs(t.amount))}
                      </td>
                      <td className="px-3 py-2">{t.pnr || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{t.passengerName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── WALLET LEDGER TAB ── */}
        {tab === 'ledger' && (
          <div className="space-y-4">
            {vendorBalances.map(v => {
              const vTopUps   = topUps.filter(tu => tu.vendorId === v.id);
              const vTickets  = tickets.filter(t =>
                (t.source || '').toLowerCase().includes(v.vendorName.toLowerCase()) ||
                v.vendorName.toLowerCase().includes((t.source || '').toLowerCase())
              );
              const totalTopUp  = vTopUps.reduce((s, tu) => s + tu.amount, 0);
              const totalIssued = vTickets.filter(t => (t.status||'').toUpperCase() === 'ISSUE' || t.amount > 0).reduce((s, t) => s + Math.abs(t.amount), 0);
              const totalRefund = vTickets.filter(t => (t.status||'').toUpperCase() === 'REFUND' || t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
              const balance     = v.currentBalance;
              const isNeg       = balance < 0;

              // Build ledger entries
              const ledgerEntries = [
                { date: '-', type: 'OPENING', desc: 'Opening Balance', debit: 0, credit: v.initialBalance, running: v.initialBalance },
                ...vTopUps.map(tu => ({ date: tu.date, type: 'FUND', desc: tu.note, debit: 0, credit: tu.amount, running: 0 })),
                ...vTickets.map(t => ({
                  date: t.date, type: t.status || 'ISSUE',
                  desc: `${t.ticketNo} — ${t.passengerName || t.pnr || ''}`,
                  debit: t.amount > 0 ? t.amount : 0,
                  credit: t.amount < 0 ? Math.abs(t.amount) : 0,
                  running: 0,
                })),
              ].sort((a, b) => a.date.localeCompare(b.date));

              // Calculate running balance
              let running = 0;
              ledgerEntries.forEach(e => {
                running += e.credit - e.debit;
                e.running = running;
              });

              return (
                <div key={v.id} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                  <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <span className="font-bold text-sm uppercase text-slate-700">{v.vendorName}</span>
                    <span className={`font-mono font-black text-lg ${isNeg ? 'text-red-600' : 'text-emerald-700'}`}>
                      {isNeg ? '-' : ''}{sourceToCurrency(v.vendorName)} {fmt(Math.abs(balance))}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                        <tr>
                          {['Date','Type','Description','Debit','Credit','Balance'].map(c => (
                            <th key={c} className="px-3 py-2 text-[9px] font-bold uppercase text-slate-400">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {ledgerEntries.map((e, i) => (
                          <tr key={i} className={`hover:bg-slate-50 ${e.type === 'FUND' ? 'bg-emerald-50/40' : e.type === 'REFUND' ? 'bg-red-50/30' : ''}`}>
                            <td className="px-3 py-1.5 text-slate-400 text-[10px]">{e.date}</td>
                            <td className="px-3 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                e.type === 'FUND' ? 'bg-emerald-100 text-emerald-700' :
                                e.type === 'REFUND' ? 'bg-red-100 text-red-700' :
                                e.type === 'OPENING' ? 'bg-blue-100 text-blue-700' :
                                'bg-slate-100 text-slate-600'
                              }`}>{e.type}</span>
                            </td>
                            <td className="px-3 py-1.5 text-slate-600 max-w-[200px] truncate text-[10px]">{e.desc}</td>
                            <td className="px-3 py-1.5 text-red-600 text-right">{e.debit > 0 ? fmt(e.debit) : '—'}</td>
                            <td className="px-3 py-1.5 text-emerald-600 text-right">{e.credit > 0 ? fmt(e.credit) : '—'}</td>
                            <td className={`px-3 py-1.5 text-right font-bold ${e.running < 0 ? 'text-red-600' : 'text-slate-700'}`}>{fmt(e.running)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {vendorBalances.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center shadow-sm">
                <p className="text-slate-400 text-sm">No vendors configured yet.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
