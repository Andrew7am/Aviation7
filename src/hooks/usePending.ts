import { useState, useEffect, useMemo } from 'react';
import { PendingTicket } from '../types';
import { PendingTicketService } from '../services/PendingTicketService';
import { v4 as uuidv4 } from 'uuid';

/** The review queue, live. Nothing in it is in the ledger yet. */
export function usePending(userId: string) {
  const [pending, setPending] = useState<PendingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const svc = useMemo(() => new PendingTicketService(userId), [userId]);

  useEffect(() => svc.subscribe(p => { setPending(p); setLoading(false); }), [svc]);

  return {
    pending,
    loading,
    raisePending:   (batch: PendingTicket[]) => svc.raise(batch),
    patchPending:   (id: string, patch: Partial<PendingTicket>) => svc.patch(id, patch),
    confirmPending: (p: PendingTicket) => svc.confirm(p, uuidv4()),
    rejectPending:  (id: string, why: string) => svc.reject(id, why),
    reopenPending:  (id: string) => svc.reopen(id),
    deletePending:  (id: string) => svc.remove(id),
  };
}
