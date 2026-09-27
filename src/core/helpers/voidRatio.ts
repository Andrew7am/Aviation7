import type { Ticket } from '../../types';

/**
 * How much of what we issued was cancelled.
 *
 * IATA caps this over a year, so the number that matters is annual — but a
 * year is found out too late to do anything about, and the damage is done a
 * period at a time. Both are given.
 *
 * The denominator is ISSUED PLUS VOIDED, not issued alone. A document that
 * was cancelled was still issued first: it was drawn against the agency's
 * stock, and leaving it out of the bottom of the fraction makes the ratio
 * look smaller exactly when it is growing. 334 voids against 1,567 live
 * documents is 21% the wrong way round and 17.6% the right way.
 *
 * Refunds are not voids and are not counted as either. A refund is a sale
 * that happened and was given back; a void never happened at all.
 */

export interface VoidRow {
  ticketNo: string;
  date: string;
  source: string;
  period?: string;
  faceValue?: number | null;
  currency?: string;
}

export interface RatioRow {
  /** 'YYYY-MM', or 'YYYY' on the annual roll-up. */
  key: string;
  issued: number;
  voided: number;
  /** voided / (issued + voided), 0 when nothing was drawn at all. */
  ratio: number;
  /** What the cancelled documents would have been worth. Context only. */
  voidValue: number;
}

/** A row an issuance ratio should count: a document drawn from stock. */
export function isIssuance(t: Ticket): boolean {
  const kind = (t.transactionType || t.status || '').toUpperCase();
  if (kind === 'REFUND') return false;
  // A wallet top-up is a payment, not a document.
  if (kind === 'FUND') return false;
  if ((t.amount ?? 0) < 0) return false;
  return true;
}

const month = (d: string) => (d || '').slice(0, 7);
const year = (d: string) => (d || '').slice(0, 4);
const round2 = (n: number) => Math.round(n * 100) / 100;

function build(
  issuedKeys: string[], voidRows: { key: string; value: number }[],
): RatioRow[] {
  const by = new Map<string, RatioRow>();
  const row = (key: string) => {
    let r = by.get(key);
    if (!r) { r = { key, issued: 0, voided: 0, ratio: 0, voidValue: 0 }; by.set(key, r); }
    return r;
  };
  for (const k of issuedKeys) if (k) row(k).issued++;
  for (const v of voidRows) if (v.key) { const r = row(v.key); r.voided++; r.voidValue += v.value; }
  for (const r of by.values()) {
    const drawn = r.issued + r.voided;
    r.ratio = drawn ? round2((r.voided / drawn) * 100) : 0;
    r.voidValue = round2(r.voidValue);
  }
  return [...by.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export interface VoidReport {
  byMonth: RatioRow[];
  byYear: RatioRow[];
  overall: RatioRow;
  /** Voids whose document the ledger also holds as a live sale. */
  alsoLive: string[];
}

export function voidReport(
  voids: VoidRow[], tickets: Ticket[], source?: string,
): VoidReport {
  const live = tickets.filter(t => isIssuance(t) && (!source || t.source === source));
  const vs = voids.filter(v => !source || v.source === source);

  const byMonth = build(live.map(t => month(t.date)),
                        vs.map(v => ({ key: month(v.date), value: Math.abs(v.faceValue ?? 0) })));
  const byYear = build(live.map(t => year(t.date)),
                       vs.map(v => ({ key: year(v.date), value: Math.abs(v.faceValue ?? 0) })));

  const drawn = live.length + vs.length;
  const overall: RatioRow = {
    key: 'all',
    issued: live.length,
    voided: vs.length,
    ratio: drawn ? round2((vs.length / drawn) * 100) : 0,
    voidValue: round2(vs.reduce((n, v) => n + Math.abs(v.faceValue ?? 0), 0)),
  };

  /* A document cannot be both cancelled and sold. Where it is both, one of
     the two records is wrong and somebody has to look — which is the whole
     reason these are kept rather than dropped. */
  const serial = (s: string) => (s || '').replace(/\D/g, '').slice(-10);
  const liveKeys = new Set(live.map(t => serial(t.ticketNo)).filter(Boolean));
  const alsoLive = [...new Set(
    vs.map(v => serial(v.ticketNo)).filter(k => k && liveKeys.has(k)))].sort();

  return { byMonth, byYear, overall, alsoLive };
}
