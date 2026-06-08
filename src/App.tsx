import React, { useState, useEffect, useCallback } from 'react';
import { ViewState, Ticket, VendorBalance, BalanceTopUp, AppAlert } from './types';
import { db, auth, logout, OperationType, handleFirestoreError } from './utils/firebase';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc,
  writeBatch, query, where, getDoc
} from 'firebase/firestore';
import { AuthGuard } from './components/AuthGuard';
import { AlertBanner } from './components/AlertBanner';
import { Dashboard } from './components/Dashboard';
import { TicketTable } from './components/TicketTable';
import { ImportData } from './components/ImportData';
import { VendorBalances } from './components/VendorBalances';
import { Reports } from './components/Reports';
import { detectDuplicates } from './utils/parsing';
import {
  Plane, LayoutDashboard, List, AlertTriangle,
  Upload, LogOut, Wallet, BarChart2
} from 'lucide-react';
import { User } from 'firebase/auth';

/* ─────────────────────────────────────────────
   Vendor → source matching helper
───────────────────────────────────────────── */
function vendorMatchesSources(vendorName: string, tickets: Ticket[]): Ticket[] {
  const vn = vendorName.toLowerCase();
  return tickets.filter(t => {
    const src = (t.source || '').toLowerCase();
    if (src.includes(vn)) return true;
    // fuzzy aliases
    if (vn === 'flyadeal' && (src.includes('flyadeal ksa') || src.includes('flyadeal dxb'))) return true;
    if (vn === 'airarabia' && src.includes('air arabia')) return true;
    if (vn === 'goldmedal' && src.includes('gold medal')) return true;
    return false;
  });
}

/* ─────────────────────────────────────────────
   Balance recalculator
───────────────────────────────────────────── */
function recalcBalance(vendor: VendorBalance, tickets: Ticket[], topUps: BalanceTopUp[]): number {
  const linked = vendorMatchesSources(vendor.vendorName, tickets);
  const spent = linked.reduce((s, t) => s + t.amount, 0); // negative = refund, so subtract from spent
  const added = topUps
    .filter(tu => tu.vendorId === vendor.id)
    .reduce((s, tu) => s + tu.amount, 0);
  return vendor.initialBalance + added - spent;
}

/* ─────────────────────────────────────────────
   LOW BALANCE THRESHOLD
───────────────────────────────────────────── */
const LOW_PCT = 0.2;

