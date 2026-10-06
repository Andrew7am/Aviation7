/**
 * What the aviation team has to put right on their own Airtable.
 *
 * Not our books: rows of theirs that cannot be checked as they stand, or
 * that will mislead whoever reads them - a ticket column holding "EMD" or a
 * passenger's name, an issued ticket with no request or no cost, one ticket
 * issued on two rows. Listed so it can be sent to them; nothing here is ours
 * to change.
 */
export interface FixRow {
  record_id: string; ticket_cell: string; serials: string[]; pnr: string; status: string;
  req_num: string; net_cost: number | null; currency: string; portal: string; team_member: string;
  issued_at: string | null;
}

export type FixKind = 'NO_NUMBER' | 'NO_REQUEST' | 'NO_COST' | 'ISSUED_TWICE';

export const FIX_LABEL: Record<FixKind, string> = {
  NO_NUMBER: 'No ticket number',
  NO_REQUEST: 'No request number',
  NO_COST: 'Issued with no cost',
  ISSUED_TWICE: 'Same ticket issued on two rows',
};

export interface Fix { kind: FixKind; row: FixRow; what: string }

const live = (s: string) => !/hold|void/i.test(s);
const issued = (s: string) => /^issued$/i.test((s || '').trim());

/**
 * `expectsNumber` says whether a row's portal issues ticket numbers at all.
 * Flyadeal, flydubai, Air Arabia, flynas, IndiGo and airline websites sell
 * on a booking reference; a row of theirs with a PNR and no number is how
 * those are written, not a fault.
 */
export function teamFixes(rows: FixRow[], expectsNumber: (portal: string) => boolean = () => true): Fix[] {
  const out: Fix[] = [];
  const bySerial = new Map<string, FixRow[]>();
  for (const r of rows) {
    const cell = (r.ticket_cell || '').trim();
    const numbers = r.serials.filter(s => /^\d{10}$/.test(s));
    // A website booking held under its PNR is their convention, not a fault.
    const pnrOnly = r.serials.length > 0 && !numbers.length && r.serials.every(s => s === r.pnr || /^[A-Z0-9]{5,8}$/.test(s));
    const numberDue = expectsNumber(r.portal || '') || !(r.pnr || '').trim();
    if (live(r.status) && !numbers.length && !pnrOnly && numberDue)
      out.push({ kind: 'NO_NUMBER', row: r, what: cell ? `The ticket column reads "${cell.replace(/\s+/g, ' ').slice(0, 60)}".` : 'The ticket column is empty.' });
    if (live(r.status) && !(r.req_num || '').trim())
      out.push({ kind: 'NO_REQUEST', row: r, what: 'No request is linked, so it belongs to no file.' });
    if (issued(r.status) && r.net_cost == null)
      out.push({ kind: 'NO_COST', row: r, what: 'Issued, and no net cost written.' });
    if (issued(r.status)) for (const s of numbers) {
      if (!bySerial.has(s)) bySerial.set(s, []);
      bySerial.get(s)!.push(r);
    }
  }
  for (const [s, rs] of bySerial) if (rs.length > 1)
    for (const r of rs) out.push({ kind: 'ISSUED_TWICE', row: r, what: `${s} is Issued on ${rs.length} rows - one sale counted ${rs.length} times.` });
  return out;
}

/** The suppliers whose documents carry an IATA ticket number. */
export const NUMBERED_SOURCES = new Set(['IATA BSP', 'RTS', 'NSA', 'Ibtekar', 'Gold Medal', 'Turkish Airlines']);
