import { useState, useEffect, useRef } from 'react';
import { Ticket } from '../types';
import { TicketService } from '../services/TicketService';
import { detectDuplicates, mergeImported } from '../core/ImportEngine';

export function useTickets(userId: string) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const svc = new TicketService(userId);

  // Coalesce the postgres_changes bursts a bulk update kicks off — otherwise
  // updating 100 tickets fires 100 realtime events, each triggering a full
  // 4,937-row refetch. This debounce collapses them into one.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = svc.subscribe(data => {
      setTickets(detectDuplicates(data));
      setLoading(false);
    }, undefined, {
      onEvent: (fetchAll) => {
        if (refetchTimer.current) clearTimeout(refetchTimer.current);
        refetchTimer.current = setTimeout(() => fetchAll(), 400);
      },
    });
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      unsub();
    };
  }, [userId]);

  /** Optimistic patch — mutate local state immediately so the UI reflects
   *  the change without waiting on Supabase realtime + full refetch. If the
   *  DB write fails, the eventual refetch (or next successful mutation)
   *  restores truth. */
  const patchLocal = (mutator: (t: Ticket) => Ticket | null, matchIds?: Set<string>) => {
    setTickets(prev => prev.map(t => (matchIds && !matchIds.has(t.id)) ? t : (mutator(t) ?? t)));
  };

  const deleteTicket = async (id: string) => {
    setTickets(prev => prev.filter(t => t.id !== id));
    await svc.delete(id);
  };

  const addManualTicket = async (ticket: Ticket) => {
    setTickets(prev => detectDuplicates([...prev, ticket]));
    await svc.addManual(ticket);
  };

  /**
   * Show an import the moment it is saved.
   *
   * Every other mutation here patches local state first; import was the one
   * that did not, so a finished upload sat invisible while realtime fired an
   * event per row, waited out the 400ms debounce, and then re-downloaded the
   * whole table just to surface rows the client already had in hand.
   *
   * Each group is applied EXACTLY as saveImport() writes it, so local state
   * says what the database says: fresh rows are added whole, `updates` touch
   * only the req number and serial, and settlements carry the invoice's money
   * onto the row already there. Anything wrong here is corrected by the
   * refetch that follows anyway — it just no longer has to be waited for.
   */
  const applyImport = (
    fresh:       Ticket[],
    updates:     Ticket[] = [],
    settlements: Ticket[] = [],
  ) => {
    setTickets(prev => detectDuplicates(mergeImported(prev, fresh, updates, settlements)));
  };

  const updateReqNum = async (id: string, req: string) => {
    patchLocal(t => ({ ...t, reqNum: req }), new Set([id]));
    await svc.updateReqNum(id, req);
  };

  const updateTicket = async (id: string, patch: Partial<Ticket>) => {
    patchLocal(t => ({ ...t, ...patch }), new Set([id]));
    await svc.updateFields(id, patch);
  };

  const bulkUpdateReqNum = async (ids: string[], req: string) => {
    const idSet = new Set(ids);
    patchLocal(t => ({ ...t, reqNum: req }), idSet);
    await svc.bulkUpdateReqNum(ids, req);
  };

  const updateClosed = async (id: string, closed: boolean) => {
    patchLocal(t => ({ ...t, closed }), new Set([id]));
    await svc.updateClosed(id, closed);
  };

  const bulkUpdateClosed = async (ids: string[], closed: boolean) => {
    const idSet = new Set(ids);
    patchLocal(t => ({ ...t, closed }), idSet);
    await svc.bulkUpdateClosed(ids, closed);
  };

  const missingReq = tickets.filter(t => !t.reqNum && t.status !== 'FUND');
  const topUps     = tickets.filter(t => t.status === 'FUND');

  return { tickets, loading, missingReq, topUps, deleteTicket, updateReqNum, updateTicket, bulkUpdateReqNum, updateClosed, bulkUpdateClosed, addManualTicket, applyImport };
}
