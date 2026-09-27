import { useState, useEffect, useMemo, useCallback } from 'react';
import { VoidTicketService, VoidTicket } from '../services/VoidTicketService';

/** The register of cancelled documents, live. */
export function useVoids(userId: string) {
  const [voids, setVoids] = useState<VoidTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const svc = useMemo(() => new VoidTicketService(userId), [userId]);

  const refresh = useCallback(async () => {
    try { setVoids(await svc.list()); }
    catch (e) { console.error('void_tickets error', e); }
    finally { setLoading(false); }
  }, [svc]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { voids, loading, refresh, remove: async (id: string) => { await svc.remove(id); await refresh(); } };
}
