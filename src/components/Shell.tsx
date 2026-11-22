import React, { useEffect, useState } from 'react';
import { Plane, Upload, LogOut, PlusCircle, Eye, Menu, Moon, Sun, X } from 'lucide-react';
import { useTheme } from '../utils/theme';

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
  /** The section of the menu it sits in. A heading is drawn where it changes. */
  group?: string;
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
  /** Beside the header buttons - the Airtable bell. */
  headerExtra?: React.ReactNode;
  /** Sits full width under the header, above the nav and the content, which is
   *  where an alert about the whole workspace belongs. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

export const Shell: React.FC<Props> = ({
  navItems, view, onView, isAdmin, email, stats,
  onAddManually, onImport, onLogout, banner, children, headerExtra,
}) => {
  const { theme, setTheme } = useTheme();
  // Closed by default so a phone opens on the ledger rather than on a menu.
  const [navOpen, setNavOpen] = useState(false);
  // Escape closes the drawer, as it closes every dialog.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    /* 100dvh rather than 100vh: on a phone, 100vh is the height the viewport
       has with the browser's own chrome HIDDEN, so the footer and the last row
       of every screen sit under the address bar until you scroll. dvh tracks
       what is actually visible. */
    <div className="h-[100dvh] bg-app flex flex-col overflow-hidden select-none text-slate-800">
      {/* The header. White in the light, a navy a shade off the page in the
          dark - a band of the page, not a slab across it. The brand sits
          left: the plane in its navy square, gold, and the name. */}
      <header className="h-14 bg-app-header border-b border-slate-200 flex items-center justify-between px-3 sm:px-5 shrink-0 z-30 gap-2">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          {/* The only way back to the drawer once it is closed. */}
          <button onClick={() => setNavOpen(true)}
            className="lg:hidden -ml-1 p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 shrink-0"
            aria-label="Open the menu" aria-expanded={navOpen} aria-controls="app-nav">
            <Menu className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-md bg-[#111C2D] dark:bg-[#303944] ring-1 ring-gold-500/40 flex items-center justify-center shrink-0">
            <Plane className="w-[18px] h-[18px] text-[#C6A15B]" />
          </div>
          {/* Below sm the plane alone is the brand: the name and the header's
              six controls do not fit across a 360px phone together. */}
          <div className="hidden sm:block min-w-0 leading-none">
            <h1 className="text-xs sm:text-[13px] font-extrabold tracking-[0.16em] uppercase text-slate-900 truncate">
              Luxury Explorers
            </h1>
            <p className="hidden sm:block mt-1 text-micro font-semibold uppercase tracking-[0.14em] text-gold-700">
              Travel Accounting ERP
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {headerExtra}
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'} aria-label={theme === 'light' ? 'Dark mode' : 'Light mode'}
            className="hidden sm:flex p-2 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors">
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <span className="hidden sm:block w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
          {/* Adding and importing both write. A viewer gets a badge instead,
              so the read-only role is stated rather than just felt as a
              missing button. Under md the labels fold away and the icon
              carries the button. */}
          {isAdmin ? (
            <>
              <button onClick={onAddManually} title="Add Manually"
                className="h-9 md:h-8 px-2.5 md:px-3 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300
                           text-xs font-semibold flex items-center gap-1.5 transition-colors">
                <PlusCircle className="w-4 h-4 md:w-3.5 md:h-3.5" /><span className="hidden md:inline">Add manually</span>
              </button>
              <button onClick={onImport} title="Import CSV / XLS"
                className="h-9 md:h-8 px-2.5 md:px-3 rounded-md bg-blue-700 hover:bg-blue-800 text-white
                           text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors">
                <Upload className="w-4 h-4 md:w-3.5 md:h-3.5" /><span className="hidden md:inline">Import CSV / XLS</span>
              </button>
            </>
          ) : (
            <span title="You have read-only access. Ask the administrator to make changes."
              className="h-9 md:h-8 px-2.5 md:px-3 rounded-md bg-slate-100 text-slate-500 text-xs font-semibold flex items-center gap-1.5">
              <Eye className="w-4 h-4 md:w-3.5 md:h-3.5" /><span className="hidden md:inline">View only</span>
            </span>
          )}
          <button onClick={onLogout}
            className="p-2 -mr-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title="Sign Out" aria-label="Sign out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {banner}

      <div className="flex flex-1 min-h-0 relative">
        {navOpen && (
          <div className="lg:hidden fixed inset-0 bg-slate-950/40 z-30 motion-safe:animate-[fade-in_150ms_ease-out]"
               onClick={() => setNavOpen(false)} aria-hidden="true" />
        )}
        {/* On a phone the drawer is wider than the desktop rail - 18rem, never
            more than the screen less a strip of page to tap back onto. Hidden
            from the keyboard and from screen readers while it is off screen. */}
        <aside id="app-nav" aria-label="Screens"
          className={`w-[min(18rem,calc(100vw-3rem))] lg:w-60 bg-app-sidebar border-r border-slate-200 flex flex-col shrink-0
          absolute lg:static inset-y-0 left-0 z-40 lg:z-auto
          transition-[transform,visibility] duration-200 ease-out lg:transition-none
          ${navOpen ? 'translate-x-0 shadow-xl visible' : '-translate-x-full invisible lg:visible lg:translate-x-0'}`}>
          <div className="lg:hidden flex items-center justify-between px-4 h-12 border-b border-slate-200 shrink-0">
            <span className="text-mini font-semibold uppercase tracking-widest text-slate-500">Menu</span>
            {/* On a phone the theme switch lives here, out of the crowded header. */}
            <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="sm:hidden ml-auto mr-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100">
              {theme === 'light' ? <><Moon className="w-4 h-4" /> Dark</> : <><Sun className="w-4 h-4" /> Light</>}
            </button>
            <button onClick={() => setNavOpen(false)} aria-label="Close the menu"
              className="-mr-2 p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex-1 px-2.5 pb-3 overflow-y-auto overscroll-contain">
            {navItems.map((item, i) => {
              const active  = view === item.id;
              const heading = item.group && item.group !== navItems[i - 1]?.group ? item.group : '';
              /* The badge carries the colour, not the item: a red count says
                 something needs doing; the whole row red said it louder than
                 the count could be read. */
              const badge = item.badgeColor === 'red' ? 'bg-red-50 text-red-700 ring-red-200'
                : item.badgeColor === 'amber' ? 'bg-amber-50 text-amber-800 ring-amber-200'
                : 'bg-slate-100 text-slate-600 ring-slate-200';
              return (
                <React.Fragment key={item.id}>
                  {heading && (
                    <div className="px-2.5 pt-4 pb-1 text-micro font-semibold uppercase tracking-widest text-slate-400">
                      {heading}
                    </div>
                  )}
                  <button onClick={() => { onView(item.id); setNavOpen(false); }}
                    aria-current={active ? 'page' : undefined}
                    className={`group relative w-full flex items-center gap-2.5 px-2.5 h-10 lg:h-8 rounded-md text-sm lg:text-[13px] transition-colors ${
                      active ? 'bg-app-nav-active text-blue-800 font-semibold'
                             : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900'}`}>
                    {/* The active screen: a gold rule at the edge, and the row
                        a tint of the brand - found at a glance, never shouting. */}
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-gold-500 dark:bg-blue-500" aria-hidden="true" />}
                    <span className={`shrink-0 ${active ? 'text-gold-600 dark:text-blue-700' : 'text-slate-400 group-hover:text-slate-600'}`}>
                      {item.icon}
                    </span>
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className={`text-micro font-semibold px-1.5 min-w-[1.25rem] text-center rounded-full ring-1 ring-inset ${badge}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
          <div className="px-4 py-3 border-t border-slate-200 shrink-0">
            <div className="space-y-1">
              {stats.map(([label, val, cls]) => (
                <div key={label} className="flex justify-between text-mini">
                  <span className="text-slate-500">{label}</span>
                  <span className={`font-mono font-semibold ${cls || 'text-slate-700'}`}>{val}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between gap-2 text-micro text-slate-500">
              <span className="truncate">{email}</span>
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" title="Signed in" />
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col">
          {children}
        </main>
      </div>

      <footer className="h-7 bg-app-footer border-t border-slate-200 text-slate-400 flex items-center justify-between px-3 sm:px-5 text-micro font-mono shrink-0">
        <span className="hidden sm:inline">NET = TOTAL − COMM · REFUND→NEGATIVE · FUND→POSITIVE</span>
        <span className="sm:hidden">NET = TOTAL − COMM</span>
        <div className="flex items-center gap-2">
          <span>SUPABASE LIVE</span>
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full motion-safe:animate-pulse" />
        </div>
      </footer>
    </div>
  );
};

export default Shell;
