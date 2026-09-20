import React, { useState, useCallback } from 'react';
import { ViewState, Ticket, VendorBalance, BalanceTopUp, VendorStatement, AppAlert } from './types';
import { logout } from './utils/supabase';
import { AuthGuard } from './components/AuthGuard';
import { AlertBanner } from './components/AlertBanner';
import { Shell } from './components/Shell';
import { Dashboard } from './components/Dashboard';
import { TicketTable } from './components/TicketTable';

/**
 * Every screen except the two you land on is fetched when it is opened.
 *
 * All of them used to ship in one bundle - 1.2 MB before the dashboard could
 * paint - and most of that is weight nobody asked for: the spreadsheet writer
 * behind an export button, the charts on Reports, the whole of Settings. A
 * screen nobody opens today should cost nothing today.
 *
 * Dashboard and the ledger stay eager. They are what opens first and what
 * opens next, and splitting those would trade a smaller download for a
 * spinner on the two screens most used.
 */
const Requests        = React.lazy(() => import('./components/Requests').then(m => ({ default: m.Requests })));
const ImportData      = React.lazy(() => import('./components/ImportData').then(m => ({ default: m.ImportData })));
const VendorBalances  = React.lazy(() => import('./components/VendorBalances').then(m => ({ default: m.VendorBalances })));
const VendorStatements = React.lazy(() => import('./components/VendorStatements').then(m => ({ default: m.VendorStatements })));
const Reports         = React.lazy(() => import('./components/Reports').then(m => ({ default: m.Reports })));
const ImportHistory   = React.lazy(() => import('./components/ImportHistory').then(m => ({ default: m.ImportHistory })));
const ActivityLog     = React.lazy(() => import('./components/ActivityLog').then(m => ({ default: m.ActivityLog })));
const Settings        = React.lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const ManualEntry     = React.lazy(() => import('./components/ManualEntry').then(m => ({ default: m.ManualEntry })));

/** Shown while a screen's code is on its way. Deliberately plain: a skeleton
 *  that mimics a table invites the reader to believe figures are loading when
 *  what is loading is the page itself. */
