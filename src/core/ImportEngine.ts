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
import { extractPdfRows } from './helpers/pdfText';
import { Ticket } from '../types';

/* ─────────────────────────────────────────────
   DUPLICATE DETECTION
   Rules (from roadmap):
   Compare: Ticket + Vendor + PNR + Amount + Date + Status
   REFUND/FUND/ADM/ACM on same ticket = NEVER a duplicate of an ISSUE row
   Two ISSUE rows on the same ticket = duplicate
───────────────────────────────────────────── */
const NON_ISSUE_STATUSES = new Set(['REFUND', 'FUND', 'ADM', 'ACM', 'EMD', 'VOID']);

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

    // REFUND / FUND / ADM / ACM — dupKey() gives these a status-scoped key
    // format (no source/pnr) specifically so they can NEVER collide with an
    // ISSUE row on the same ticket. But they still need to dedupe against a
    // PREVIOUSLY saved instance of this exact same refund/fund/adjustment —
    // without this check every re-import of the same report insert the same
    // refund again, forever. Deliberately skip the existingByTicket/update
    // path below: that map is keyed on bare ticketNo and would conflate this
    // row with an unrelated ISSUE sharing the same ticket number.
    if (NON_ISSUE_STATUSES.has(status)) {
      if (existingKeys.has(key)) duplicates.push({ ...t, isDuplicate: true });
      else fresh.push(t);
      return;
    }

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
   RECONCILIATION CLASSIFICATION

   Used for DISPLAY ONLY — the save path still runs through
   detectDuplicatesAgainstExisting above, unchanged. This exists so the
   import preview can explain *why* a row differs rather than just marking
   it a duplicate, which is what a settlement invoice needs: an invoice line
   whose only difference is commission is not a conflict, it is money the
   ledger has not captured yet.
───────────────────────────────────────────── */
export type ReconClass =
  | 'NEW'                 // not in the system at all
  | 'EXACT_MATCH'         // fare, commission and payable all agree
  | 'COMMISSION_MISSING'  // invoice charges commission the ledger does not have
  | 'COMMISSION_DIFF'     // both have commission, amounts differ
  | 'FARE_DIFF'           // the gross fare itself disagrees
  | 'PAYABLE_DIFF'        // payable differs for some other reason
  | 'DATE_DIFF'           // same money, different transaction date
  | 'CHANNEL_DIFF'        // same document settled under another channel
  | 'DUPLICATE';          // already present, identical

export interface ClassifiedRow {
  ticket:   Ticket;
  existing?: Ticket;
  cls:      ReconClass;
  /** invoice minus system, per value. Positive = invoice is higher. */
  delta:    { fare: number; commission: number; payable: number };
}

const money = (n: number | undefined) => Math.round((n ?? 0) * 100) / 100;
const differs = (a: number | undefined, b: number | undefined) => Math.abs(money(a) - money(b)) > 0.005;

/**
 * Compare incoming rows against what the system already holds and say what
 * kind of difference each one is.
 *
 * A row is NOT a mismatch merely because fare !== payable — that gap is the
 * commission and is expected on every commissionable ticket.
 */
export function classifyAgainstExisting(
  incoming: Ticket[],
  existing: Ticket[],
): ClassifiedRow[] {
  const byTicket = new Map<string, Ticket[]>();
  for (const t of existing) {
    const k = t.ticketNo.trim().toUpperCase();
    const list = byTicket.get(k);
    if (list) list.push(t); else byTicket.set(k, [t]);
  }

  return incoming.map(t => {
    const key = t.ticketNo.trim().toUpperCase();
    const sameDoc = byTicket.get(key) ?? [];
    // Match within the same direction of money: a refund must not be compared
    // against the original issue of the same document number.
    const wantNegative = t.amount < 0;
    const match = sameDoc.find(e => (e.amount < 0) === wantNegative) ?? sameDoc[0];

    const delta = {
      fare:       money((t.totalDoc ?? 0) - (match?.totalDoc ?? 0)),
      commission: money((t.commission ?? 0) - (match?.commission ?? 0)),
      payable:    money(t.amount - (match?.amount ?? 0)),
    };

    if (!match) return { ticket: t, cls: 'NEW' as ReconClass, delta };

    const commissionOnInvoice = Math.abs(money(t.commission)) > 0.005;
    const commissionInSystem  = Math.abs(money(match.commission)) > 0.005;

    let cls: ReconClass;
    if (commissionOnInvoice && !commissionInSystem)      cls = 'COMMISSION_MISSING';
    else if (differs(t.commission, match.commission))    cls = 'COMMISSION_DIFF';
    else if (differs(t.totalDoc, match.totalDoc))        cls = 'FARE_DIFF';
    else if (differs(t.amount, match.amount))            cls = 'PAYABLE_DIFF';
    else if ((t.source || '') !== (match.source || ''))  cls = 'CHANNEL_DIFF';
    else if (t.date && match.date && t.date !== match.date) cls = 'DATE_DIFF';
    else if (t.isDuplicate)                              cls = 'DUPLICATE';
    else                                                 cls = 'EXACT_MATCH';

    return { ticket: t, existing: match, cls, delta };
  });
}

export const RECON_LABEL: Record<ReconClass, string> = {
  NEW:                'New',
  EXACT_MATCH:        'Match',
  COMMISSION_MISSING: 'Commission Missing',
  COMMISSION_DIFF:    'Commission Differs',
  FARE_DIFF:          'Fare Differs',
  PAYABLE_DIFF:       'Payable Differs',
  DATE_DIFF:          'Date Differs',
  CHANNEL_DIFF:       'Channel Differs',
  DUPLICATE:          'Duplicate',
};

/* ─────────────────────────────────────────────
   FILE READING — CSV/TXT as plain text, XLSX via SheetJS → CSV,
   PDF via its own text layer → one CSV field per visual row
───────────────────────────────────────────── */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (file.name.match(/\.(csv|txt)$/i)) {
      reader.onload  = e => resolve(e.target?.result as string || '');
      reader.onerror = reject;
      reader.readAsText(file);
    } else if (file.name.match(/\.pdf$/i)) {
      // A PDF row is free text, not delimited columns, so each row is emitted
      // as ONE quoted CSV field. Papa then yields [[row], [row], …] and the
      // parser splits each row itself — commas inside "4,080.00" would
      // otherwise be read as column breaks and shred every amount.
      reader.onload = async e => {
        try {
          const rows = await extractPdfRows(e.target?.result as ArrayBuffer);
          resolve(rows.map(r => `"${r.replace(/"/g, '""')}"`).join('\n'));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Failed to read PDF'));
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload  = e => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // rawNumbers keeps the cell's underlying value instead of the text
          // Excel happens to display. Without it a long ticket number stored
          // as a number comes through as "2.35254E+12" — identical for every
          // row — so a whole report collapses onto one ticket and the rest
          // are silently discarded as duplicates.
          resolve(XLSX.utils.sheet_to_csv(ws, { rawNumbers: true }));
        } catch { reject(new Error('Failed to read Excel file')); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }
  });
}
