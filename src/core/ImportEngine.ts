/**
 * Shared post-parse utilities used by every import flow:
 * - duplicate detection (compound key: ticket+vendor+pnr+amount+date for ISSUE,
 *   ticket+status+amount+date for REFUND/FUND/ADM/ACM so a refund never
 *   collides with its original issue)
 * - generic CSV/Excel file reading
 *
 * The actual per-vendor parsing lives in core/parsers/*Parser.ts — this file
 * intentionally does NOT parse rows itself.
 */
import * as XLSX from 'xlsx';
import { Ticket } from '../types';

/* ─────────────────────────────────────────────
   DUPLICATE DETECTION
   Rules (from roadmap):
   Compare: Ticket + Vendor + PNR + Amount + Date + Status
   REFUND/FUND/ADM/ACM on same ticket = NEVER a duplicate of an ISSUE row
   Two ISSUE rows on the same ticket = duplicate
───────────────────────────────────────────── */
const NON_ISSUE_STATUSES = new Set(['REFUND', 'FUND', 'ADM', 'ACM', 'EMD']);

function dupKey(t: Ticket): string {
  const status = (t.status || '').toUpperCase();
  const tk     = t.ticketNo.trim().toUpperCase();
  if (NON_ISSUE_STATUSES.has(status)) {
    return `${tk}|${status}|${Math.abs(t.amount).toFixed(2)}|${t.date}`;
  }
  return `${tk}|${(t.source||'').toLowerCase()}|${(t.pnr||'').toUpperCase()}|${Math.abs(t.amount).toFixed(2)}|${t.date}`;
}

// ── Detect duplicates within a single import batch ──
export function detectDuplicates(tickets: Ticket[]): Ticket[] {
  const seen = new Set<string>();
  return tickets.map(t => {
    const key = dupKey(t);
    if (seen.has(key)) return { ...t, isDuplicate: true };
    seen.add(key);
    return { ...t, isDuplicate: false };
  });
}

// ── Detect duplicates against the existing Firestore tickets ──
export function detectDuplicatesAgainstExisting(
  newTickets: Ticket[],
  existingTickets: Ticket[]
): { fresh: Ticket[]; updates: Ticket[]; duplicates: Ticket[] } {
  const existingKeys     = new Set(existingTickets.map(t => dupKey(t)));
  const existingByTicket = new Map(existingTickets.map(t => [t.ticketNo.trim().toUpperCase(), t]));
  const fresh:      Ticket[] = [];
  const updates:    Ticket[] = [];
  const duplicates: Ticket[] = [];

  newTickets.forEach(t => {
    const status   = (t.status || '').toUpperCase();
    const key      = dupKey(t);
    const ticketNo = t.ticketNo.trim().toUpperCase();
    const existing = existingByTicket.get(ticketNo);

    // REFUND / FUND / ADM / ACM — never a dup, always fresh
    if (NON_ISSUE_STATUSES.has(status)) { fresh.push(t); return; }

    // Same ticket appeared more than once WITHIN this import batch itself
    // (detectDuplicates() already flagged every occurrence after the first).
    // Without this check, two copies of the same ticket in one uploaded file
    // both land in `fresh` on a first-time import — neither exists in the DB
    // yet, so the against-existing check below never catches it — and the
    // "DUP" badge shown in the preview would be cosmetic only.
    if (t.isDuplicate) { duplicates.push(t); return; }

    if (existingKeys.has(key)) {
      // Exact match — but if existing is missing req num and we now have one, update instead
      if (existing && t.reqNum && (!existing.reqNum || !existing.reqNum.trim())) {
        updates.push({ ...t, id: existing.id });
      } else {
        duplicates.push({ ...t, isDuplicate: true });
      }
    } else if (!existing) {
      fresh.push(t);
    } else if (t.reqNum && (!existing.reqNum || !existing.reqNum.trim())) {
      updates.push({ ...t, id: existing.id });
    } else if (t.reqNum && existing.reqNum && t.reqNum !== existing.reqNum) {
      updates.push({ ...t, id: existing.id });
    } else {
      duplicates.push({ ...t, isDuplicate: true });
    }
  });

  return { fresh, updates, duplicates };
}

/* ─────────────────────────────────────────────
   FILE READING — CSV/TXT as plain text, XLSX via SheetJS → CSV
───────────────────────────────────────────── */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (file.name.match(/\.(csv|txt)$/i)) {
      reader.onload  = e => resolve(e.target?.result as string || '');
      reader.onerror = reject;
      reader.readAsText(file);
    } else {
      reader.onload  = e => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          resolve(XLSX.utils.sheet_to_csv(ws));
        } catch { reject(new Error('Failed to read Excel file')); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }
  });
}
