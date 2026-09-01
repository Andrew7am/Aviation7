import { useMemo } from 'react';
import { Ticket, VendorBalance, BalanceTopUp } from '../types';
import { computeAnalytics } from '../core/helpers/analytics';

export function useReports(tickets: Ticket[], vendors: VendorBalance[], topUps: BalanceTopUp[]) {
  const totalIssued = useMemo(
    () => tickets.filter(t => t.amount > 0 && t.status !== 'FUND').reduce((s, t) => s + t.amount, 0),
    [tickets]
  );
  const totalRefunds = useMemo(
    () => tickets.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    [tickets]
  );
  const netTotal = totalIssued - totalRefunds;

  const bySource = useMemo(() => {
    const map = new Map<string, { count: number; amount: number; missing: number }>();
    tickets.filter(t => t.status !== 'FUND').forEach(t => {
      const s = t.source || 'Unknown';
      const prev = map.get(s) ?? { count: 0, amount: 0, missing: 0 };
      map.set(s, { count: prev.count + 1, amount: prev.amount + t.amount, missing: prev.missing + (t.reqNum ? 0 : 1) });
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, ...data }));
  }, [tickets]);

  // The share rankings live in core/helpers/analytics so the Reports screen can
  // run the same maths over a chosen period without a second implementation
  // drifting out of step with this one.
  const analytics = useMemo(() => computeAnalytics(tickets), [tickets]);

  const missingReq   = tickets.filter(t => !t.reqNum && t.status !== 'FUND');
  const duplicates   = tickets.filter(t => t.isDuplicate);

  return {
    totalIssued, totalRefunds, netTotal, bySource, missingReq, duplicates,
    byAirline: analytics.byAirline,
    byRoute:   analytics.byRoute,
  };
}
