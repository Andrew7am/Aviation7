/**
 * Shared parser utilities.
 * Date / Req / PNR-validity logic is NOT duplicated here — every parser
 * must import the single-source-of-truth helpers from `core/helpers/*`.
 * This file only holds column-lookup and cosmetic-cleanup helpers that
 * are genuinely generic across vendors and don't belong in `helpers/`.
 */
export function h(headers: string[]): string[] {
  return headers.map(c => (c || '').trim().toLowerCase().replace(/[^a-z0-9.]/g, ''));
}

export function hj(headers: string[]): string {
  return h(headers).join('|');
}

export function col(headers: string[], ...signals: string[]): number {
  const hh = h(headers);
  for (const sig of signals) {
    const s = sig.toLowerCase().replace(/[^a-z0-9.]/g, '');
    let i = hh.findIndex(c => c === s);
    if (i !== -1) return i;
    i = hh.findIndex(c => c.includes(s));
    if (i !== -1) return i;
  }
  return -1;
}

export function cell(row: string[], idx: number): string {
  return idx >= 0 && idx < row.length ? (row[idx] ?? '').trim() : '';
}

export function num(raw: string): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/[^0-9.-]/g, '').trim());
  return isNaN(n) ? 0 : n;
}

export function numNoText(raw: string): number {
  // Strips "AED 573.14" → 573.14
  return num(raw.replace(/^(AED|SAR|USD|EUR)\s*/i, ''));
}

export function pnrClean(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function cleanTk(raw: string): string {
  const m = raw.match(/^(\d{3})\s*[-–]\s*(\d+)/);
  return m ? m[1] + m[2] : raw.replace(/\s+/g, '');
}

export function airlineCode(ticketNo: string): string {
  const m1 = ticketNo.match(/^(\d{3})\s*[-–]\s*\d+/);
  if (m1) return m1[1];
  const m2 = ticketNo.match(/^(\d{3})\d{7,}/);
  return m2 ? m2[1] : '';
}

/**
 * rowContentId — a stable placeholder identifier for a row that has no
 * usable ticket/PNR reference, derived from the row's own content (not its
 * array position). A position-based id (e.g. `NOREF_${idx}`) silently
 * drifts whenever rows are added/removed anywhere earlier in the same
 * sheet — common on re-export, since vendors don't always append at the
 * bottom — which breaks duplicate detection for every placeholder row
 * after the shift point. This hashes every non-empty cell instead, so the
 * same logical row produces the same id regardless of where it sits.
 */
export function rowContentId(row: string[]): string {
  const content = row.map(c => (c ?? '').trim()).filter(Boolean).join('|');
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 31 + content.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function cleanPax(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().replace(/^(MR\.?|MRS\.?|MS\.?|DR\.?|INF\.?|CHD\.?)\s+/i, '');
  if (s.includes('/')) {
    const [last, first] = s.split('/');
    s = `${(first || '').trim()} ${(last || '').trim()}`.trim();
  }
  if (s.includes(',')) {
    const [last, first] = s.split(',');
    s = `${(first || '').trim()} ${(last || '').trim()}`.trim();
  }
  return s.replace(/\s+/g, ' ').toUpperCase().trim();
}
