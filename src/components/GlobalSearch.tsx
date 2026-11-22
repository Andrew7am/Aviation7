import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FolderOpen, Ticket as TicketIcon } from 'lucide-react';
import type { Ticket } from '../types';
import { matchesSearch, searchSerial } from '../core/helpers/ticketIdentity';
import { reqTokensOf } from '../core/helpers/reqTokens';

/**
 * One search, at the top of the menu, for any ticket or request from any
 * screen. Ctrl+K (or Cmd+K) puts the cursor in it.
 *
 * It reads the ledger already in memory - no query of its own - and offers
 * two short lists: requests whose number holds what was typed, and tickets
 * found by number (written any way: 065-5513059068, 0655513059068...), PNR or
 * passenger. A request opens its profile where you are; a ticket opens All
 * Tickets searched for it. Nothing is changed by searching.
 */
const MAX = 6;

export const GlobalSearch: React.FC<{
  tickets: Ticket[];
  onOpenRequest: (reqNum: string) => void;
  onOpenTicket: (ticketNo: string) => void;
}> = ({ tickets, onOpenRequest, onOpenTicket }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // Ctrl+K / Cmd+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const term = q.trim();
  const results = useMemo(() => {
    if (term.length < 2) return { requests: [] as { req: string; rows: number }[], tickets: [] as Ticket[] };
    const upper = term.toUpperCase();
    const reqs = new Map<string, number>();
    const found: Ticket[] = [];
    const seen = new Set<string>();
    const serial = searchSerial(term);
    for (const t of tickets) {
      for (const r of reqTokensOf(t.reqNum || '')) if (r.includes(upper)) reqs.set(r, (reqs.get(r) ?? 0) + 1);
      if (found.length < MAX * 4) {
        const hay = `${t.ticketNo} ${t.pnr || ''} ${t.passengerName || ''} ${t.relatedTicket || ''}`;
        if ((serial && t.ticketNo.includes(serial)) || matchesSearch(hay, term)) {
          const key = `${t.ticketNo}|${t.status}`;
          if (!seen.has(key)) { seen.add(key); found.push(t); }
        }
      }
    }
    const requests = [...reqs.entries()]
      .sort((a, b) => (a[0] === upper ? -1 : b[0] === upper ? 1 : 0) || b[1] - a[1])
      .slice(0, MAX).map(([req, rows]) => ({ req, rows }));
    return { requests, tickets: found.slice(0, MAX) };
  }, [term, tickets]);

  type Item = { kind: 'req'; req: string; rows: number } | { kind: 'ticket'; t: Ticket };
  const items: Item[] = [
    ...results.requests.map(r => ({ kind: 'req' as const, ...r })),
    ...results.tickets.map(t => ({ kind: 'ticket' as const, t })),
  ];
  useEffect(() => setSel(0), [term]);

  const choose = (it: Item) => {
    setOpen(false);
    setQ('');
    input.current?.blur();
    if (it.kind === 'req') onOpenRequest(it.req);
    else onOpenTicket(it.t.ticketNo);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); choose(items[sel]); }
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const showList = open && term.length >= 2;

  return (
    <div ref={box} className="relative px-2.5 pt-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        <input ref={input} value={q} type="search" inputMode="search"
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          placeholder="Search ticket or request"
          aria-label="Search any ticket or request" aria-expanded={showList} aria-controls="global-search-results"
          role="combobox" aria-autocomplete="list"
          className="w-full h-9 lg:h-8 pl-8 pr-12 rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-800
                     placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20" />
        <kbd className="hidden lg:block absolute right-2 top-1/2 -translate-y-1/2 px-1.5 rounded border border-slate-200
                        text-micro font-sans text-slate-400 bg-white pointer-events-none">
          {mac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </div>

      {showList && (
        <div id="global-search-results" role="listbox"
          className="absolute left-2.5 right-2.5 lg:right-auto lg:w-[22rem] top-full mt-1 z-50 bg-white border border-slate-200
                     rounded-lg shadow-xl overflow-hidden max-h-[70vh] overflow-y-auto">
          {items.length === 0 && (
            <div className="px-3 py-4 text-xs text-slate-500">Nothing in the ledger matches “{term}”.</div>
          )}
          {results.requests.length > 0 && (
            <div className="px-3 pt-2.5 pb-1 text-micro font-semibold uppercase tracking-widest text-slate-400">Requests</div>
          )}
          {items.map((it, i) => {
            const first = it.kind === 'ticket' && (i === 0 || items[i - 1].kind !== 'ticket');
            return (
              <React.Fragment key={it.kind === 'req' ? `r${it.req}` : `t${it.t.id}`}>
                {first && <div className="px-3 pt-2.5 pb-1 text-micro font-semibold uppercase tracking-widest text-slate-400">Tickets</div>}
                <button type="button" role="option" aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)} onClick={() => choose(it)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${i === sel ? 'bg-slate-100' : ''}`}>
                  {it.kind === 'req' ? (
                    <>
                      <FolderOpen className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="flex-1 min-w-0 font-mono text-xs font-semibold text-slate-800 truncate">{it.req}</span>
                      <span className="text-micro text-slate-500 shrink-0">{it.rows} row{it.rows === 1 ? '' : 's'}</span>
                    </>
                  ) : (
                    <>
                      <TicketIcon className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block font-mono text-xs font-semibold text-slate-800 truncate">
                          {it.t.airlineCode ? `${it.t.airlineCode}-` : ''}{it.t.ticketNo}
                        </span>
                        <span className="block text-micro text-slate-500 truncate">
                          {[it.t.passengerName, it.t.reqNum, it.t.source, it.t.status].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
