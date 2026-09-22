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
  /** …and that Excel is why: "6.55512E+11". Their export can fix that one;
   *  the others need somebody to look at the row. */
  excelDamaged: boolean;
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
 * Every column whose name starts with one of these, in file order.
 *
 * Their export carries the request in TWO columns - "REQ No (Auto) (MICE)"
 * and "REQ No (Auto) (Trip)" - because a booking is raised against one kind
 * of request or the other. Across a full export every row fills exactly
 * one of them and never both, so reading only the first column found
 * dropped the request on 706 of 1,903 rows and would have reported every
 * one of them as filed differently from our books.
 *
 * Exact and starts-with only, never containment: their account column is
 * called "MICE Account (from Aviation Requests)" and contains the word.
 */
function pickAll(headers: string[], candidates: string[]): number[] {
  const H = headers.map(norm);
  const cs = candidates.map(norm);
  const out: number[] = [];
  H.forEach((h, i) => {
    if (cs.some(c => h === c || h.startsWith(c))) out.push(i);
  });
  return out;
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
 * Every document their cell names.
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
 * fallback. A document is found by its shape, all of them are found, and a
 * cell whose shape says nothing yields nothing.
 *
 * AND NOT EVERY DOCUMENT IS AN IATA TICKET
 *
 * The low-cost carriers do not issue one. FlyAdeal, flydubai, flynas and
 * Air Arabia give a booking reference - EDINGX, RX12237H6T9J5, 8K6NYC -
 * and that reference IS the document: our ledger stores 188 of them in the
 * ticket number itself. Treating those as unreadable, which this did at
 * first, refused to match twenty-nine tickets that were sitting in both
 * lists under the same reference.
 *
 * A reference is told from noise by shape: at least five characters, at
 * least one letter and one digit, nothing else in it. That admits every
 * carrier reference seen in either system and excludes "F3" (an airline
 * code in the wrong column), "2000", "0", "--3pax +1inf" and
 * "1.ALORENI/FOZIAH ABDULLAH".
 */
const DOC = /(\d{3})[\s\u2013\u2014-]?(\d{10})(?!\d)|(?<![\d])(\d{10})(?!\d)/g;

/** Excel's wreckage of a 13-digit number stored as a number. The plus sign
 *  is required and the whole cell must be it, so a booking reference like
 *  6E3M6D is never mistaken for one. */
const EXCEL_DAMAGE = /^\d(\.\d+)?E\+\d+$/i;

/**
 * A carrier's own booking reference, which for an LCC is the document.
 *
 * Two shapes, because the carriers use two. flydubai and Air Arabia mix
 * letters and digits - RX12237H6T9J5, 8K6NYC - and FlyAdeal's are six
 * letters with no digit at all: EDINGX, FYIQFD, REENWK, all three of which
 * sit in our own ledger as ticket numbers.
 *
 * The all-letter form has to be bounded tightly or it swallows any word in
 * the column, so it must be exactly six characters AND already uppercase in
 * their file. That takes every reference either system holds and leaves
 * "Issued", "EMD", "fz" and a passenger's name where they belong: reported
 * as cells that are not a ticket number.
 */
const REFERENCE = /^(?=.*[A-Z])[A-Z0-9]{5,15}$/;
const isReference = (piece: string) => {
  const up = piece.toUpperCase();
  if (!REFERENCE.test(up)) return false;
  if (/\d/.test(up)) return true;
  return piece.length === 6 && piece === up;
};

/**
 * A range written the way people write consecutive tickets.
 *
 *     176-5512938024-25        two tickets, ...024 and ...025
 *     1763000541793-794        the same shorthand, in our own ledger
 *
 * The tail after the last dash replaces the end of the serial. Both systems
 * use it, and neither could see the second ticket until now: a cell reading
 * "...024-25" matched one ticket and the other existed nowhere.
 *
 * Bounded on purpose. The tail must be shorter than the serial, must count
 * FORWARD, and must not run more than twenty - anything else is not a range
 * but two numbers that happen to sit beside a dash, and expanding it would
 * be inventing tickets, which is the fault this whole reader exists to
 * avoid repeating.
 */
const RANGE = /(\d{10})-(\d{1,3})(?!\d)/;

function expandRange(serial: string, tail: string): string[] {
  if (tail.length >= serial.length) return [];
  const last = serial.slice(0, serial.length - tail.length) + tail;
  const from = Number(serial), to = Number(last);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return [];
  if (to <= from || to - from > 20) return [];
  const out: string[] = [];
  for (let n = from + 1; n <= to; n++) out.push(String(n).padStart(serial.length, '0'));
  return out;
}

/**
 * The pieces a cell is made of.
 *
 * Their sheet separates several documents with newlines, commas,
 * semicolons, pipes, "//" — and with TABS, which is what a paste out of a
 * spreadsheet leaves behind. A tab left unsplit is how "180-5512938098"
 * and "618-5512878156" ran together into 551-2938098618, a ticket that
 * exists nowhere.
 */
const splitCell = (text: string) =>
  text.split(/[\n\r\t,;]+|\s*\/\/\s*|\s\|\s|\s{2,}/).map(x => x.trim()).filter(Boolean);

/** Documents in one piece, ranges expanded. */
function docsIn(piece: string): { serial: string; airlineCode: string }[] {
  const out: { serial: string; airlineCode: string }[] = [];
  for (const m of piece.matchAll(DOC)) {
    const serial = m[2] ?? m[3];
    const airlineCode = m[1] ?? '';
    out.push({ serial, airlineCode });
    // "...024-25": the tail belongs to the document just read.
    const after = piece.slice(m.index! + m[0].length);
    const range = after.match(/^-(\d{1,3})(?!\d)/);
    if (range) for (const n of expandRange(serial, range[1])) out.push({ serial: n, airlineCode });
  }
  return out;
}

export function teamSerials(raw: unknown): { serial: string; airlineCode: string }[] {
  const text = String(raw ?? '');
  const out: { serial: string; airlineCode: string }[] = [];
  const seen = new Set<string>();
  const add = (d: { serial: string; airlineCode: string }) => {
    if (!d.serial || seen.has(d.serial)) return;
    seen.add(d.serial);
    out.push(d);
  };

  for (const piece of splitCell(text)) {
    const found = docsIn(piece);
    if (found.length) { found.forEach(add); continue; }

    // Nothing in the piece as written. A document number typed with spaces
    // inside it - "084 2318 700 632" - is still that document, so try once
    // more with the spaces out. Only when the piece yielded nothing, never
    // as the first reading: joining first is what runs two documents
    // together into a third that is neither.
    const tight = piece.replace(/\s+/g, '');
    const joined = docsIn(tight);
    if (joined.length) { joined.forEach(add); continue; }

    if (EXCEL_DAMAGE.test(tight)) continue;
    // Tested as written, not after stripping punctuation out of it: a
    // carrier reference is one unbroken token, and "--3pax +1inf" reduced
    // to 3PAX1INF looks exactly like one once the spaces and signs are
    // thrown away.
    const cleanPiece = piece.trim();
    if (isReference(cleanPiece)) add({ serial: cleanPiece.toUpperCase(), airlineCode: '' });
  }
  return out;
}

/** The first, for a cell expected to name one. */
export function teamSerial(raw: unknown): { serial: string; airlineCode: string } {
  return teamSerials(raw)[0] ?? { serial: '', airlineCode: '' };
}

/**
 * A cell that was meant to carry a document and does not.
 *
 * "--", "---", "0" and blank are how their sheet writes "not issued yet",
 * and those are states, not faults. What is left is a cell somebody has to
 * look at: a number Excel destroyed ("6.55512E+11"), an airline code typed
 * into the ticket column ("F3"), a count of passengers ("--3pax +1inf"), a
 * passenger's name. None of those can be checked against anything.
 */
export function ticketUnreadable(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return false;
  if (teamSerials(text).length > 0) return false;
  if (/^[-\u2013\u2014\s]*$/.test(text)) return false;      // --, ---
  if (/^0+(\.0+)?$/.test(text)) return false;                // 0, 00, 000
  return true;
}

/** Excel destroyed the number: a 13-digit ticket stored as a number comes
 *  back as "6.55512E+11" with its digits gone for good. Anchored, and the
 *  plus sign required, so a booking reference like 6E3M6D is not mistaken
 *  for one. */
export function excelDamaged(raw: unknown): boolean {
  return EXCEL_DAMAGE.test(String(raw ?? '').trim());
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
  // …and every one of them, because there can be more than one.
  const reqCols = pickAll(headers, ['req num', 'reqnum', 'req no', 'req',
                                    'request number', 'request no', 'request']);

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
      excelDamaged: docs.length === 0 && excelDamaged(rawTicket),
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
      // Whichever of their request columns this row filled in.
      reqNum: (reqCols.map(i => at(r, i)).find(Boolean) ?? '').toUpperCase(),
      ticketType: at(r, col.type),
    });
  }

  return {
    rows, headers,
    problem: rows.length ? '' : 'That file has a header but no rows under it.',
  };
}
