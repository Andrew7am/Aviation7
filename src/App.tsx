import React, { useState, useCallback, useEffect } from 'react';
import { ViewState, Ticket, VendorBalance, BalanceTopUp, VendorStatement, AppAlert, PendingTicket } from './types';
import { logout } from './utils/supabase';
import { v4 as uuidv4 } from 'uuid';
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
const AirtablePage = React.lazy(() => import('./components/AirtablePage').then(m => ({ default: m.AirtablePage })));
const TeamSheetCheck  = React.lazy(() => import('./components/TeamSheetCheck').then(m => ({ default: m.TeamSheetCheck })));
const PendingReview   = React.lazy(() => import('./components/PendingReview').then(m => ({ default: m.PendingReview })));
const VendorBalances  = React.lazy(() => import('./components/VendorBalances').then(m => ({ default: m.VendorBalances })));
const VendorStatements = React.lazy(() => import('./components/VendorStatements').then(m => ({ default: m.VendorStatements })));
const Reports         = React.lazy(() => import('./components/Reports').then(m => ({ default: m.Reports })));
const TaxInvoices     = React.lazy(() => import('./components/TaxInvoices').then(m => ({ default: m.TaxInvoices })));
const Voids           = React.lazy(() => import('./components/Voids').then(m => ({ default: m.Voids })));
const Adms            = React.lazy(() => import('./components/Adms').then(m => ({ default: m.Adms })));
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
import type { Reprice } from './core/helpers/statementAgainstBooks';
import { AirtableService, type AirtableNotice, type SyncState } from './services/AirtableService';
import { AirtableBell } from './components/AirtableBell';
import { useTickets } from './hooks/useTickets';
import { useWallet } from './hooks/useWallet';
import { useStatements } from './hooks/useStatements';
import { usePending } from './hooks/usePending';
import { useTaxInvoices } from './hooks/useTaxInvoices';
import { useVoids } from './hooks/useVoids';
import { admKind } from './core/helpers/admRegister';
import { VoidTicketService } from './services/VoidTicketService';
import { ExchangeService } from './services/ExchangeService';
import type { ExchangeEdge } from './core/parsers/types';
import { voidsFromImport } from './core/helpers/voidFromImport';
import { changedAfterClose, AuditEvent } from './core/helpers/changedAfterClose';
import { coverageReport } from './core/helpers/taxInvoiceCoverage';
import { pendingFromFindings, ticketFromPending, whyNotConfirmable } from './core/helpers/pendingFromFindings';
import { planSheetAdd, waitingReasons, neverByHand } from './core/helpers/addFromSheet';
import type { Finding } from './core/helpers/teamSheetCompare';
import { TicketService } from './services/TicketService';
import { ImportService, ImportRecord } from './services/ImportService';
import {
  LayoutDashboard, List, AlertTriangle, Upload, Wallet, BarChart2, History,
  ShieldCheck, Circle, Settings as SettingsIcon, FileText, FolderOpen, FileSearch, ClipboardCheck, Receipt, Ban, FileWarning, Table2 } from 'lucide-react';
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
  const {
    pending, raisePending, patchPending, patchManyPending, confirmPending,
    rejectPending, reopenPending, deletePending,
  } = usePending(user.id);
  const {
    invoices: taxInvoices, upload: uploadTaxInvoices, remove: removeTaxInvoice,
  } = useTaxInvoices(user.id);
  const { voids, refresh: refreshVoids } = useVoids(user.id);
  const [exchanges, setExchanges] = useState<{ ticketNo: string; replacedTicket: string; fee?: number | null }[]>([]);
  React.useEffect(() => {
    new ExchangeService().list().then(setExchanges).catch(e => console.error('exchanges', e));
  }, []);

  /* Money changed after a ticket was closed. Read from the audit log, which
     only an admin can see — so for anyone else this stays empty and the
     badge never appears. Refetched when the ledger changes, because an edit
     is exactly what moves it. */
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  React.useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    /* The ledger changes in bursts — a bulk close moves forty rows and fires
       forty updates. Waiting for it to settle turns forty fetches into one. */
    const t = setTimeout(() => {
      AuditService.closeAndMoneyEvents()
        .then(e => { if (live) setAuditEvents(e); })
        .catch(err => console.error('audit events', err));
    }, 800);
    return () => { live = false; clearTimeout(t); };
  }, [isAdmin, tickets]);
  const afterClose = React.useMemo(
    () => changedAfterClose(auditEvents, tickets), [auditEvents, tickets]);

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
    voidedTickets: Ticket[],
    exchanges: ExchangeEdge[],
    meta?: { parserName: string; confidence: number; totalRows: number; warnings: number; errors: { row: number; raw: string; error: string }[]; vendor: string; reportName: string; confirmations?: { id: string; ticketNo: string; by: string }[];
      corrections?: { id: string; ticketNo: string; by: string; amount: number; totalDoc: number; commission: number; was: { amount: number } }[] }
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

      /* Cancelled documents are still discarded from the ledger — they move
         no money and belong in no balance — but they are no longer thrown
         away. IATA caps how much of a year's issuance may be voided, and
         that ratio cannot be counted from documents nobody kept. */
      /* Reissues, money or none. The zero-value ones never became ledger
         rows, and their link is the only thing tying a later refund of them
         back to the original that holds the money. */
      /* Rows recorded from their sheet or by hand that this supplier report
         carries at the same amount: confirmed, and said by what. */
      if (meta?.confirmations?.length) {
        try {
          await ticketSvc.confirm(meta.confirmations);
          for (const c of meta.confirmations)
            importSvc.audit('CONFIRMED', c.ticketNo, `Confirmed by ${c.by}: the supplier's report carries it at the amount we recorded.`);
        } catch (e) { console.error('confirmations not recorded', e); }
      }

      /* Rows from their sheet or by hand this supplier's report carries at a
         different amount: the report's figure goes in, and says so. */
      if (meta?.corrections?.length) {
        try {
          await ticketSvc.correctFromSupplier(meta.corrections);
          for (const c of meta.corrections)
            importSvc.audit('EDIT_TICKET', c.ticketNo,
              `amount: ${c.was.amount} -> ${c.amount} (corrected to ${c.by}; it had been recorded from the team sheet or by hand)`);
        } catch (e) { console.error('corrections not recorded', e); }
      }

      let exchangesKept = 0;
      if (exchanges?.length) {
        try {
          exchangesKept = await new ExchangeService()
            .record(exchanges, 'IATA BSP', meta?.reportName ?? '');
        } catch (e) { console.error('exchanges not recorded', e); }
      }

      let voidsKept = 0;
      if (voidedTickets?.length) {
        try {
          voidsKept = await new VoidTicketService(user.id)
            .record(voidsFromImport(voidedTickets, meta?.reportName ?? ''));
          await refreshVoids();
        } catch (e) {
          // Never fail an import over the register: the tickets are saved
          // and the voids can be re-read from the same file.
          console.error('voids not recorded', e);
        }
      }

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
          `${saved} tickets, ${updated} updates, ${settled} settled from invoice, ${topups} top-ups`
          + (voidsKept ? `, ${voidsKept} cancelled documents recorded` : '')
          + (exchangesKept ? `, ${exchangesKept} reissue links recorded` : ''));
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
      /* A supplier report carries no request; their Airtable does. Sync now
         rather than in up to two minutes, so the tickets just imported take
         their requests while the person is still looking at them. */
      airtable.syncNow().then(loadAirtable).catch(e => console.error('airtable sync after import', e));
    } catch (e) {
      console.error('Import error', e);
    }
  };

  const handleSaveVendor   = (v: VendorBalance) => { saveVendor(v); importSvc.audit('ADD_VENDOR', v.vendorName, `Initial balance: ${v.initialBalance}`); };
  const handleDeleteVendor = (id: string) => { if (confirm('Delete vendor?')) { deleteVendor(id); importSvc.audit('DELETE_VENDOR', id, 'Vendor deleted'); } };
  const handleTopUp        = (tu: BalanceTopUp) => { addTopUp(tu); importSvc.audit('TOPUP', tu.vendorName, `+${tu.amount}`); };
  /* ── the team's Airtable, live ─────────────────────────────────────────
     The server syncs it every two minutes; this reads the notices it left
     and the sync's health, and carries out what a person accepts. */
  const airtable = React.useMemo(() => new AirtableService(), []);
  const [atNotices, setAtNotices] = useState<AirtableNotice[]>([]);
  const [atSync, setAtSync] = useState<SyncState | null>(null);
  const loadAirtable = React.useCallback(async () => {
    try {
      const [n, s] = await Promise.all([airtable.notices(), airtable.state()]);
      setAtNotices(n); setAtSync(s);
    } catch (e) { console.error('airtable notices', e); }
  }, [airtable]);
  useEffect(() => {
    loadAirtable();
    const t = window.setInterval(loadAirtable, 60_000);
    return () => window.clearInterval(t);
  }, [loadAirtable]);

  const acceptNotices = async (list: AirtableNotice[]) => {
    const done: string[] = [];
    for (const n of list) {
      if (n.kind === 'REQ_CHANGED') {
        for (const o of (n.payload.ours ?? []) as { id: string; ticketNo: string; reqNum: string }[]) {
          if (!tickets.some(t => t.id === o.id)) continue;
          await updateTicket(o.id, { reqNum: String(n.payload.to) });
          importSvc.audit('EDIT_TICKET', o.ticketNo, `req: ${o.reqNum || '-'} -> ${n.payload.to} (moved on the team's Airtable)`);
        }
      } else if (n.kind === 'NAME' || n.kind === 'CABIN') {
        const field = n.kind === 'NAME' ? 'passengerName' : 'cabinClass';
        const value = String(n.kind === 'NAME' ? n.payload.name : n.payload.cabin);
        for (const id of n.ticketIds) {
          const t = tickets.find(x => x.id === id);
          // Fill only: a value somebody put in since is left alone.
          if (!t || String((t as any)[field] ?? '').trim()) continue;
          await updateTicket(id, { [field]: value } as Partial<Ticket>);
          importSvc.audit('EDIT_TICKET', t.ticketNo, `${n.kind === 'NAME' ? 'passenger_name' : 'cabin'}: - -> ${value} (from the team's Airtable)`);
        }
      } else if (n.kind === 'ONLINE_TICKET') {
        // Decided where every proposal is decided; the notice closes itself then.
        setView('review');
        continue;
      }
      done.push(n.id);
    }
    if (done.length) await airtable.decide(done, 'ACCEPTED', user.email ?? '');
    await loadAirtable();
  };
  const dismissNotices = async (list: AirtableNotice[]) => {
    await airtable.decide(list.map(n => n.id), 'DISMISSED', user.email ?? '');
    await loadAirtable();
  };
  const syncAirtableNow = async () => { await airtable.syncNow(); await loadAirtable(); };
  /* A ticket bought online is decided in To Review; once it is, its notice is done. */
  useEffect(() => {
    if (!isAdmin) return;
    const decided = atNotices.filter(n => n.kind === 'ONLINE_TICKET' && n.state === 'OPEN'
      && pending.some(p => p.dedupe === n.payload.dedupe && p.state !== 'PENDING'));
    if (decided.length) airtable.decide(decided.map(n => n.id), 'ACCEPTED', user.email ?? '').then(loadAirtable).catch(console.error);
  }, [atNotices, pending, isAdmin, airtable, loadAirtable, user.email]);

  const handleSaveStatement   = (s: VendorStatement) => {
    /* A statement opening on the same day as one already saved is its newer
       issue: Ibtekar's 01/08-30/09 opens where their 01/08-14/09 did, on a
       figure they have since revised. Kept side by side the two would split
       the account into overlapping periods, so the newer replaces it. */
    const superseded = statements.filter(o => o.id !== s.id && o.vendorName === s.vendorName
      && o.periodStart === s.periodStart);
    saveStatement(s);
    for (const o of superseded) deleteStatement(o.id);
    importSvc.audit('SAVE_STATEMENT', s.vendorName, `${s.periodStart} to ${s.periodEnd}: closing ${s.closingBalance}`
      + (superseded.length ? ` (replaces ${superseded.map(o => `${o.periodStart} to ${o.periodEnd}`).join(', ')})` : ''));
  };
  /* Tickets a vendor's statement bills at another figure: the statement is
     what will be paid, so its figure goes in, and the log says so. */
  const handleRepriceFromStatement = async (list: Reprice[]) => {
    for (const x of list) {
      await updateTicket(x.id, { amount: x.amount, adjustment: x.adjustment, adjustmentNote: x.adjustmentNote });
      importSvc.audit('EDIT_TICKET', x.ticketNo, `amount: ${x.was} -> ${x.amount} (the vendor's statement of account)`);
    }
  };
  const handleDeleteStatement = (id: string) => {
    deleteStatement(id);
    importSvc.audit('DELETE_STATEMENT', id, 'Statement deleted');
  };
  /* ── the review queue ──────────────────────────────────────────────────
     The team-sheet check finds tickets our books do not have; this is the
     only route from that screen into the ledger, and it stops at a
     proposal. Confirming one is what records it, one at a time, and every
     step of that is logged: a couple of hundred rows going into the ledger
     with nobody's name on them is exactly what this exists to prevent. */
  const handleSendToReview = async (findings: Finding[]) => {
    const batch = pendingFromFindings(findings, { newId: uuidv4, userId: user.id });
    const r = await raisePending(batch);
    importSvc.audit('PENDING_RAISED', 'TEAM_SHEET',
      `${r.added} raised, ${r.refreshed} refreshed, ${r.settled} already decided`);
    return r;
  };
  /**
   * Record the sheet's missing tickets that can be recorded, and queue the rest.
   *
   * "Ready" is decided by whyNotConfirmable — the same function behind the
   * confirm button in the review queue — so a row cannot get in through this
   * door that could not get in through that one. Everything else is raised
   * for review with the reason it is waiting, which is where it would have
   * gone anyway.
   */
  const handleAddFromSheet = async (findings: Finding[]) => {
    // Never a document the supplier voided, whatever their sheet still says.
    const voided = new Set(voids.map(v => (v.ticketNo || '').replace(/\D/g, '').slice(-10)));
    findings = findings.filter(f => !voided.has((f.serial || '').replace(/\D/g, '').slice(-10)));
    const plan = planSheetAdd(findings, { newId: uuidv4, userId: user.id, tickets });
    for (const p of plan.ready) {
      const t = ticketFromPending(p, uuidv4(), user.id);
      await addManualTicket(t);
      importSvc.audit('MANUAL_ENTRY', t.ticketNo,
        `Recorded from the team sheet — ${t.source} ${t.amount} ${t.currency}`
        + `${t.reqNum ? ` (req ${t.reqNum})` : ''}`);
    }
    // The rest go where they were always going.
    const queued = plan.waiting.length
      ? await raisePending(plan.waiting.map(w => w.proposal))
      : { added: 0, refreshed: 0, settled: 0 };
    importSvc.audit('PENDING_RAISED', 'TEAM_SHEET',
      `${plan.ready.length} recorded straight away, ${queued.added} raised for review,`
      + ` ${plan.alreadyHeld.length} already in the books`);
    return {
      added: plan.ready.length,
      queued: queued.added + queued.refreshed,
      alreadyHeld: plan.alreadyHeld.length,
      reasons: waitingReasons(plan),
    };
  };

  /* A row Team Sheet Check held back, put in by a person who read why. Never
     a wallet vendor's or a voided one, whatever the screen sends. It goes in
     as from their sheet, so it waits for a supplier report like any other. */
  const handleAddByHand = async (p: PendingTicket, why: string) => {
    const no = neverByHand(p);
    if (no) throw new Error(no);
    const voided = new Set(voids.map(v => (v.ticketNo || '').replace(/\D/g, '').slice(-10)));
    if (voided.has((p.ticketNo || '').replace(/\D/g, '').slice(-10))) throw new Error('Voided at the supplier - nothing to add.');
    const left = whyNotConfirmable(p);
    if (left) throw new Error(left);
    const t = ticketFromPending(p, uuidv4(), user.id);
    await addManualTicket(t);
    importSvc.audit('MANUAL_ENTRY', t.ticketNo,
      `Recorded from the team sheet by hand — ${t.source} ${t.amount} ${t.currency}`
      + `${t.reqNum ? ` (req ${t.reqNum})` : ''}; the check had held it back: ${why}`);
  };

  const handleConfirmPending = async (p: Parameters<typeof confirmPending>[0]) => {
    const t = await confirmPending(p);
    importSvc.audit('PENDING_CONFIRMED', t.ticketNo,
      `Recorded from the team sheet — ${t.source} ${t.amount} ${t.currency}`
      + `${t.reqNum ? ` (req ${t.reqNum})` : ''}`);
    return t;
  };
  const handleRejectPending = async (id: string, why: string) => {
    await rejectPending(id, why);
    importSvc.audit('PENDING_REJECTED', id, why || 'No reason given');
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
    /* Only what actually differs. A patch that repeats the current value is
       no edit at all — and on a closed ticket, logged as one, it reads as
       money changed after the client settled. The table guards this too;
       this is the second lock, for any caller that does not. */
    const current = tickets.find(t => t.id === id) as unknown as Record<string, unknown> | undefined;
    const same = (a: unknown, b: unknown) =>
      typeof a === 'number' || typeof b === 'number'
        ? Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005 && (a == null) === (b == null)
        : String(a ?? '') === String(b ?? '');
    const real = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => !current || !same(v, current[k])));
    if (!Object.keys(real).length) return;
    updateTicket(id, real as Partial<Ticket>);
    const summary = Object.entries(real).map(([k, v]) => `${k}=${v}`).join(', ');
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

  /** Waiting on somebody, so it belongs on the badge. A confirmed or
   *  rejected proposal is finished work and is not counted. */
  const pendingCount = pending.filter(p => p.state === 'PENDING').length;

  /** Tickets we could not produce a tax invoice for.
   *
   *  Counted only once an invoice has been uploaded. Before that every ticket
   *  is uncovered and the badge would read 294 in red — which is true and
   *  useless: it would be reporting that nobody has started, not that
   *  anything is wrong. */
  const noTaxInvoiceCount = React.useMemo(() => {
    if (!taxInvoices.length) return 0;
    return coverageReport(taxInvoices, tickets.filter(t => t.source === 'Ibtekar'))
      .uncovered.length;
  }, [taxInvoices, tickets]);

  type NavItem = { id: ViewState; label: string; icon: React.ReactNode; badge?: number; badgeColor?: 'red' | 'amber' | 'slate' };
  // Real memos only - an airline's ADM or ACM, or a supplier's. BSP's own fee is not counted.
  const admCount = React.useMemo(() => tickets.filter(t => { const k = admKind(t); return k && k !== 'BSP_FEE'; }).length, [tickets]);
  const NAV: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard',       icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'tickets',   label: 'All Tickets',     icon: <List className="w-4 h-4" />, badge: tickets.length },
    { id: 'requests',  label: 'Requests',        icon: <FolderOpen className="w-4 h-4" />, badge: partClosedCount || undefined, badgeColor: 'amber' },
    { id: 'missing',   label: 'Action Required', icon: <AlertTriangle className="w-4 h-4" />, badge: missingReqCount, badgeColor: 'red' },
    { id: 'notclosed', label: 'Not Closed',      icon: <Circle className="w-4 h-4" />, badge: notClosedCount || undefined, badgeColor: 'amber' },
    ...(isAdmin ? [{ id: 'import' as ViewState, label: 'Import Data', icon: <Upload className="w-4 h-4" /> }] : []),
    { id: 'teamsheet', label: 'Team Sheet Check', icon: <FileSearch className="w-4 h-4" /> },
    { id: 'airtable',  label: 'Airtable',        icon: <Table2 className="w-4 h-4" />, badge: atNotices.filter(n => n.state === 'OPEN').length || undefined, badgeColor: 'red' },
    { id: 'review',    label: 'To Review',        icon: <ClipboardCheck className="w-4 h-4" />,
      badge: pendingCount || undefined, badgeColor: 'amber' },
    { id: 'history',   label: 'Import History',  icon: <History className="w-4 h-4" />, badge: importHistory.length || undefined },
    { id: 'vendors',   label: 'Vendor Credit',   icon: <Wallet className="w-4 h-4" />, badge: lowVendorCount || undefined, badgeColor: 'amber' },
    { id: 'statements', label: 'Vendor Statements', icon: <FileText className="w-4 h-4" />, badge: statementGapCount || undefined, badgeColor: 'red' },
    { id: 'taxinvoices', label: 'Tax Invoices', icon: <Receipt className="w-4 h-4" />, badge: noTaxInvoiceCount || undefined, badgeColor: 'red' },
    { id: 'voids',     label: 'Voids',           icon: <Ban className="w-4 h-4" />, badge: voids.length || undefined, badgeColor: 'slate' },
    { id: 'adms',      label: 'ADMs',            icon: <FileWarning className="w-4 h-4" />, badge: admCount || undefined, badgeColor: 'red' },
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
      headerExtra={<AirtableBell notices={atNotices} sync={atSync} canEdit={isAdmin}
        onAccept={acceptNotices} onDismiss={dismissNotices} onSyncNow={syncAirtableNow} />}
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
      {view === 'tickets'   && <TicketTable title="Reconciliation Master List" tickets={tickets} voids={voids} afterClose={afterClose} exchanges={exchanges} {...(isAdmin ? writeHandlers : {})} />}
      {view === 'requests'  && <Requests tickets={tickets}
        {...(isAdmin ? { onUpdateClosed: handleUpdateClosed } : {})} />}
      {view === 'missing'   && <TicketTable title="Needs Action — Missing REQ Numbers" tickets={tickets} defaultFilter="NEED_REQ" {...(isAdmin ? writeHandlers : {})} />}
      {view === 'notclosed' && <TicketTable title="Not Closed — Still To Reconcile" tickets={tickets} defaultClosed="NOT_CLOSED" {...(isAdmin ? writeHandlers : {})} />}
      {view === 'import'    && isAdmin && <ImportData userId={user.id} onImport={handleImport} vendorNames={vendorBalancesLive.map(v => v.vendorName)} />}
      {/* Read-only, so everybody gets it: the person closing a flight sheet
          is not always the person who can write to the ledger. */}
      {view === 'airtable' && <AirtablePage tickets={tickets} notices={atNotices} sync={atSync} canEdit={isAdmin}
        onAccept={acceptNotices} onDismiss={dismissNotices} onSyncNow={syncAirtableNow}
        onOpenSheetCheck={() => setView('teamsheet')} />}
      {view === 'teamsheet' && <TeamSheetCheck tickets={tickets}
        voids={voids} exchanges={exchanges} userId={user.id} userEmail={user.email}
        {...(isAdmin ? { onSendToReview: handleSendToReview,
                         onAddToLedger: handleAddFromSheet, onAddByHand: handleAddByHand } : {})} />}
      {view === 'review'    && (
        <PendingReview
          pending={pending}
          voids={voids}
          vendorNames={vendorBalancesLive.map(v => v.vendorName)}
          ledgerSources={[...new Set(tickets.map(t => t.source).filter(Boolean))]}
          {...(isAdmin ? {
            onPatch:     patchPending,
            onPatchMany: patchManyPending,
            onConfirm: handleConfirmPending,
            onReject:  handleRejectPending,
            onReopen:  reopenPending,
            onDelete:  deletePending,
          } : {})} />
      )}
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
          onSave={handleSaveStatement} onDelete={handleDeleteStatement}
          onReprice={handleRepriceFromStatement} />
      )}
      {view === 'taxinvoices' && (
        <TaxInvoices tickets={tickets} invoices={taxInvoices}
          {...(isAdmin ? { onUpload: uploadTaxInvoices, onDelete: removeTaxInvoice } : {})} />
      )}
      {view === 'voids'     && <Voids voids={voids} tickets={tickets} />}
      {view === 'adms'      && <Adms tickets={tickets} />}
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
