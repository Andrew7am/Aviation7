import React, { useState, useCallback } from 'react';
import { ViewState, Ticket, VendorBalance, BalanceTopUp, AppAlert } from './types';
import { logout } from './utils/supabase';
import { AuthGuard } from './components/AuthGuard';
import { AlertBanner } from './components/AlertBanner';
import { Dashboard } from './components/Dashboard';
import { TicketTable } from './components/TicketTable';
import { ImportData } from './components/ImportData';
import { VendorBalances } from './components/VendorBalances';
import { Reports } from './components/Reports';
import { ImportHistory } from './components/ImportHistory';
import { useTickets } from './hooks/useTickets';
import { useWallet } from './hooks/useWallet';
import { TicketService } from './services/TicketService';
import { ImportService, ImportRecord } from './services/ImportService';
import {
  Plane, LayoutDashboard, List, AlertTriangle,
  Upload, LogOut, Wallet, BarChart2, History,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { SupportedCurrency } from './core/helpers/resolveCurrency';

const LOW_PCT = 0.2;

function MainApp({ user }: { user: User }) {
  const [view, setView]         = useState<ViewState>('dashboard');
  const [alerts, setAlerts]     = useState<AppAlert[]>([]);
  const [currency, setCurrency] = useState<SupportedCurrency>('SAR');
  const [importHistory, setImportHistory] = useState<ImportRecord[]>([]);

  const { tickets, missingReq, deleteTicket, updateReqNum, updateTicket } = useTickets(user.id);
  const { vendors: vendorBalancesLive, topUps, saveVendor, deleteVendor, addTopUp, lowVendors } = useWallet(user.id, tickets);

  const ticketSvc = new TicketService(user.id);
  const importSvc = new ImportService(user.id);

  React.useEffect(() => importSvc.subscribeHistory(setImportHistory), [user.id]);

  /* ── Low balance alerts ── */
  React.useEffect(() => {
    lowVendors.forEach(v => {
      const alertId = `low_${v.id}`;
      setAlerts(prev => {
        if (prev.some(a => a.id === alertId && !a.dismissed)) return prev;
        return [...prev.filter(a => a.id !== alertId), {
          id: alertId, type: 'low_balance',
          message: `⚠ ${v.vendorName} balance below 20% — ${currency} ${v.currentBalance.toFixed(2)} remaining`,
          vendorName: v.vendorName, dismissed: false,
          createdAt: new Date().toISOString(),
        }];
      });
    });
  }, [lowVendors]);

  /* ── Import handler — now logs to ImportHistory + ErrorLog + AuditLog ── */
  const handleImport = async (
    newTickets: Ticket[],
    updateTickets: Ticket[],
    topUpTickets: Ticket[],
    meta?: { parserName: string; confidence: number; totalRows: number; warnings: number; errors: { row: number; raw: string; error: string }[]; vendor: string; reportName: string }
  ) => {
    const startTime = Date.now();
    try {
      // Calculate balanceAfter per ticket
      const vendorRunning: Record<string, number> = {};
      vendorBalancesLive.forEach(v => { vendorRunning[v.vendorName.toLowerCase()] = v.currentBalance; });
      const ticketsWithBalance = newTickets.map(t => {
        const vKey = (t.source || '').toLowerCase();
        const matched = Object.keys(vendorRunning).find(vn => vKey.includes(vn) || vn.includes(vKey));
        if (matched) {
          vendorRunning[matched] -= t.amount;
          return { ...t, balanceAfter: vendorRunning[matched] };
        }
        return t;
      });

      const { saved, updated, topups } = await ticketSvc.saveImport(
        ticketsWithBalance, updateTickets, topUpTickets, vendorBalancesLive
      );

      const duration = Date.now() - startTime;

      // Save Import History record
      if (meta) {
        const importId = await importSvc.saveImportRecord({
          vendor:     meta.vendor,
          reportName: meta.reportName,
          parserName: meta.parserName,
          confidence: meta.confidence,
          totalRows:  meta.totalRows,
          imported:   saved,
          updated,
          topups,
          failed:     meta.errors.length,
          warnings:   meta.warnings,
          duration,
        });

        // Save Error Log
        if (meta.errors.length > 0) {
          await importSvc.saveErrors(importId, meta.vendor, meta.errors);
        }

        // Audit log
        await importSvc.audit('IMPORT', meta.vendor, `${saved} tickets, ${updated} updates, ${topups} top-ups`);
      }

      const parts = [
        saved   > 0 ? `${saved} tickets`   : '',
        updated > 0 ? `${updated} req updates` : '',
        topups  > 0 ? `${topups} top-ups`  : '',
      ].filter(Boolean);
      setAlerts(prev => [...prev, {
        id: `import_${Date.now()}`, type: 'duplicate',
        message: `✓ Imported: ${parts.join(' · ')}`,
        dismissed: false, createdAt: new Date().toISOString(),
      }]);
      setView('tickets');
    } catch (e) {
      console.error('Import error', e);
    }
  };

  const handleSaveVendor   = (v: VendorBalance) => { saveVendor(v); importSvc.audit('ADD_VENDOR', v.vendorName, `Initial balance: ${v.initialBalance}`); };
  const handleDeleteVendor = (id: string) => { if (confirm('Delete vendor?')) { deleteVendor(id); importSvc.audit('DELETE_VENDOR', id, 'Vendor deleted'); } };
  const handleTopUp        = (tu: BalanceTopUp) => { addTopUp(tu); importSvc.audit('TOPUP', tu.vendorName, `+${tu.amount}`); };
  const handleDelete       = (id: string) => { deleteTicket(id); importSvc.audit('DELETE', id, 'Ticket deleted'); };
  const handleUpdateReqNum = (id: string, req: string) => { updateReqNum(id, req); importSvc.audit('UPDATE_REQ', id, `New req: ${req}`); };
  const handleUpdateTicket = (id: string, patch: Partial<Ticket>) => {
    updateTicket(id, patch);
    const summary = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ');
    importSvc.audit('EDIT_TICKET', id, `Edited: ${summary}`);
  };
  const dismissAlert       = useCallback((id: string) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a)), []);

  const missingReqCount = missingReq.length;
  const lowVendorCount  = lowVendors.length;

  type NavItem = { id: ViewState; label: string; icon: React.ReactNode; badge?: number; badgeColor?: 'red' | 'amber' | 'slate' };
  const NAV: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard',       icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'tickets',   label: 'All Tickets',     icon: <List className="w-4 h-4" />, badge: tickets.length },
    { id: 'missing',   label: 'Action Required', icon: <AlertTriangle className="w-4 h-4" />, badge: missingReqCount, badgeColor: 'red' },
    { id: 'import',    label: 'Import Data',     icon: <Upload className="w-4 h-4" /> },
    { id: 'history',   label: 'Import History',  icon: <History className="w-4 h-4" />, badge: importHistory.length || undefined },
    { id: 'vendors',   label: 'Vendor Credit',   icon: <Wallet className="w-4 h-4" />, badge: lowVendorCount || undefined, badgeColor: 'amber' },
    { id: 'reports',   label: 'Reports',         icon: <BarChart2 className="w-4 h-4" /> },
  ];

  return (
    <div className="h-screen bg-[#f8fafc] flex flex-col overflow-hidden select-none">
      <header className="h-14 bg-[#0f172a] text-white flex items-center justify-between px-6 border-b border-white/10 shrink-0 z-20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow">
            <Plane className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-widest uppercase text-white leading-none">Luxury Explorers</h1>
            <p className="text-[9px] text-blue-400 font-mono uppercase tracking-wider">Travel Accounting ERP</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1 bg-white/5 rounded px-2 py-1">
            {(['SAR', 'AED'] as SupportedCurrency[]).map(c => (
              <button key={c} onClick={() => setCurrency(c)}
                className={`font-mono px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${currency === c ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/70'}`}>
                {c}
              </button>
            ))}
          </div>
          <button onClick={() => setView('import')}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest flex items-center space-x-1.5">
            <Upload className="w-3 h-3" /><span>Import CSV / XLS</span>
          </button>
          <button onClick={logout} className="text-white/30 hover:text-white/70" title="Sign Out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <AlertBanner alerts={alerts} onDismiss={dismissAlert} />

      <div className="flex flex-1 min-h-0">
        <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {NAV.map(item => {
              const active   = view === item.id;
              const isRed    = item.badgeColor === 'red';
              const isAmber  = item.badgeColor === 'amber';
              return (
                <button key={item.id} onClick={() => setView(item.id as ViewState)}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded text-[11px] font-bold uppercase tracking-wider transition-all ${
                    active ? isRed ? 'bg-red-50 text-red-700 border border-red-200'
                           : isAmber ? 'bg-amber-50 text-amber-700 border border-amber-200'
                           : 'bg-slate-100 text-slate-900 border border-slate-200'
                           : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700 border border-transparent'}`}>
                  <span className={active ? isRed ? 'text-red-600' : isAmber ? 'text-amber-600' : 'text-slate-700' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isRed ? 'bg-red-100 text-red-700' : isAmber ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="p-3 border-t border-slate-100 bg-slate-50/80">
            <div className="space-y-1.5">
              {[
                ['Tickets', tickets.length, ''],
                ['Missing REQ', missingReqCount, missingReqCount > 0 ? 'text-red-600' : 'text-emerald-600'],
                ['Low Balance', `${lowVendorCount} vendors`, lowVendorCount > 0 ? 'text-amber-600' : 'text-emerald-600'],
              ].map(([label, val, cls]) => (
                <div key={String(label)} className="flex justify-between text-[10px] font-mono">
                  <span className="text-slate-400">{label}</span>
                  <span className={`font-bold ${cls}`}>{val}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[9px] font-mono text-slate-400">
              <span className="truncate max-w-[130px]">{user.email}</span>
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" />
            </div>
          </div>
        </aside>

        <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {view === 'dashboard' && <Dashboard tickets={tickets} vendorBalances={vendorBalancesLive} topUps={topUps} currency={currency} />}
          {view === 'tickets'   && <TicketTable title="Reconciliation Master List" tickets={tickets} onDelete={handleDelete} onUpdateReqNum={handleUpdateReqNum} onUpdateTicket={handleUpdateTicket} currency={currency} />}
          {view === 'missing'   && <TicketTable title="Needs Action — Missing REQ Numbers" tickets={tickets} defaultFilter="NEED_REQ" onDelete={handleDelete} onUpdateReqNum={handleUpdateReqNum} onUpdateTicket={handleUpdateTicket} currency={currency} />}
          {view === 'import'    && <ImportData existingTickets={tickets} onImport={handleImport} currency={currency} setCurrency={setCurrency} vendorNames={vendorBalancesLive.map(v => v.vendorName)} />}
          {view === 'history'   && <ImportHistory records={importHistory} getErrorsFor={(id, cb) => importSvc.subscribeErrors(id, cb)} />}
          {view === 'vendors'   && (
            <div className="p-6 flex flex-col h-full">
              <VendorBalances vendorBalances={vendorBalancesLive} topUps={topUps} tickets={tickets}
                onSaveVendor={handleSaveVendor} onDeleteVendor={handleDeleteVendor}
                onTopUp={handleTopUp} currency={currency} />
            </div>
          )}
          {view === 'reports'   && <Reports tickets={tickets} vendorBalances={vendorBalancesLive} topUps={topUps} currency={currency} />}
        </main>
      </div>

      <footer className="h-7 bg-slate-800 text-slate-500 flex items-center justify-between px-4 text-[9px] font-mono shrink-0">
        <span>NET = TOTAL − COMM · REFUND→NEGATIVE · FUND→POSITIVE</span>
        <div className="flex items-center space-x-2">
          <span>SUPABASE LIVE</span>
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return <AuthGuard>{(user) => <MainApp user={user} />}</AuthGuard>;
}
