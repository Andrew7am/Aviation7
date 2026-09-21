import { parseGrid } from '../helpers/parseGrid';
import { splitTicketNo, ticketMatchKey } from '../helpers/ticketIdentity';
import { parseDate } from '../helpers/parseDate';

/**
 * The aviation team's own ticket sheet, read as data.
 *
 * The team books the travel and records every ticket against the request it
 * was booked for; accounting records the same tickets from what the
 * suppliers bill. Those two lists are supposed to be the same list, and
 * nobody has ever been able to check that except by eye, a page at a time,
 * before signing a sheet off.
 *
 * So this reads their export rather than importing it. Nothing here becomes
 * a ticket: their sheet is a claim about what was booked, and the useful
 * question about a claim is where it and the ledger disagree.
 *
 * Their columns are their own and they move: the export carries a "MICE
 * Account (from Aviation Requests) (from Aviation Quotations)" and a "Refund
 * Recieved?" spelt as they spell it. Columns are matched by name rather than
 * by position for that reason, and anything not found is simply blank -
 * every field except the ticket number is optional.
 */

export type TeamStatus = 'ISSUED' | 'REFUNDED' | 'VOID' | 'ON_HOLD' | 'UNKNOWN';

export interface TeamSheetRow {
  /** 1-based line in their file, so a finding can be pointed at. */
  rowNo: number;
  rawTicket: string;
  /**
   * How many ticket numbers their one cell named, and which.
   *
   * Their export puts a whole booking in one cell when it was refunded or
   * issued together - three numbers separated by newlines with /P1 /P2 /P3
   * after them, or by commas. Each becomes a row of its own here, because
   * each is a ticket, but they keep a note of the others: the money on that
   * cell is the booking's, not any one ticket's.
   */
  groupSize: number;
  siblings: string[];
  /**
   * The cell held something that should have been a ticket number and could
   * not be read. Nearly always Excel: a 13-digit number stored as a number
   * comes out as "6.55512E+11" with the digits gone for good. Flagged rather
   * than dropped, because a row nobody can see is a row nobody checks.
   */
  unreadable: boolean;
  /** The 10-digit serial, or '' when the row has no ticket yet. */
  serial: string;
  airlineCode: string;
  pnr: string;
  status: TeamStatus;
  rawStatus: string;
  /** Their "Net Cost". Their figure, which carries their markup - see the
   *  note on comparison in teamSheetCompare. */
  cost: number | null;
  currency: string;
  refund: number | null;
  refundReceived: boolean;
  /** yyyy-MM-dd, or '' when their date could not be read. */
  issued: string;
  account: string;
  department: string;
  member: string;
  airline: string;
  portal: string;
  /** Present only when their export carries the request number. */
  reqNum: string;
  ticketType: string;
}

export interface ParsedTeamSheet {
  rows: TeamSheetRow[];
  /** Which of their headers were found, for the screen to show. */
  headers: string[];
  /** Why nothing could be read, when nothing could. */
  problem: string;
}

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Find a column by name.
 *
 * Exact match first, then "starts with", then "contains" - and the
 * candidates are tried in order, so a precise name always beats a loose one.
 * That ordering is what keeps "Refund Amount" and "Refund Recieved?" apart,
 * and it is why `loose` can be switched off: the request number must never
 * be found by containment, because their account column is called "MICE
 * Account (from Aviation Requests)" and contains the word.
 */
function pick(headers: string[], candidates: string[], loose = true): number {
  const H = headers.map(norm);
  for (const c of candidates.map(norm)) {
    const exact = H.indexOf(c);
    if (exact >= 0) return exact;
  }
  for (const c of candidates.map(norm)) {
    const starts = H.findIndex(h => h.startsWith(c));
    if (starts >= 0) return starts;
  }
  if (!loose) return -1;
  for (const c of candidates.map(norm)) {
    const has = H.findIndex(h => h.includes(c));
    if (has >= 0) return has;
  }
  return -1;
}

/**
 * A number out of a cell that may carry separators, a currency or nothing.
 *
 * "2,530.00" is two and a half thousand; "588,00" is five hundred and
 * eighty-eight, because some exports write the decimal as a comma. The two
 * are told apart by shape rather than by locale: a comma followed by exactly
 * two digits at the very end is a decimal point, anything else is a
 * thousands separator.
 */
