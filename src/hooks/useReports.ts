import { useMemo } from 'react';
import { Ticket, VendorBalance, BalanceTopUp } from '../types';

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

  /**
   * Share of business by airline and by route.
   *
   * Amounts are kept PER CURRENCY, never summed into one figure. Twenty-eight
   * airlines in this ledger have tickets in both SAR and AED, and adding those
   * together produces a number that looks like money and is not — the reason
   * the vendor totals elsewhere are split the same way.
   *
   * Refunds are excluded from the count so "how many did we issue" means
   * issued, but their money still nets off the amounts, so the value shown is
   * what was actually earned rather than a gross that a cancellation already
   * took back.
   */
  const analytics = useMemo(() => {
    const real = tickets.filter(t => t.status !== 'FUND');
    const issues = real.filter(t => t.status !== 'REFUND');

    const tally = (
      keyOf: (t: Ticket) => string,
      countable: (t: Ticket) => boolean,
    ) => {
      const map = new Map<string, { key: string; tickets: number; sar: number; aed: number; other: number }>();
      for (const t of real) {
        const key = keyOf(t);
        if (key === null as unknown as string) continue;
        const row = map.get(key) ?? { key, tickets: 0, sar: 0, aed: 0, other: 0 };
        if (countable(t)) row.tickets++;
        if (t.currency === 'SAR')      row.sar += t.amount;
        else if (t.currency === 'AED') row.aed += t.amount;
        else                           row.other += t.amount;
        map.set(key, row);
      }
      const rows = [...map.values()].sort((a, b) => b.tickets - a.tickets);
      const total = rows.reduce((s, r) => s + r.tickets, 0) || 1;
      return rows.map(r => ({ ...r, pct: (r.tickets / total) * 100 }));
    };

    const isIssue = (t: Ticket) => t.status !== 'REFUND';

    const byAirline = tally(
      t => (t.airlineCode || '').trim() || 'No code',
      isIssue,
    );

    // Separators differ by vendor — "RUH/JED/RUH" and "RUH-JED-RUH" are one
    // route written two ways, so they are folded together. Direction is NOT:
    // MED-RUH and RUH-MED are different journeys and stay apart.
    const byRoute = tally(
      t => {
        const r = (t.route || '').trim().toUpperCase().replace(/[\\/]/g, '-').replace(/\s+/g, '');
        return r || (null as unknown as string);
      },
      isIssue,
    );

    return { byAirline, byRoute, issuedCount: issues.length };
  }, [tickets]);

  const missingReq   = tickets.filter(t => !t.reqNum && t.status !== 'FUND');
  const duplicates   = tickets.filter(t => t.isDuplicate);

  return {
    totalIssued, totalRefunds, netTotal, bySource, missingReq, duplicates,
    byAirline: analytics.byAirline,
    byRoute:   analytics.byRoute,
  };
}
