/**
 * Shared parser utilities.
 * Date / Req / PNR-validity logic is NOT duplicated here — every parser
 * must import the single-source-of-truth helpers from `core/helpers/*`.
 * This file only holds column-lookup and cosmetic-cleanup helpers that
 * are genuinely generic across vendors and don't belong in `helpers/`.
 */
import { toSerial, toAirlineCode } from '../helpers/ticketIdentity';

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

/** A booking reference: 5-6 alphanumeric with at least one letter, which is
 *  what keeps a bare number from being mistaken for one. */
export function isValidPNR(s: string): boolean {
  return /^[A-Z0-9]{5,6}$/i.test(s) && /[A-Z]/i.test(s);
}

/**
 * cleanTk / airlineCode — thin wrappers over the canonical splitter in
 * core/helpers/ticketIdentity.ts. Every parser already calls this pair, so
 * routing them here is what makes the whole import layer agree on one
 * spelling: `ticketNo` is the bare 10-digit serial, the airline lives in
 * `airlineCode`. See ticketIdentity.ts for why that split matters.
 *
 * `explicitCode` is the report's own airline column when it has one (BSP
 * "A/L"); pass it and it wins over anything inferred from the digits.
 */
export function cleanTk(raw: string, explicitCode?: string): string {
  return toSerial(raw, explicitCode);
}

export function airlineCode(ticketNo: string, explicitCode?: string): string {
  return toAirlineCode(ticketNo, explicitCode);
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

/** Courtesy titles, however the vendor punctuates them. Turkish's agency
 *  sales export puts the title AFTER the given name — "REFAE/AHMED MR" — so
 *  it has to be stripped from both ends or it ends up mid-name once the
 *  surname and given name are swapped ("AHMED MR REFAE"). */
const TITLE = String.raw`MR|MRS|MS|MSTR|MISS|DR|PROF|INF|CHD`;
const LEADING_TITLE  = new RegExp(`^(?:${TITLE})\\.?\\s+`, 'i');
const TRAILING_TITLE = new RegExp(`\\s+(?:${TITLE})\\.?$`, 'i');

export function cleanPax(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().replace(LEADING_TITLE, '').replace(TRAILING_TITLE, '');
  if (s.includes('/')) {
    const [last, first] = s.split('/');
    s = `${(first || '').trim()} ${(last || '').trim()}`.trim();
  }
  if (s.includes(',')) {
    const [last, first] = s.split(',');
    s = `${(first || '').trim()} ${(last || '').trim()}`.trim();
  }
  // Again after the swap: a title sitting on the given name is only at the
  // end of the string once the two halves have changed places.
  return s.replace(LEADING_TITLE, '').replace(TRAILING_TITLE, '')
          .replace(/\s+/g, ' ').toUpperCase().trim();
}
