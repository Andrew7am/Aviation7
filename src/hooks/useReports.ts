import { useMemo } from 'react';
import { Ticket, VendorBalance, BalanceTopUp } from '../types';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';

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
    // Memos are not ticket sales. An ACM is the airline crediting the agency
    // and an ADM is it billing back; neither was sold to a passenger, neither
    // flew a route, and a single -30,699 credit memo was enough to drag
    // British Airways to a negative total that looked like an error. They stay
    // in the ledger and in every balance — they just do not belong in a
    // ranking of what was sold.
    const MEMO = new Set(['ACM', 'ADM']);
    const real = tickets.filter(t =>
      t.status !== 'FUND' && !MEMO.has((t.status || '').toUpperCase()));
    const issues = real.filter(t => t.status !== 'REFUND');

    const tally = (
      keyOf: (t: Ticket) => string,
      countable: (t: Ticket) => boolean,
    ) => {
      const blank = (key: string) => ({
        key, tickets: 0, sar: 0, aed: 0, other: 0,
        // Kept alongside the net so a negative total can explain itself. An
        // airline selling mostly in SAR can still show a negative AED net —
        // a handful of AED sales against refunds of tickets issued earlier,
        // or an airline credit memo — and a bare minus sign reads as a bug.
        sarIssued: 0, sarRefunded: 0, aedIssued: 0, aedRefunded: 0,
      });
      const map = new Map<string, ReturnType<typeof blank>>();
      for (const t of real) {
        const key = keyOf(t);
        if (key === null as unknown as string) continue;
        const row = map.get(key) ?? blank(key);
        if (countable(t)) row.tickets++;
        // The currency a ticket is counted under is the VENDOR's — the rule the
        // ticket table, the summary bar and every export already use. The
        // stored `currency` column disagrees on 1,945 rows (IATA BSP tickets
        // saved as SAR when that BSP settles in AED), so trusting it here made
        // these totals contradict the screen they are read beside.
        const cur = sourceToCurrency(t.source || '');
        if (cur === 'SAR') {
          row.sar += t.amount;
          if (t.amount < 0) row.sarRefunded += t.amount; else row.sarIssued += t.amount;
        } else if (cur === 'AED') {
          row.aed += t.amount;
          if (t.amount < 0) row.aedRefunded += t.amount; else row.aedIssued += t.amount;
        } else {
          row.other += t.amount;
        }
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