export function money(raw: unknown): number | null {
  const s = String(raw ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  const decimalComma = /^-?\d+,\d{2}$/.test(s);
  const n = Number(decimalComma ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The currency named beside an amount - "1371 SAR" - or ''. */
export function currencyOf(raw: unknown): string {
  const m = String(raw ?? '').toUpperCase().match(/\b(AED|SAR|USD|EUR|EGP|GBP|OMR|QAR|KWD|BHD)\b/);
  return m ? m[1] : '';
}

/**
 * Every ticket number their cell names.
 *
 * Their column holds one number most of the time, in whatever shape the
 * person typed: "065-5513373360", "065 5513059137", "065-5513059104/",
 * "--", "0", blank. A row with no ticket is not a broken row - it is a
 * booking still on hold - so it comes back empty and is reported as such.
 *
 * But it also holds SEVERAL, when a booking was issued or refunded as one:
 *
 *     065-5512129318/P1
 *     065-5512129319/P2      one cell, three tickets
 *     065-5512129320/P3
 *
 *     065-5512559596,065-5512559597,065-5512559598
 *
 * This used to take the digits of the whole cell and keep the last ten,
 * which turned the first of those into ticket 5121293203 - a number that
 * exists nowhere, reported as missing from our books, sending somebody to
 * look for a ticket that was never issued. So there is no "last ten digits"
 * fallback any more. A document is found by its shape, all of them are
 * found, and a cell whose shape says nothing yields nothing.
 */
const DOC = /(\d{3})[\s\u2013\u2014-]?(\d{10})(?!\d)|(?<![\d])(\d{10})(?!\d)/g;

export function teamSerials(raw: unknown): { serial: string; airlineCode: string }[] {
  const text = String(raw ?? '');
  const out: { serial: string; airlineCode: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DOC)) {
    const serial = m[2] ?? m[3];
    if (!serial || seen.has(serial)) continue;
    seen.add(serial);
    out.push({ serial, airlineCode: m[1] ?? '' });
  }
  return out;
}

/** The first, for a cell expected to name one. */
export function teamSerial(raw: unknown): { serial: string; airlineCode: string } {
  return teamSerials(raw)[0] ?? { serial: '', airlineCode: '' };
}

/**
 * A cell that was meant to carry a ticket number and does not.
 *
 * "--", "---", "0" and blank are how their sheet writes "not issued yet",
 * and those are states, not faults. Anything else with digits in it that
 * yielded no document is a number that got damaged on the way out of their
 * system - "6.55512E+11" - and somebody has to be told, because the row
 * cannot be checked at all.
 */
export function ticketUnreadable(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return false;
  if (teamSerials(text).length > 0) return false;
  if (/^[-\u2013\u2014\s]*$/.test(text)) return false;      // --, ---
  if (/^0+(\.0+)?$/.test(text)) return false;                // 0
  return /\d/.test(text);
}

/**
 * Their status vocabulary.
 *
 * "Cancelled/Refunded" is one row standing for two events - the ticket was
 * issued and then refunded - which is why the ledger holds two rows against
 * it and the comparison expects both. A bare "Cancelled" is not the same
 * claim: nothing was refunded, so it reads as a void.
 */
export function teamStatus(raw: unknown): TeamStatus {
  const s = norm(String(raw ?? ''));
  if (!s) return 'UNKNOWN';
  if (s.includes('refund')) return 'REFUNDED';
  if (s.includes('void')) return 'VOID';
  if (s.includes('cancel')) return 'VOID';
  if (s.includes('hold')) return 'ON_HOLD';
  if (s.includes('issue') || s.includes('reissue') || s.includes('exchange')
    || s.includes('ticketed')) return 'ISSUED';
  return 'UNKNOWN';
}

export function parseTeamSheet(text: string): ParsedTeamSheet {
  const grid = parseGrid(text);
  if (grid.rows.length < 2)
    return { rows: [], headers: [], problem: 'That file has no rows under its header.' };

  const headers = grid.rows[0].map(h => (h || '').trim());
  const col = {
    ticket:  pick(headers, ['ticket number', 'ticketno', 'ticket', 'document']),
    pnr:     pick(headers, ['pnr', 'record locator', 'booking reference']),
    status:  pick(headers, ['status']),
    cost:    pick(headers, ['net cost', 'cost', 'fare']),
    total:   pick(headers, ['total cost with currency', 'total cost', 'total']),
    refund:  pick(headers, ['refund amount']),
    got:     pick(headers, ['refund recieved', 'refund received']),
    issued:  pick(headers, ['issued date & time', 'issued date', 'issue date', 'date']),
    account: pick(headers, ['mice account', 'account', 'client']),
    dept:    pick(headers, ['department']),
    member:  pick(headers, ['team members', 'team member', 'agent']),
    airline: pick(headers, ['airline', 'carrier']),
    portal:  pick(headers, ['portal', 'supplier', 'source']),
    type:    pick(headers, ['ticket type']),
    // Never loosely: "MICE Account (from Aviation Requests)" contains it.
    req:     pick(headers, ['req num', 'reqnum', 'req no', 'req', 'request number',
                            'request no', 'request'], false),
  };

  if (col.ticket < 0)
    return { rows: [], headers, problem: 'No ticket number column in that file.' };

  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  const rows: TeamSheetRow[] = [];
  for (let i = 1; i < grid.rows.length; i++) {
    const r = grid.rows[i];
    if (!r.some(cell => (cell || '').trim())) continue;
    const rawTicket = at(r, col.ticket);
    const docs = teamSerials(rawTicket);
    const rawStatus = at(r, col.status);
    const totalCell = at(r, col.total);

    // One row per ticket their cell named. A cell that named none still
    // produces a row - it is either a booking on hold or a number their
    // export damaged, and both have to be visible.
    const found = docs.length ? docs : [{ serial: '', airlineCode: '' }];
    for (const { serial, airlineCode } of found) rows.push({
      rowNo: i + 1,
      rawTicket,
      groupSize: docs.length,
      siblings: docs.map(d => d.serial).filter(x => x && x !== serial),
      unreadable: docs.length === 0 && ticketUnreadable(rawTicket),
      serial, airlineCode,
      pnr: at(r, col.pnr).replace(/\s+/g, '').toUpperCase(),
      status: teamStatus(rawStatus),
      rawStatus,
      cost: money(at(r, col.cost)),
      currency: currencyOf(totalCell) || currencyOf(at(r, col.cost)),
      refund: money(at(r, col.refund)),
      refundReceived: /check|yes|true|done|1/i.test(at(r, col.got)),
      // Their date carries a time: "6/9/2026 6:49pm". Day first, as they
      // write it - read the other way round, 6 September becomes 9 June.
      issued: parseDate(at(r, col.issued).split(' ')[0], 'dmy'),
      account: at(r, col.account),
      department: at(r, col.dept),
      member: at(r, col.member),
      airline: at(r, col.airline),
      portal: at(r, col.portal),
      reqNum: at(r, col.req).toUpperCase(),
      ticketType: at(r, col.type),
    });
  }

  return {
    rows, headers,
    problem: rows.length ? '' : 'That file has a header but no rows under it.',
  };
}