function MainApp({ user }: { user: User }) {
  const [view, setView] = useState<ViewState>('dashboard');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [vendorBalances, setVendorBalances] = useState<VendorBalance[]>([]);
  const [topUps, setTopUps] = useState<BalanceTopUp[]>([]);
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [currency, setCurrency] = useState<'SAR' | 'AED'>('SAR');

  /* ── tickets listener ── */
  useEffect(() => {
    const q = query(collection(db, 'tickets'), where('userId', '==', user.uid));
    return onSnapshot(q, snap => {
      const data: Ticket[] = snap.docs.map(d => d.data() as Ticket);
      setTickets(detectDuplicates(data));
    }, err => handleFirestoreError(err, OperationType.LIST, 'tickets'));
  }, [user.uid]);

  /* ── vendors listener ── */
  useEffect(() => {
    const q = query(collection(db, 'vendorBalances'), where('userId', '==', user.uid));
    return onSnapshot(q, snap => {
      setVendorBalances(snap.docs.map(d => d.data() as VendorBalance));
    }, err => handleFirestoreError(err, OperationType.LIST, 'vendorBalances'));
  }, [user.uid]);

  /* ── topUps listener ── */
  useEffect(() => {
    const q = query(collection(db, 'balanceTopUps'), where('userId', '==', user.uid));
    return onSnapshot(q, snap => {
      setTopUps(snap.docs.map(d => d.data() as BalanceTopUp));
    }, err => console.error('topUps error', err));
  }, [user.uid]);

  /* ── recalculate & persist vendor currentBalance + fire low-balance alerts ── */
  useEffect(() => {
    if (vendorBalances.length === 0) return;

    vendorBalances.forEach(async vendor => {
      const newBalance = recalcBalance(vendor, tickets, topUps);
      if (Math.abs(newBalance - (vendor.currentBalance ?? vendor.initialBalance)) < 0.001) return;

      // persist recalculated balance
      try {
        await setDoc(doc(db, 'vendorBalances', vendor.id), { ...vendor, currentBalance: newBalance }, { merge: true });
      } catch (e) { console.error('balance sync error', e); }

      // fire low balance alert
      if (vendor.initialBalance > 0 && newBalance < vendor.initialBalance * LOW_PCT && newBalance >= 0) {
        const alertId = `low_${vendor.id}`;
        setAlerts(prev => {
          if (prev.some(a => a.id === alertId && !a.dismissed)) return prev;
          return [...prev.filter(a => a.id !== alertId), {
            id: alertId,
            type: 'low_balance',
            message: `⚠ ${vendor.vendorName} balance is below 20% — ${currency} ${newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} remaining`,
            vendorName: vendor.vendorName,
            dismissed: false,
            createdAt: new Date().toISOString(),
          }];
        });
      }
    });
  }, [tickets, topUps, vendorBalances, currency]);

  /* ── vendorBalances with live currentBalance ── */
  const vendorBalancesLive = vendorBalances.map(v => ({
    ...v,
    currentBalance: recalcBalance(v, tickets, topUps),
  }));

  /* ─────────── HANDLERS ─────────── */

  const handleSaveVendor = async (vendor: VendorBalance) => {
    try {
      await setDoc(doc(db, 'vendorBalances', vendor.id), { ...vendor, userId: user.uid });
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'vendorBalances'); }
  };

  const handleDeleteVendor = async (id: string) => {
    if (!confirm('Delete this vendor? This will not delete their tickets.')) return;
    try { await deleteDoc(doc(db, 'vendorBalances', id)); }
    catch (e) { handleFirestoreError(e, OperationType.DELETE, `vendorBalances/${id}`); }
  };

  const handleTopUp = async (topUp: BalanceTopUp) => {
    try {
      await setDoc(doc(db, 'balanceTopUps', topUp.id), { ...topUp, userId: user.uid });
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'balanceTopUps'); }
  };

  const handleImport = async (newTickets: Ticket[], updateTickets: Ticket[]) => {
    const batch = writeBatch(db);

    // new tickets
    newTickets.forEach(ticket => {
      const ref = doc(db, 'tickets', ticket.id);
      batch.set(ref, {
        ...ticket,
        userId: user.uid,
        createdAt: new Date().toISOString(),
        _isUpdate: undefined,
      });
    });

    // req num updates on existing tickets
    for (const ticket of updateTickets) {
      const existing = tickets.find(t => t.id === ticket.id || t.ticketNo === ticket.ticketNo);
      if (existing) {
        const ref = doc(db, 'tickets', existing.id);
        batch.set(ref, { reqNum: ticket.reqNum }, { merge: true });
      }
    }

    try {
      await batch.commit();
      // show quick toast via alert
      setAlerts(prev => [...prev, {
        id: `import_${Date.now()}`,
        type: 'duplicate',
        message: `✓ Imported ${newTickets.length} tickets${updateTickets.length > 0 ? ` · Updated ${updateTickets.length} req nums` : ''}`,
        dismissed: false,
        createdAt: new Date().toISOString(),
      }]);
      setView('tickets');
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'tickets');
    }
  };

  const handleDelete = async (id: string) => {
    try { await deleteDoc(doc(db, 'tickets', id)); }
    catch (e) { handleFirestoreError(e, OperationType.DELETE, `tickets/${id}`); }
  };

  const handleUpdateReqNum = async (id: string, reqNum: string) => {
    try {
      await setDoc(doc(db, 'tickets', id), { reqNum }, { merge: true });
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, `tickets/${id}`); }
  };

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a));
  }, []);

  /* ─────────── UI METRICS ─────────── */
  const missingReqCount = tickets.filter(t => !t.reqNum).length;
  const lowVendorCount = vendorBalancesLive.filter(
    v => v.initialBalance > 0 && v.currentBalance < v.initialBalance * LOW_PCT
  ).length;

  type NavItem = {
    id: ViewState;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeColor?: 'red' | 'amber' | 'slate';
  };
  const NAV: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'tickets', label: 'All Tickets', icon: <List className="w-4 h-4" />, badge: tickets.length },
    { id: 'missing', label: 'Action Required', icon: <AlertTriangle className="w-4 h-4" />, badge: missingReqCount, badgeColor: 'red' },
    { id: 'import', label: 'Import Data', icon: <Upload className="w-4 h-4" /> },
    { id: 'vendors', label: 'Vendor Credit', icon: <Wallet className="w-4 h-4" />, badge: lowVendorCount > 0 ? lowVendorCount : undefined, badgeColor: 'amber' },
    { id: 'reports', label: 'Reports', icon: <BarChart2 className="w-4 h-4" /> },
  ];

  return (
    <div className="h-screen bg-[#f8fafc] text-[#1e293b] font-sans flex flex-col overflow-hidden select-none">

      {/* ── Top header ── */}
      <header className="h-14 bg-[#0f172a] text-white flex items-center justify-between px-6 border-b border-white/10 shrink-0 z-20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow">
            <Plane className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-widest uppercase text-white leading-none">Luxury Explorers</h1>
            <p className="text-[9px] text-blue-400 font-mono uppercase tracking-wider leading-none mt-0.5">Ticket Reconciliation Portal</p>
          </div>
        </div>

        <div className="flex items-center space-x-4 text-xs">
          {/* Currency toggle */}
          <div className="flex items-center space-x-1 bg-white/5 rounded px-2 py-1">
            {(['SAR', 'AED'] as const).map(c => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`font-mono px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${currency === c ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/70'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-white/10" />
          <button
            onClick={() => setView('import')}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center space-x-1.5"
          >
            <Upload className="w-3 h-3" />
            <span>Import CSV / XLS</span>
          </button>
          <button onClick={logout} className="text-white/30 hover:text-white/70 transition-colors" title="Sign Out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Alert banner ── */}
      <AlertBanner alerts={alerts} onDismiss={dismissAlert} />

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* Sidebar */}
        <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {NAV.map(item => {
              const active = view === item.id;
              const isRed = item.badgeColor === 'red';
              const isAmber = item.badgeColor === 'amber';
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id as ViewState)}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded text-[11px] font-bold uppercase tracking-wider transition-all ${
                    active
                      ? isRed ? 'bg-red-50 text-red-700 border border-red-200'
                        : isAmber ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-slate-100 text-slate-900 border border-slate-200'
                      : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700 border border-transparent'
                  }`}
                >
                  <span className={active ? (isRed ? 'text-red-600' : isAmber ? 'text-amber-600' : 'text-slate-700') : 'text-slate-400'}>
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

          {/* Sidebar footer */}
          <div className="p-3 border-t border-slate-100 bg-slate-50/80">
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-slate-400">Tickets</span>
                <span className="font-bold text-slate-600">{tickets.length}</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-slate-400">Missing REQ</span>
                <span className={`font-bold ${missingReqCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{missingReqCount}</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-slate-400">Low Balance</span>
                <span className={`font-bold ${lowVendorCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{lowVendorCount} vendor{lowVendorCount !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[9px] font-mono text-slate-400">
              <span className="truncate max-w-[130px]">{user.email}</span>
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" />
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {view === 'dashboard' && (
            <Dashboard tickets={tickets} vendorBalances={vendorBalancesLive} currency={currency} />
          )}
          {view === 'tickets' && (
            <TicketTable
              title="Reconciliation Master List"
              tickets={tickets}
              onDelete={handleDelete}
              onUpdateReqNum={handleUpdateReqNum}
              currency={currency}
            />
          )}
          {view === 'missing' && (
            <TicketTable
              title="Needs Action — Missing REQ Numbers"
              tickets={tickets}
              defaultFilter="NEED_REQ"
              onDelete={handleDelete}
              onUpdateReqNum={handleUpdateReqNum}
              currency={currency}
            />
          )}
          {view === 'import' && (
            <ImportData
              existingTickets={tickets}
              onImport={handleImport}
              currency={currency}
              setCurrency={setCurrency}
            />
          )}
          {view === 'vendors' && (
            <div className="p-6 flex flex-col h-full">
              <VendorBalances
                vendorBalances={vendorBalancesLive}
                topUps={topUps}
                tickets={tickets}
                onSaveVendor={handleSaveVendor}
                onDeleteVendor={handleDeleteVendor}
                onTopUp={handleTopUp}
                currency={currency}
              />
            </div>
          )}
          {view === 'reports' && (
            <Reports
              tickets={tickets}
              vendorBalances={vendorBalancesLive}
              topUps={topUps}
              currency={currency}
            />
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="h-7 bg-slate-800 text-slate-500 flex items-center justify-between px-4 text-[9px] font-mono shrink-0">
        <div className="flex items-center space-x-3">
          <span>LOGIC: NET = TOTAL_DOC − COMM</span>
          <span className="text-slate-600">|</span>
          <span>CANN→0 · RFND→NEGATIVE · VOID→NEGATIVE</span>
        </div>
        <div className="flex items-center space-x-2">
          <span>FIREBASE LIVE</span>
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthGuard>
      {(user) => <MainApp user={user} />}
    </AuthGuard>
  );
}