const Loading: React.FC = () => (
  <div className="flex items-center justify-center h-full p-10">
    <span className="text-[11px] font-mono text-slate-400">loading…</span>
  </div>
);
import { AuditService, AuditRecord } from './services/AuditService';
import { undoableAction, UNDO_OF } from './core/helpers/undoableAction';
import { summariseVendor } from './core/helpers/statementMath';
import { useTickets } from './hooks/useTickets';
import { useWallet } from './hooks/useWallet';
import { useStatements } from './hooks/useStatements';
import { TicketService } from './services/TicketService';
import { ImportService, ImportRecord } from './services/ImportService';
import {
  LayoutDashboard, List, AlertTriangle, Upload, Wallet, BarChart2, History,
  ShieldCheck, Circle, Settings as SettingsIcon, FileText, FolderOpen,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';

const LOW_PCT = 0.2;

function MainApp({ user }: { user: User }) {
  const [view, setView]         = useState<ViewState>('dashboard');
  const [alerts, setAlerts]     = useState<AppAlert[]>([]);
  const [importHistory, setImportHistory] = useState<ImportRecord[]>([]);
  // Admin-only screens are hidden until the role is known, so a member never
  // briefly sees the Activity tab while the lookup is in flight.
  const [isAdmin, setIsAdmin]   = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);

  React.useEffect(() => { AuditService.myRole().then(r => setIsAdmin(r === 'admin')).catch(() => setIsAdmin(false)); }, [user.id]);

  const { tickets, missingReq, deleteTicket, updateReqNum, updateTicket, bulkUpdateReqNum, updateClosed, bulkUpdateClosed, revertClosed, addManualTicket, applyImport } = useTickets(user.id);
  const { vendors: vendorBalancesLive, topUps, saveVendor, deleteVendor, addTopUp, lowVendors } = useWallet(user.id, tickets);
  const { statements, saveStatement, deleteStatement } = useStatements(user.id);

  const ticketSvc = new TicketService(user.id);
  const importSvc = new ImportService(user.id);

  React.useEffect(() => importSvc.subscribeHistory(setImportHistory), [user.id]);

  /* Low balance is no longer raised as a banner across the top of every
   * screen. It was the same fact the Vendor Credit page already states more
   * usefully — an amber figure, a LOW badge and a bar showing how far down it
   * is — and a warning that follows you onto pages you cannot act from is one
   * you learn to dismiss without reading. The sidebar still carries the count
   * as a standing reminder, and lowVendors below still feeds it. */

  /* ── Import handler — now logs to ImportHistory + ErrorLog + AuditLog ── */
  const handleImport = async (
    newTickets: Ticket[],
    updateTickets: Ticket[],
    topUpTickets: Ticket[],
    settlementTickets: Ticket[],
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

      const { saved, updated, topups, settled } = await ticketSvc.saveImport(
        ticketsWithBalance, updateTickets, topUpTickets, vendorBalancesLive, settlementTickets
      );

      // Put the rows on screen now. The realtime refetch that follows would
      // eventually surface them, but only after a per-row event burst, the
      // debounce, and a full re-download of the table — for rows this client
      // just wrote and already holds.
      applyImport(ticketsWithBalance, updateTickets, settlementTickets);

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
        await importSvc.audit('IMPORT', meta.vendor,
          `${saved} tickets, ${updated} updates, ${settled} settled from invoice, ${topups} top-ups`);
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
  const handleSaveStatement   = (s: VendorStatement) => {
    saveStatement(s);
    importSvc.audit('SAVE_STATEMENT', s.vendorName, `${s.periodStart} to ${s.periodEnd}: closing ${s.closingBalance}`);
  };
  const handleDeleteStatement = (id: string) => {
    deleteStatement(id);
    importSvc.audit('DELETE_STATEMENT', id, 'Statement deleted');
  };
  const handleAddManual = async (t: Ticket) => {
    await addManualTicket(t);
    importSvc.audit('MANUAL_ENTRY', t.ticketNo, `Manual ${t.transactionType} — ${t.source} ${t.amount} ${t.currency}${t.reqNum ? ` (req ${t.reqNum})` : ''}`);
  };
  const handleDelete       = (id: string) => { if (confirm('Delete this ticket?')) { deleteTicket(id); importSvc.audit('DELETE', id, 'Ticket deleted'); } };
  const handleUpdateReqNum      = (id: string, req: string) => { updateReqNum(id, req); importSvc.audit('UPDATE_REQ', id, `New req: ${req}`); };
  const handleBulkUpdateReqNum  = async (findVal: string, replaceVal: string, ids: string[]) => {
    await bulkUpdateReqNum(ids, replaceVal.toUpperCase());
    importSvc.audit('BULK_UPDATE_REQ', ids.join(','), `Find: ${findVal} → Replace: ${replaceVal} (${ids.length} tickets)`);
  };
  const handleUpdateTicket = (id: string, patch: Partial<Ticket>) => {
    updateTicket(id, patch);
    const summary = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ');
    importSvc.audit('EDIT_TICKET', id, `Edited: ${summary}`);
  };
  const handleUpdateClosed     = (id: string, closed: boolean) => { updateClosed(id, closed); importSvc.audit('UPDATE_CLOSED', id, closed ? 'Closed' : 'Not Closed'); };
  const handleBulkUpdateClosed = async (ids: string[], closed: boolean) => {
    await bulkUpdateClosed(ids, closed);
    importSvc.audit('BULK_UPDATE_CLOSED', ids.join(','), `${closed ? 'Closed' : 'Not Closed'} (${ids.length} tickets)`);
  };
  /**
   * Take back a close or reopen that was logged earlier.
   *
   * The reversal is logged as its own entry naming the one it undid, which is
   * what stops the same mistake being undone twice and what makes the pair
   * legible in the log later. It records how many tickets actually moved, not
   * how many the original touched — tickets someone has since changed back by
   * hand are deliberately left where they are.
   */
  const handleUndoAction = async (entry: AuditRecord) => {
    const u = undoableAction(entry);
    if (!u) return;
    const moved = await revertClosed(u.ids, u.from, u.to);
    await importSvc.audit(
      u.ids.length > 1 ? 'BULK_UPDATE_CLOSED' : 'UPDATE_CLOSED',
      u.ids.join(','),
      `${u.to ? 'Closed' : 'Not Closed'} (${moved} ticket${moved === 1 ? '' : 's'}) ${UNDO_OF}${entry.id}`);
  };

  const dismissAlert       = useCallback((id: string) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a)), []);

  const missingReqCount = missingReq.length;
  // Same rule the Not Closed export uses: a top-up is not a ticket that
  // can be reconciled, so it is not outstanding work.
  const notClosedCount  = tickets.filter(t => !t.closed && t.status !== 'FUND').length;
  const lowVendorCount  = lowVendors.length;
  // A statement whose period disagrees with our own rows for the same dates,
  // or whose own figures do not foot. Either way somebody has to look at it,
  // so it earns a count in the sidebar the way missing req nums do.
  const statementGapCount = React.useMemo(
    () => ['Ibtekar', 'NSA']
      .flatMap(v => summariseVendor(v, statements, tickets).checks)
      .filter(c => Math.abs(c.billedGap) >= 0.011 || !c.foots).length,
    [statements, tickets]);

  /** Everything that changes data. Passed only to an admin — the database
   *  refuses these writes for anyone else (migration 0019), so offering the
   *  controls to a viewer would only produce failures. */
  const writeHandlers = {
    onDelete:            handleDelete,
    onUpdateReqNum:      handleUpdateReqNum,
    onUpdateTicket:      handleUpdateTicket,
    onBulkUpdateReqNum:  handleBulkUpdateReqNum,
    onUpdateClosed:      handleUpdateClosed,
    onBulkUpdateClosed:  handleBulkUpdateClosed,
  };

  /**
   * Requests whose rows are partly closed and partly not.
   *
   * The badge carries this rather than the number of requests, because the
   * total is a fact about how much work exists and this is a fact about work
   * that is being missed: a request with seventy-two closed rows and two open
   * ones reads as finished on every other screen.
   */
  const partClosedCount = React.useMemo(() => {
    const by = new Map<string, { closed: number; open: number }>();
    for (const t of tickets) {
      const k = (t.reqNum || '').trim().toUpperCase();
      if (!k || (t.status || '').toUpperCase() === 'FUND') continue;
      const g = by.get(k) ?? { closed: 0, open: 0 };
      t.closed ? g.closed++ : g.open++;
      by.set(k, g);
    }
    return [...by.values()].filter(g => g.closed > 0 && g.open > 0).length;
  }, [tickets]);

  type NavItem = { id: ViewState; label: string; icon: React.ReactNode; badge?: number; badgeColor?: 'red' | 'amber' | 'slate' };
  const NAV: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard',       icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'tickets',   label: 'All Tickets',     icon: <List className="w-4 h-4" />, badge: tickets.length },
    { id: 'requests',  label: 'Requests',        icon: <FolderOpen className="w-4 h-4" />, badge: partClosedCount || undefined, badgeColor: 'amber' },
    { id: 'missing',   label: 'Action Required', icon: <AlertTriangle className="w-4 h-4" />, badge: missingReqCount, badgeColor: 'red' },
    { id: 'notclosed', label: 'Not Closed',      icon: <Circle className="w-4 h-4" />, badge: notClosedCount || undefined, badgeColor: 'amber' },
    ...(isAdmin ? [{ id: 'import' as ViewState, label: 'Import Data', icon: <Upload className="w-4 h-4" /> }] : []),
    { id: 'history',   label: 'Import History',  icon: <History className="w-4 h-4" />, badge: importHistory.length || undefined },
    { id: 'vendors',   label: 'Vendor Credit',   icon: <Wallet className="w-4 h-4" />, badge: lowVendorCount || undefined, badgeColor: 'amber' },
    { id: 'statements', label: 'Vendor Statements', icon: <FileText className="w-4 h-4" />, badge: statementGapCount || undefined, badgeColor: 'red' },
    { id: 'reports',   label: 'Reports',         icon: <BarChart2 className="w-4 h-4" /> },
    ...(isAdmin ? [{ id: 'activity' as ViewState, label: 'Activity Log', icon: <ShieldCheck className="w-4 h-4" /> }] : []),
    ...(isAdmin ? [{ id: 'settings' as ViewState, label: 'Settings', icon: <SettingsIcon className="w-4 h-4" /> }] : []),
  ];

  return (
    <Shell
      navItems={NAV}
      view={view}
      onView={v => setView(v as ViewState)}
      isAdmin={isAdmin}
      email={user.email ?? ''}
      stats={[
        ['Tickets', tickets.length, ''],
        ['Missing REQ', missingReqCount, missingReqCount > 0 ? 'text-red-600' : 'text-emerald-600'],
        ['Low Balance', `${lowVendorCount} vendors`, lowVendorCount > 0 ? 'text-amber-600' : 'text-emerald-600'],
      ]}
      onAddManually={() => setShowManualEntry(true)}
      onImport={() => setView('import')}
      onLogout={logout}
      banner={<AlertBanner alerts={alerts} onDismiss={dismissAlert} />}
    >
      <React.Suspense fallback={<Loading />}>
      {showManualEntry && (
        <ManualEntry
          vendorNames={vendorBalancesLive.map(v => v.vendorName)}
          ledgerSources={[...new Set(tickets.map(t => t.source).filter(Boolean))]}
          onSave={handleAddManual}
          onClose={() => setShowManualEntry(false)}
        />
      )}

      {view === 'dashboard' && <Dashboard tickets={tickets} vendorBalances={vendorBalancesLive} topUps={topUps} />}
      {view === 'tickets'   && <TicketTable title="Reconciliation Master List" tickets={tickets} {...(isAdmin ? writeHandlers : {})} />}
      {view === 'requests'  && <Requests tickets={tickets}
        {...(isAdmin ? { onUpdateClosed: handleUpdateClosed } : {})} />}
      {view === 'missing'   && <TicketTable title="Needs Action — Missing REQ Numbers" tickets={tickets} defaultFilter="NEED_REQ" {...(isAdmin ? writeHandlers : {})} />}
      {view === 'notclosed' && <TicketTable title="Not Closed — Still To Reconcile" tickets={tickets} defaultClosed="NOT_CLOSED" {...(isAdmin ? writeHandlers : {})} />}
      {view === 'import'    && isAdmin && <ImportData userId={user.id} onImport={handleImport} vendorNames={vendorBalancesLive.map(v => v.vendorName)} />}
      {view === 'history'   && <ImportHistory records={importHistory} getErrorsFor={(id, cb) => importSvc.subscribeErrors(id, cb)} />}
      {/* No h-full on the wrapper below. Pinning it to the viewport meant
          an expanded vendor's transactions were taller than the box that
          held them, so the lower half — and the vendors under it — could
          not be reached: the wrapper never exceeded its parent, so main's
          own scrollbar never appeared. Letting it grow with its content is
          what gives the page something to scroll. */}
      {view === 'vendors'   && (
        <div className="p-6">
          <VendorBalances vendorBalances={vendorBalancesLive} topUps={topUps} tickets={tickets}
            canEdit={isAdmin}
            onSaveVendor={handleSaveVendor} onDeleteVendor={handleDeleteVendor}
            onTopUp={handleTopUp} />
        </div>
      )}
      {view === 'statements' && (
        <VendorStatements statements={statements} tickets={tickets} canEdit={isAdmin}
          topUps={topUps} wallets={vendorBalancesLive}
          onSave={handleSaveStatement} onDelete={handleDeleteStatement} />
      )}
      {view === 'reports'   && <Reports tickets={tickets} vendorBalances={vendorBalancesLive} topUps={topUps} />}
      {view === 'activity'  && (isAdmin
        ? <ActivityLog currentUserId={user.id} onUndo={handleUndoAction} />
        : <div className="p-10 text-center text-slate-400 font-sans text-sm">Admin access required.</div>)}
      {view === 'settings'  && (isAdmin
        ? <Settings />
        : <div className="p-10 text-center text-slate-400 font-sans text-sm">Admin access required.</div>)}
      </React.Suspense>
    </Shell>
  );
}

export default function App() {
  return <AuthGuard>{(user) => <MainApp user={user} />}</AuthGuard>;
}
