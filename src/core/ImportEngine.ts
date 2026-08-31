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
import { extractPdfRows, pdfRowsToCsv } from './helpers/pdfText';
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
/**
 * The settlement vendor. A row from here is not a second sale — it is the
 * invoice for a document the portal already reported.
 */
const isSettlementSource = (source: string) => /^iata/i.test((source || '').trim());

/**
 * Document identity, independent of which vendor reported it.
 *
 * A ticket number identifies a document, and airline + serial identifies it
 * uniquely, so those are the key. Direction is part of it: a refund is its own
 * document and must never merge into the issue it reverses. The airline code
 * is only included when BOTH sides state one, so a row that never learned its
 * airline still matches on the serial rather than splitting off on its own.
 */
function documentKey(t: Ticket, withAirline: boolean): string {
  const dir = t.amount < 0 ? 'CR' : 'DR';
  const al  = withAirline ? (t.airlineCode || '').trim() : '';
  return `${al}|${t.ticketNo.trim().toUpperCase()}|${dir}`;
}

export function detectDuplicatesAgainstExisting(
  newTickets: Ticket[],
  existingTickets: Ticket[]
): { fresh: Ticket[]; updates: Ticket[]; duplicates: Ticket[]; settlements: Ticket[] } {
  const existingKeys = new Set(existingTickets.map(t => dupKey(t)));
  // Keyed on ticket AND vendor, never the ticket alone.
  //
  // Ticket numbers are stored as the bare serial now, so the portal row and
  // its BSP invoice line finally carry the SAME number — that is the whole
  // point of the normalisation, and it is what lets reconciliation pair them.
  // But this map decides whether an incoming row is new, and a ticket-only key
  // would answer "already have it" for the settlement row of a document the
  // portal reported first. The BSP line would then be dropped as a duplicate
  // (losing the commission and the payable, which only the invoice states) or
  // pushed as an update onto the portal row's id, overwriting it.
  //
  // A vendor-scoped key keeps both records: the same document seen through two
  // channels is two rows, one per vendor, exactly as the ledger needs it —
  // while a re-upload of the SAME report still dedupes, because that row
  // matches on vendor too.
  const vendorKey = (t: Ticket) =>
    `${t.ticketNo.trim().toUpperCase()}|${(t.source || '').trim().toLowerCase()}`;
  const existingByTicket = new Map(existingTickets.map(t => [vendorKey(t), t]));

  // The same DOCUMENT, whoever reported it. Used to spot the invoice line for
  // a ticket the portal already recorded. Indexed with and without the airline
  // so a row missing its airline code still finds its counterpart.
  const existingByDoc = new Map<string, Ticket>();
  for (const t of existingTickets) {
    existingByDoc.set(documentKey(t, true), t);
    const bare = documentKey(t, false);
    if (!existingByDoc.has(bare)) existingByDoc.set(bare, t);
  }
  const findDocument = (t: Ticket): Ticket | undefined => {
    const exact = existingByDoc.get(documentKey(t, true));
    if (exact) return exact;
    const bare = existingByDoc.get(documentKey(t, false));
    if (!bare) return undefined;
    // The serial-only fallback exists for rows that never learned their
    // airline. It must not reach across two airlines that DID state one and
    // disagree — airline + serial is what makes a document unique, and two
    // carriers can legitimately issue the same serial.
    const incoming = (t.airlineCode || '').trim();
    const held     = (bare.airlineCode || '').trim();
    if (incoming && held && incoming !== held) return undefined;
    return bare;
  };

  const fresh:       Ticket[] = [];
  const updates:     Ticket[] = [];
  const duplicates:  Ticket[] = [];
  const settlements: Ticket[] = [];

  newTickets.forEach(t => {
    const status   = (t.status || '').toUpperCase();
    const key      = dupKey(t);
    const existing = existingByTicket.get(vendorKey(t));

    // REFUND / FUND / ADM / ACM — dupKey() gives these a status-scoped key
    // format (no source/pnr) specifically so they can NEVER collide with an
    // ISSUE row on the same ticket. But they still need to dedupe against a
    // PREVIOUSLY saved instance of this exact same refund/fund/adjustment —
    // without this check every re-import of the same report insert the same
    // refund again, forever. Deliberately skip the existingByTicket/update
    // path below: that map holds one row per ticket+vendor without regard to
    // status, so a refund would find its own ISSUE there and be treated as an
    // update to it.
    if (NON_ISSUE_STATUSES.has(status)) {
      if (existingKeys.has(key)) duplicates.push({ ...t, isDuplicate: true });
      else fresh.push(t);
      return;
    }

    // ── The weekly invoice for a ticket the portal already reported ──
    //
    // The agency issues on a portal and uploads it daily to see what is
    // running; at the end of the week BSP invoices the same documents. Those
    // are ONE sale, so keeping both rows would double the money — 25 documents
    // in this ledger were counting 454,371.30 for 229,860.00 of real sales.
    //
    // The invoice supersedes: it alone states the commission and the balance
    // actually payable. So it does not become a row of its own, it updates the
    // document already there — one row per document, with the settled figures
    // on it. The vendor stays the issuing portal, so the ticket is still
    // visibly a Turkish sale, with the channel recording that it settled
    // through BSP.
    if (!existing && isSettlementSource(t.source)) {
      const doc = findDocument(t);
      if (doc && !isSettlementSource(doc.source)) {
        settlements.push({
          ...doc,                                   // keep vendor, pax, PNR, route
          amount:     t.amount,                     // net payable — the invoice's figure
          commission: t.commission,
          totalDoc:   t.totalDoc || doc.totalDoc,
          date:       t.date || doc.date,
          status:     t.status || doc.status,
          channel:    t.channel || 'BSP',
          serial:     t.serial ?? doc.serial,
          // The portal usually carries the req number and the invoice does not.
          reqNum:     doc.reqNum?.trim() ? doc.reqNum : t.reqNum,
        });
        return;
      }
    }

    // The mirror image: a portal report arriving for a document the invoice
    // already settled. The money on the settled row is the better figure, so
    // the portal row is not added — it may still contribute a req number.
    if (!existing && !isSettlementSource(t.source)) {
      const doc = findDocument(t);
      if (doc && isSettlementSource(doc.source)) {
        if (t.reqNum && !doc.reqNum?.trim()) updates.push({ ...t, id: doc.id });
        else duplicates.push({ ...t, isDuplicate: true });
        return;
      }
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

  return { fresh, updates, duplicates, settlements };
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
      // A PDF row is free text, not delimited columns, so the row's text goes
      // into ONE quoted CSV field — commas inside "4,080.00" would otherwise
      // be read as column breaks and shred every amount. A second field
      // carries the row's runs with their x positions, because a table's
      // columns cannot be recovered from token order alone: on a BSP invoice,
      // Standard and Supplementary Commission are told apart only by where
      // they sit on the page.
      reader.onload = async e => {
        try {
          const rows = await extractPdfRows(e.target?.result as ArrayBuffer);
          resolve(pdfRowsToCsv(rows));
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
