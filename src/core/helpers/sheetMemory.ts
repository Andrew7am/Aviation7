/**
 * What the Team Sheet Check remembers between runs: differences somebody
 * has explained, and the last sheet uploaded.
 *
 * Explained: the 4,600.00 their sheet writes as a refund on 5513437053 is a
 * staff liability, not a refund; the ten dirhams their sheet adds on RTS
 * tickets is their habit. Explained once, each stays out of the list - but
 * only while its figures stay what they were when it was explained. A
 * different figure is a different question, and it comes back.
 *
 * Changed: the next sheet is compared with the last one row by row, so the
 * person reviewing it reads what is new, what changed and what went, rather
 * than two thousand rows again.
 */
import type { TeamSheetRow } from '../parsers/teamSheet';

/** The difference, not the row it was found on. */
export const explanationKey = (f: { verdict: string; serial?: string; pnr?: string }) =>
  `${f.verdict}|${(f.serial || f.pnr || '').toUpperCase()}`;

/** The figures a difference stands on. */
export function fingerprint(f: {
  theirReq?: string; reqNum?: string;
  sheet?: { cost?: number | null; refund?: number | null; currency?: string; status?: string } | null;
  ours: { amount?: number }[];
}): string {
  const ours = Math.round(f.ours.reduce((n, t) => n + (t.amount || 0), 0) * 100) / 100;
  return [f.sheet?.status ?? '', f.sheet?.cost ?? '', f.sheet?.refund ?? '', f.sheet?.currency ?? '',
    ours, (f.theirReq || '').toUpperCase(), (f.reqNum || '').toUpperCase()].join('|');
}

export interface Explanation { id: string; findingKey: string; fingerprint: string; note: string; createdBy?: string; createdAt?: string }

/** Whether a finding is explained now: by key, and at the same figures. */
export function explanationFor<F extends Parameters<typeof fingerprint>[0] & { verdict: string; serial?: string; pnr?: string }>(
  f: F, byKey: Map<string, Explanation>,
): { explanation: Explanation; stale: boolean } | null {
  const e = byKey.get(explanationKey(f));
  if (!e) return null;
  return { explanation: e, stale: e.fingerprint !== fingerprint(f) };
}

/* ── the last sheet ─────────────────────────────────────────────────────── */

export interface SnapRow {
  key: string; ref: string; status: string; cost: number | null; refund: number | null;
  currency: string; reqNum: string; issued: string; rowNo: number;
}

/** A row, by what it is about: the document (or PNR), the event and its day. */
export function snapRows(rows: TeamSheetRow[]): SnapRow[] {
  const seen = new Map<string, number>();
  return rows.map(r => {
    const ref = r.serial || (r.pnr ? `PNR ${r.pnr}` : `row ${r.rowNo}`);
    const base = `${ref}|${r.rawStatus.toUpperCase()}|${r.issued}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return { key: n > 1 ? `${base}|${n}` : base, ref, status: r.rawStatus, cost: r.cost, refund: r.refund,
      currency: r.currency, reqNum: r.reqNum, issued: r.issued, rowNo: r.rowNo };
  });
}

export interface SheetChange { ref: string; what: string; rowNo?: number }
export interface SheetDiff { added: SheetChange[]; changed: SheetChange[]; removed: SheetChange[] }

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** What is new, what changed and what went since the last sheet. */
export function sheetDiff(before: SnapRow[], after: SnapRow[]): SheetDiff {
  const old = new Map(before.map(r => [r.key, r]));
  const now = new Map(after.map(r => [r.key, r]));
  const added: SheetChange[] = [], changed: SheetChange[] = [], removed: SheetChange[] = [];
  for (const r of after) {
    const o = old.get(r.key);
    if (!o) {
      added.push({ ref: r.ref, rowNo: r.rowNo, what: `${r.status}${r.cost != null ? ` ${fmt(r.cost)}` : ''}`
        + `${r.refund != null ? `, refund ${fmt(r.refund)}` : ''} ${r.currency}${r.reqNum ? ` · ${r.reqNum}` : ''}` });
      continue;
    }
    const d: string[] = [];
    if ((o.cost ?? null) !== (r.cost ?? null)) d.push(`cost ${fmt(o.cost)} → ${fmt(r.cost)}`);
    if ((o.refund ?? null) !== (r.refund ?? null)) d.push(`refund ${fmt(o.refund)} → ${fmt(r.refund)}`);
    if (o.currency !== r.currency) d.push(`currency ${o.currency || '—'} → ${r.currency || '—'}`);
    if (o.reqNum !== r.reqNum) d.push(`request ${o.reqNum || '—'} → ${r.reqNum || '—'}`);
    if (d.length) changed.push({ ref: r.ref, rowNo: r.rowNo, what: d.join(', ') });
  }
  for (const o of before) if (!now.has(o.key))
    removed.push({ ref: o.ref, what: `${o.status}${o.cost != null ? ` ${fmt(o.cost)}` : ''} ${o.currency}${o.reqNum ? ` · ${o.reqNum}` : ''}` });
  return { added, changed, removed };
}
