import { useState, useEffect } from 'react';
import { Ticket } from '../types';
import { TicketService } from '../services/TicketService';
import { detectDuplicates } from '../core/ImportEngine';

export function useTickets(userId: string) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const svc = new TicketService(userId);

  useEffect(() => {
    const unsub = svc.subscribe(data => {
      setTickets(detectDuplicates(data));
      setLoading(false);
    });
    return unsub;
  }, [userId]);

  const deleteTicket    = (id: string)                       => svc.delete(id);
  const updateReqNum    = (id: string, req: string)          => svc.updateReqNum(id, req);
  const updateTicket    = (id: string, patch: Partial<Ticket>) => svc.updateFields(id, patch);

  const missingReq = tickets.filter(t => !t.reqNum && t.status !== 'FUND');
  const topUps     = tickets.filter(t => t.status === 'FUND');

  return { tickets, loading, missingReq, topUps, deleteTicket, updateReqNum, updateTicket };
}
