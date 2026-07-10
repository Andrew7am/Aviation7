/**
 * LearnedProfile — a column mapping for a vendor report format the AI
 * analyzed once. Stored in Supabase (ai_vendor_profiles) keyed by the
 * header fingerprint, then executed deterministically by ProfileParser
 * on every future upload of the same format (no further AI calls).
 *
 * Shared by: the AI analyze endpoint (validates Gemini's output against
 * the real headers), AIProfileService (persistence), and ProfileParser.
 */

/** Field slots ProfileParser knows how to consume. Values are header TEXT
 *  as it appears in the file (not indices — column order may shift). */
export interface LearnedColumns {
  ticket?:     string;
  pnr?:        string;
  passenger?:  string;
  date?:       string;
  amount?:     string;   // single signed-amount column
  debit?:      string;   // OR debit/credit pair
  credit?:     string;
  total?:      string;
  commission?: string;
  status?:     string;
  currency?:   string;
  route?:      string;
  req?:        string;
}

export interface LearnedRules {
  /** How refunds are represented in this format. */
  refund: 'negative_amount' | 'credit_column' | 'status_column';
}

export interface LearnedProfile {
  vendorName:  string;
  fingerprint: string;
  /** LCC-style report: no real ticket numbers, PNR is the row identifier. */
  isLCC:       boolean;
  headers:     string[];
  columns:     LearnedColumns;
  rules:       LearnedRules;
}

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/[^a-z0-9.]/g, '');

/** Normalized header row — the identity of a report format. Same fingerprint
 *  = same format = same saved profile, byte-for-byte deterministic. */
export function headerFingerprint(headers: string[]): string {
  return headers.map(norm).join('|');
}

/**
 * Header-row pick for the AI analysis path only. findHeaderRow() knows the
 * signals of the builtin vendors; a brand-new format may not match any of
 * them and would fall back to row 0 even when the real header sits under
 * title/meta rows. If the signal-based pick looks too sparse to be a header,
 * choose the densest row (most non-empty cells) in the search window instead.
 */
export function bestHeaderRowForAI(rows: string[][], signalBasedIdx: number, maxSearch = 15): number {
  const density = (r: string[]) => r.filter(c => c?.trim()).length;
  if (density(rows[signalBasedIdx] ?? []) >= 3) return signalBasedIdx;
  let best = signalBasedIdx, bestCount = 0;
  for (let i = 0; i < Math.min(rows.length, maxSearch); i++) {
    const d = density(rows[i]);
    if (d > bestCount) { bestCount = d; best = i; }
  }
  return best;
}

export const PROFILE_FIELDS: (keyof LearnedColumns)[] = [
  'ticket', 'pnr', 'passenger', 'date', 'amount', 'debit', 'credit',
  'total', 'commission', 'status', 'currency', 'route', 'req',
];

/**
 * Validate a profile draft (typically straight out of the AI) against the
 * actual header row. Drops mappings that don't resolve to a real header and
 * enforces the minimum a usable profile needs: some row identifier
 * (ticket or pnr) and some money column (amount or debit).
 * Returns the cleaned profile or a list of blocking problems.
 */
export function validateProfileDraft(
  draft: { vendorName?: unknown; isLCC?: unknown; columns?: unknown; rules?: unknown },
  headers: string[],
): { profile: Omit<LearnedProfile, 'fingerprint' | 'headers'>; warnings: string[] } | { errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const vendorName = typeof draft.vendorName === 'string' ? draft.vendorName.trim() : '';
  if (!vendorName) errors.push('AI did not return a vendor name.');

  const rawCols = (draft.columns && typeof draft.columns === 'object' ? draft.columns : {}) as Record<string, unknown>;
  const normedHeaders = headers.map(norm);
  const columns: LearnedColumns = {};

  for (const field of PROFILE_FIELDS) {
    const value = rawCols[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const idx = normedHeaders.indexOf(norm(value));
    if (idx === -1) {
      warnings.push(`Mapping for "${field}" points at header "${value}" which does not exist — dropped.`);
      continue;
    }
    columns[field] = headers[idx];
  }

  if (!columns.ticket && !columns.pnr) errors.push('No usable row identifier: neither a ticket nor a PNR column was mapped.');
  if (!columns.amount && !columns.debit && !columns.total) errors.push('No usable money column: neither amount, debit, nor total was mapped.');

  const rawRefund = (draft.rules as Record<string, unknown> | undefined)?.refund;
  const refund: LearnedRules['refund'] =
    rawRefund === 'credit_column' || rawRefund === 'status_column' || rawRefund === 'negative_amount'
      ? rawRefund
      : columns.credit ? 'credit_column' : columns.status ? 'status_column' : 'negative_amount';

  if (errors.length > 0) return { errors };

  return {
    profile: {
      vendorName,
      isLCC: draft.isLCC === true || (!columns.ticket && !!columns.pnr),
      columns,
      rules: { refund },
    },
    warnings,
  };
}
