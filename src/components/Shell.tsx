import React, { useState } from 'react';
import { Plane, Upload, LogOut, PlusCircle, Eye, Menu } from 'lucide-react';

/**
 * The frame every screen sits in: header, navigation, footer.
 *
 * Lifted out of App so it can be exercised at a phone's width without signing
 * in. It was written for a desktop and only ever seen on one — a 224px sidebar
 * pinned open beside the content leaves a 375px phone 151px to read a ledger
 * in, and the header's two labelled buttons and a title pushed the sign-out
 * control off the right-hand edge.
 *
 * Below lg the sidebar is a drawer over the content, opened from the header
 * and dismissed by the backdrop or by picking a screen. At lg and above
 * nothing about it has changed.
 */
export interface ShellNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  badgeColor?: 'red' | 'amber' | 'slate';
}

interface Props {
  navItems: ShellNavItem[];
  view: string;
  onView: (id: string) => void;
  isAdmin: boolean;
  email: string;
  /** label, value, colour class — the running counts under the nav. */
  stats: [string, string | number, string][];
  onAddManually: () => void;
  onImport: () => void;
  onLogout: () => void;
  /** Sits full width under the header, above the nav and the content, which is
   *  where an alert about the whole workspace belongs. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

export const Shell: React.FC<Props> = ({
  navItems, view, onView, isAdmin, email, stats,
  onAddManually, onImport, onLogout, banner, children,
}) => {
  // Closed by default so a phone opens on the ledger rather than on a menu.
  const [navOpen, setNavOpen] = useState(false);

  return (
    /* 100dvh rather than 100vh: on a phone, 100vh is the height the viewport
       has with the browser's own chrome HIDDEN, so the footer and the last row
       of every screen sit under the address bar until you scroll. dvh tracks
       what is actually visible. */
    <div className="h-[100dvh] bg-[#f8fafc] flex flex-col overflow-hidden select-none">
      <header className="h-14 bg-[#0f172a] text-white flex items-center justify-between px-3 sm:px-6 border-b border-white/10 shrink-0 z-30 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* The only way back to the drawer once it is closed. */}
          <button onClick={() => setNavOpen(true)}
            className="lg:hidden -ml-1 p-2 rounded hover:bg-white/10 shrink-0"
            aria-label="Open the menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow shrink-0">
            <Plane className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[11px] sm:text-sm font-black tracking-widest uppercase text-white leading-none truncate">
              Luxury Explorers
            </h1>
            <p className="hidden sm:block text-[9px] text-blue-400 font-mono uppercase tracking-wider">
              Travel Accounting ERP
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          {/* Adding and importing both write. A viewer gets a badge instead,
              so the read-only role is stated rather than just felt as a
              missing button.

              The labels fold away under md and the icon carries the button.
              Two four-word labels and a title do not fit across a phone, and
              what gets pushed off the edge is the button, not the label. */}
          {isAdmin ? (
            <>
              <button onClick={onAddManually} title="Add Manually"
                className="bg-white/10 hover:bg-white/20 px-2.5 md:px-4 py-2 md:py-1.5 rounded text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                <PlusCircle className="w-3.5 h-3.5 md:w-3 md:h-3" /><span className="hidden md:inline">Add Manually</span>
              </button>
              <button onClick={onImport} title="Import CSV / XLS"
                className="bg-blue-600 hover:bg-blue-500 px-2.5 md:px-4 py-2 md:py-1.5 rounded text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 md:w-3 md:h-3" /><span className="hidden md:inline">Import CSV / XLS</span>
              </button>
            </>
          ) : (
            <span title="You have read-only access. Ask the administrator to make changes."
              className="bg-white/10 text-white/70 px-2.5 md:px-3 py-2 md:py-1.5 rounded text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 md:w-3 md:h-3" /><span className="hidden md:inline">View Only</span>
            </span>
          )}
          <button onClick={onLogout} className="text-white/30 hover:text-white/70 p-1" title="Sign Out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {banner}

      <div className="flex flex-1 min-h-0 relative">
        {navOpen && (
          <div className="lg:hidden fixed inset-0 bg-black/40 z-30"
               onClick={() => setNavOpen(false)} aria-hidden="true" />
        )}
        <aside className={`w-56 bg-white border-r border-slate-200 flex flex-col shrink-0
          absolute lg:static inset-y-0 left-0 z-40 lg:z-auto
          transition-transform duration-200 lg:transition-none
          ${navOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full lg:translate-x-0'}`}>
          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map(item => {
              const active  = view === item.id;
              const isRed   = item.badgeColor === 'red';
              const isAmber = item.badgeColor === 'amber';
              return (
                <button key={item.id} onClick={() => { onView(item.id); setNavOpen(false); }}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2.5 lg:py-2 rounded text-[11px] font-bold uppercase tracking-wider transition-all ${
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
          <div className="p-3 border-t border-slate-100 bg-slate-50/80 shrink-0">
            <div className="space-y-1.5">
              {stats.map(([label, val, cls]) => (
                <div key={label} className="flex justify-between text-[10px] font-mono">
                  <span className="text-slate-400">{label}</span>
                  <span className={`font-bold ${cls}`}>{val}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between gap-2 text-[9px] font-mono text-slate-400">
              <span className="truncate">{email}</span>
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" />
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col">
          {children}
        </main>
      </div>

      <footer className="h-7 bg-slate-800 text-slate-500 flex items-center justify-between px-3 sm:px-4 text-[9px] font-mono shrink-0">
        <span className="hidden sm:inline">NET = TOTAL − COMM · REFUND→NEGATIVE · FUND→POSITIVE</span>
        <span className="sm:hidden">NET = TOTAL − COMM</span>
        <div className="flex items-center space-x-2">
          <span>SUPABASE LIVE</span>
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        </div>
      </footer>
    </div>
  );
};

export default Shell;
