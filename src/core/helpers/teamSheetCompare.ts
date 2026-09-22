import { Ticket } from '../../types';
import { ticketMatchKey } from './ticketIdentity';
import { TeamSheetRow } from '../parsers/teamSheet';
import { portalSource } from '../config/teamPortals';

/**
 * Their sheet against our ledger, before a flight sheet is signed off.
 *
 * Two lists of the same tickets, kept by two teams from two directions: they
 * record what they booked, we record what we were billed.
 *
 * THE REQUEST IS THE POINT
 *
 * Both sides file every ticket under a request number, and the request is
 * what the work is built on - it is what gets costed, closed and billed to
 * the client. So the question this answers is not only "do we both have
 * this ticket" but "do we both have it under the SAME request".
 *
 * A ticket filed under KSAML2053 here and KSAML2064 there is the worst case
 * of the lot, and the one no other check can see. Nothing is missing, so
 * every count agrees; the ticket simply sits in the wrong file. Two requests
 * are then wrong at once - one carrying a cost that is not its own, the
 * other short of one that is - and both totals look perfectly reasonable.
 * That is why a misfiled ticket is reported above a missing one.
 *
 * BUT TWO REQUESTS ARE NOT ALWAYS TWO DIFFERENT THINGS
 *
 * A ticket paid in cash is raised under its own request, and that request
 * belongs with the one it was split from. The ledger has said so all along,
 * in the only place it could: fourteen req fields name two requests at once
 * - KSAML43-SA1157, KSAML1294-SA1168, KSAFM2175 - KSAML1533 - and between
 * them they carry 261 rows. Each of those is somebody recording that these
 * two requests are one piece of work.
 *
 * So the relations are read out of the ledger rather than configured. A req
 * field naming several requests links them; their sheet saying SA1157 where
 * we say KSAML43 is then reported as RELATED and not as a mistake. Treating
 * that as misfiled would raise a finding on every cash ticket in the system
 * and teach everyone to ignore the column.
 *
 * WHAT IS COMPARED, AND WHAT DELIBERATELY IS NOT
 *
 * The ticket number is the identity and it is compared. The request is
 * compared, and that is the point of the screen. The refund is compared,
 * because both sides state it and, on the sheets seen so far, the two agree
 * to the fils.
 *
 * The cost is NOT compared, and the reason is not the one written here for
 * a long time. Their "Net Cost" is a genuine net: their sheet keeps the
 * marked-up rate in a separate column ("Rate with MU") that is never read.
 * Measured across a full export, on 986 rows where both sides hold one
 * priced ticket in the same currency:
 *
 *     533   their net equals our net, to the fils
 *      86   their net equals our gross
 *      63   within a dirham of ours
 *     149   between 1 and 20 out, mostly a flat ten
 *     155   further out than that
 *
 * So 84% agree within twenty, and where the rest differ theirs is lower on
 * 184 and higher on 183 - symmetric, which a markup never is. It is not an
 * uplift; it is two systems recording a price at two moments, sometimes in
 * two currencies, with fees landing on one side and not the other.
 *
 * It is still not compared, because 155 findings nobody can act on would
 * bury the ones they can. Both figures are carried so they can be looked
 * at; neither is called an error. The 29 that differ by more than a
 * thousand are worth somebody's afternoon, and are not this screen's job.
 *
 * A REFUND HAS TWO RIGHT ANSWERS: BEFORE AND AFTER OUR COMMISSION
 *
 * This took two wrong attempts to see. The gaps were first reported in
 * full, which raised two dozen findings; then written off as "their
 * uplift" and filtered by a percentage, which was a guess dressed as a
 * rule. Both were wrong, and the real relationship is exact:
 *
 *     they refund 2,890.00 = our document 2,890.00 less 226.00 commission,
 *                            so our ledger carries 2,664.00
 *     they refund   410.00 = our document   410.00 less  94.00 commission,
 *                            so our ledger carries   316.00
 *
 * We keep both figures - `totalDoc` is what the airline refunded, `amount`
 * is what reached us once our commission came back off it - and their
 * sheet records sometimes one and sometimes the other. On a full export 95
 * of their figures equal our net exactly, 12 equal our gross exactly, and
 * the rest are the real disagreements.
 *
 * So a refund agrees when their figure matches EITHER of ours to the fils.
 * No percentage and nothing to tune: two exact comparisons, because both
 * are true answers to "how much was refunded".
 *
 * HOW THE COMPARISON IS SCOPED
 *
 * "What is missing from their sheet" only means something inside a boundary.
 * Compared against the whole ledger, a sheet of forty tickets is missing
 * five thousand. So the boundary comes from the sheet itself: match their
 * tickets to ours, take the REQUESTS those matched tickets belong to, and
 * anything of ours under those requests that their sheet never mentions is
 * the answer. A sheet carrying its own request numbers widens the boundary
 * to those as well.
 *
 * WHEN THEIR EXPORT DOES NOT CARRY THE REQUEST
 *
 * It usually does not, today. So the request can be DECLARED instead - the
 * person running the check types the request their sheet is for, before the
 * file goes in, and the comparison proceeds as though their export had said
 * it.
 *
 * That is a claim by a person rather than a column in a file, so it is
 * labelled as one everywhere it shows, and it behaves differently depending
 * on how much is claimed. One request declared means "this whole sheet is
 * that request", and every check runs. Several declared means "this sheet
 * covers these requests", which cannot say which row is which - so the
 * per-ticket filing check narrows to the honest question it can still
 * answer: is this ticket filed under one of them at all.
 *
 * A row that states its own request always keeps it. What somebody typed
 * fills gaps; it never overrides their file.
 *
 * ONE CELL, SEVERAL TICKETS
 *
 * Their export puts a whole booking in one cell when it was issued or
 * refunded as one - three numbers with /P1 /P2 /P3 after them, or separated
 * by commas. The parser splits those into a ticket each, which is what they
 * are, but the MONEY on that cell belongs to the booking rather than to any
 * one of them. So a refund figure shared by three tickets is never compared
 * against one ticket's refund; only its presence is checked, and the note
 * says the figure covers the group.
 *
 * THE SAME REFERENCE IN TWO DIFFERENT COLUMNS
 *
 * For a carrier that issues no IATA ticket, the booking reference is both
 * the booking AND the document - and the two systems did not pick the same
 * column for it. Our Riyadh Air rows keep RX12237ZB622D in the PNR and a
 * numeric document beside it; their sheet keeps RX12237ZB622D in the ticket
 * column. Matching ticket against ticket, those never meet, and 41 tickets
 * that are plainly in both lists were reported as missing from one.
 *
 * So a reference that finds nothing in our ticket column is looked for in
 * our PNR column as well, and the other way round. Only a REFERENCE: a
 * ten-digit serial is never matched against a PNR, because a serial in a
 * PNR column would be somebody's mistake rather than a filing convention,
 * and pairing them on that basis would invent a match.
 *
 * A TICKET THEIR SHEET STATES A REFUND FOR TWICE
 *
 * Their normal shape is two rows per refunded ticket - one Issued, one
 * Cancelled/Refunded - and only the second carries a figure. Sometimes
 * both carry one: 5512369322 appears twice, each row refunding 815, and
 * 5513059004 appears twice refunding 10,410 and 740. Added together those
 * make 1,630 and 11,150, and both were reported as disagreeing with our
 * books by exactly the amount their own sheet had repeated.
 *
 * A record that contradicts itself cannot be compared against anything, so
 * it is not: the contradiction is reported instead, with both figures, and
 * the refund check stands aside until their side settles on one number.
 *
 * A PERIOD BOUNDS WHAT IS REPORTED, NEVER WHAT IS MATCHED
 *
 * The sheet gets checked every few weeks, not once. Without a period every
 * check reports the same two hundred findings from February, and the
 * fifteen new ones are lost in them - which is how a report stops being
 * read.
 *
 * So a period can be given: "this sheet is 1 August to 15 September". Their
 * rows outside it are set aside and counted; ours outside it are never
 * reported as missing from a sheet that does not cover them.
 *
 * What the period must NOT do is narrow the search. A ticket their sheet
 * dates 3 September may sit in our books dated 28 August - their date is
 * when it was issued, ours is when the supplier billed it, and an invoice
 * crosses a month end without asking anybody. Matching against only the
 * window would report that ticket as missing from our books while it sits
 * in them, which is the worst kind of wrong: a finding that sends somebody
 * to record a ticket we already have.
 *
 * So the whole ledger is always searched, whatever the period. The period
 * decides which of THEIR rows are asked about and which of OURS may be
 * reported back; it never decides where we look.
 *
 * A row with no date is never excluded by a period, on either side. A
 * period cannot say anything about a date nobody wrote down, and dropping
 * those rows would hide real gaps behind a blank cell.
 *
 * NOTHING BEFORE THEIR SYSTEM EXISTED
 *
 * Their first ticket is dated 9 February 2026. Anything of ours issued
 * before that cannot be on their sheet, because there was no sheet - and
 * 165 of our rows were being reported as missing from one for that
 * reason alone.
 *
 * So the earliest date on their export is a floor, and our older rows sit
 * under it. They are counted and named on the screen rather than dropped:
 * a row nobody can see is a row nobody checks, and the count is also the
 * honest measure of how much of our ledger this comparison can speak to
 * at all.
 *
 * Read from their file, never configured. When they send a sheet covering
 * only last month, the floor moves to last month by itself.
 *
 * A BOOKING ON HOLD IS NOT A TICKET
 *
 * 67 of their rows are held options with no ticket number: nothing has
 * been issued, so there is nothing for our books to be missing. They are
 * counted and left out of the report entirely.
 *
 * What stays is the 69 rows that carry no ticket number and are NOT on
 * hold - 60 marked Issued, 8 Cancelled/Refunded, one Reissue. Those are
 * issued tickets whose number nobody wrote down, which is a real gap in
 * their record and the only reason the two lists were ever kept apart.
 *
 * A VOID IS NOT A GAP, BUT A VOID IS NOT ALWAYS A VOID
 *
 * A ticket issued and voided never reaches the supplier's invoice, so its
 * absence from our ledger is correct. Reporting it as missing would be
 * reporting the system working. It is counted separately and said plainly.
 *
 * What is NOT safe is treating any mention of a void as the end of the
 * story. Ten documents on their sheet carry a void row AND an issued row,
 * and four of those issued rows are for 13,200 to 26,540 AED - a ticket
 * voided and then issued again under the same number is live, and
 * dropping it because the word "void" appears somewhere would hide the
 * largest single thing this check could find.
 *
 * So the LAST thing that happened decides. Their dates settle it when
 * they differ. When a void and an issue share one date the sheet cannot
 * say which came last, and that is reported rather than guessed - six of
 * the ten are in that state.
 */

export type Verdict =
  | 'OK'
  | 'REQ_DIFFERS'
  | 'REQ_RELATED'
  | 'FILED_ELSEWHERE'
  | 'NOT_IN_LEDGER'
  | 'VOID_NOT_BILLED'
  | 'VOID_AND_ISSUED'
  | 'REFUND_NOT_IN_LEDGER'
  | 'REFUND_NOT_ON_SHEET'
  | 'REFUND_DIFFERS'
  | 'TWICE_ON_THEIR_SHEET'
  | 'NO_TICKET_NUMBER'
  | 'UNREADABLE'
  | 'NOT_ON_SHEET';

export const VERDICT_LABEL: Record<Verdict, string> = {
  OK:                   'Agrees',
  REQ_DIFFERS:          'Filed under a different request',
  REQ_RELATED:          'A related request',
  FILED_ELSEWHERE:      'In both, in different columns',
  NOT_IN_LEDGER:        'Not in our ledger',
  VOID_NOT_BILLED:      'Void — never billed',
  VOID_AND_ISSUED:      'Voided and issued the same day',
  REFUND_NOT_IN_LEDGER: 'Refund not in our ledger',
  REFUND_NOT_ON_SHEET:  'Refunded, their sheet does not say so',
  REFUND_DIFFERS:       'Refund differs',
  TWICE_ON_THEIR_SHEET: 'Their sheet refunds it twice',
  NO_TICKET_NUMBER:     'Issued with no ticket number',
  UNREADABLE:           'Their ticket number is damaged',
  NOT_ON_SHEET:         'Not on their sheet',
};

/** Worst first. The order the screen lists them in, and the order they
 *  matter in: a ticket nobody billed outranks a figure that differs. */
export const VERDICT_RANK: Record<Verdict, number> = {
  // First, because it is the only finding that leaves both sides' counts
  // looking right while two requests are wrong.
  REQ_DIFFERS: 0,
  NOT_IN_LEDGER: 1,
  REFUND_NOT_IN_LEDGER: 2,
  NOT_ON_SHEET: 3,
  REFUND_NOT_ON_SHEET: 4,
  REFUND_DIFFERS: 5,
  // Their own record disagrees with itself, so nothing can be compared
  // against it until they settle on one figure.
  TWICE_ON_THEIR_SHEET: 5.2,
  // A row that cannot be checked at all. Above the states of the world,
  // because somebody has to go and ask for the number.
  UNREADABLE: 5.5,
  NO_TICKET_NUMBER: 6,
  // Two requests that belong together - a cash ticket beside the request it
  // was split from. Worth seeing, never worth chasing.
  REQ_RELATED: 7,
  // The same reference, one side's ticket column against the other's PNR.
  // Nothing is missing; the filing differs.
  FILED_ELSEWHERE: 7.5,
  // Their sheet says both and cannot say which came last. Above a plain
  // void, because somebody has to look.
  VOID_AND_ISSUED: 3.5,
  VOID_NOT_BILLED: 8,
  OK: 9,
};

/**
 * The requests named in one req field.
 *
 * Most fields name one. Some name two, because the work was split - most
 * often a cash-paid ticket raised under its own number beside the request
 * it came from - and they are written every way people write them:
 * "KSAML43-SA1157", "KSAFM2175 - KSAML1533", "SA765|REQ10567",
 * "REQ10949|FIT|REQ11432", and "UAECO201UAECO250" with nothing between
 * them at all. So the parts are found by their shape rather than by any
 * separator: letters followed by digits, which is what a request number is.
 *
 * A field with no such shape in it - ADM, COMPANY EXPENSE, ADM-NOT AN ADM,
 * somebody's name - is one part, itself. Splitting those on the dash would
 * invent two requests out of one label.
 */
const REQ_PART = /[A-Z]+\d+/g;

export function reqParts(raw: string | undefined | null): string[] {
  const s = (raw || '').toUpperCase();
  const found = s.match(REQ_PART) || [];
  if (found.length > 1) return [...new Set(found)];
  const whole = reqKey(s);
  return whole ? [whole] : [];
}

/**
 * Which requests belong with which, learned from the ledger.
 *
 * Every req field that names more than one request is a statement that
 * those requests are one piece of work, so the links are read from the
 * data rather than kept in a list somebody has to maintain. Relations are
 * transitive: A written with B and B written with C puts all three
 * together, because that is what the three rows are saying between them.
 */
export function buildRelations(ledger: { reqNum?: string }[]): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; }
    return x;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const t of ledger) {
    const parts = reqParts(t.reqNum).map(reqKey).filter(Boolean);
    for (let i = 1; i < parts.length; i++) union(parts[0], parts[i]);
  }

  const groups = new Map<string, Set<string>>();
  for (const k of parent.keys()) {
    const root = find(k);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(k);
  }
  // Keyed by every member, so a lookup is one get.
  const byMember = new Map<string, Set<string>>();
  for (const g of groups.values())
    for (const k of g) byMember.set(k, g);
  return byMember;
}

/** Whether two requests are the same request, or two that belong together. */
export function relatedReq(
  a: string, b: string, relations: Map<string, Set<string>>,
): 'SAME' | 'RELATED' | 'DIFFERENT' {
  const A = reqParts(a).map(reqKey), B = reqParts(b).map(reqKey);
  if (!A.length || !B.length) return 'DIFFERENT';
  // One field naming several requests already contains the other's answer.
  if (A.some(x => B.includes(x))) return 'SAME';
  for (const x of A) {
    const group = relations.get(x);
    if (group && B.some(y => group.has(y))) return 'RELATED';
  }
  return 'DIFFERENT';
}

/**
 * Two request numbers that mean the same request.
 *
 * One side types KSAML2053 and the other "ksaml 2053"; they are the same
 * file and reporting them as a mismatch would bury the real ones. Case and
 * the spaces, dashes and dots people put in are removed - but nothing else
 * is, so KSAML1145-UAEFM2193, which really is a request covering two, stays
 * distinct from either half.
 */
/**
 * MLMI and FM are the same department, written two ways.
 *
 * UAEMLMI2221 and UAEFM2221 are one request; so are UAEMLMI2071 and
 * UAEFM2071, and KSAMLMI1446 and KSAFM1446. The agency confirmed it: if
 * the number matches, it is the same file whichever of the two is
 * written. Eight of the ninety-four "filed differently" findings were
 * nothing but this spelling.
 *
 * Only that one pair is folded together, and only as whole letters inside
 * a code - the numbers still have to match, so KSAMLMI1446 and KSAFM1470
 * remain two different requests.
 */
export const reqKey = (s: string | undefined | null) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/MLMI/g, 'FM');

export const sameReq = (a: string, b: string) => reqKey(a) === reqKey(b);

/** A booking reference rather than an IATA serial. Only these are looked
 *  for across the ticket and PNR columns - see the note above. */
const isReference = (s: string) => /^[A-Z0-9]{5,15}$/.test(s) && /[A-Z]/.test(s);

const pnrKey = (s: string | undefined | null) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface Finding {
  verdict: Verdict;
  serial: string;
  airlineCode: string;
  pnr: string;
  /** Their side, when they have one. */
  sheet?: TeamSheetRow;
  /** Our side: every ledger row on that ticket, issue and refund together. */
  ours: Ticket[];
  /**
   * OUR request for this ticket. Empty when we hold no row for it, which
   * is the honest answer: a ticket that is not in our books is not filed
   * under anything of ours.
   *
   * This used to fall back to theirs when ours was missing, which put
   * their request number in a column labelled "Our request" on all 206
   * rows of the not-in-our-books list - the one list where by definition
   * we have nothing to put there.
   */
  reqNum: string;
  /** Their request, when their sheet states one. Kept beside ours rather
   *  than collapsed into it: on a misfiled ticket the two differ, and which
   *  is which is the whole finding. */
  theirReq: string;
  /** One line saying what to do about it, in the reader's own terms. */
  note: string;
  /**
   * Where the ticket was bought, named as one of our vendors.
   *
   * Their "Portal" column read through `portalSource`, or, on a ticket only
   * we hold, our own source. A list of tickets missing from our books is
   * only actionable if it says where to go and find them, and that column
   * was being thrown away.
   */
  issuedFrom: string;
  /** Their own word for it, kept when it differs from ours. */
  portal: string;
  /**
   * Kept off anything that writes a ticket. Ibtekar and NSA bill on a
   * statement that settles against a credit wallet: keying one of their
   * tickets by hand moves the balance twice. Still reported, never offered.
   */
  heldBack: boolean;
  /** Why it was held back, in the reader's terms. '' when it was not. */
  heldBackWhy: string;
}

/** One request, as each side holds it. The row a sheet is closed on. */
export interface RequestLine {
  reqNum: string;
  theirTickets: number;
  ourTickets: number;
  /** On their list for this request and not on ours. */
  onlyTheirs: number;
  onlyOurs: number;
  /** Tickets both sides hold, filed under different requests. */
  misfiled: number;
  /** Requests this one belongs with, as the ledger has recorded them - a
   *  cash-paid split, usually. Shown so a count that looks short is read
   *  beside the request the rest of it is under. */
  related: string[];
  agrees: boolean;
}

export interface TeamSheetReport {
  findings: Finding[];
  /** Request by request, which is how a sheet gets closed. */
  byRequest: RequestLine[];
  /**
   * Whether their export carried a request column at all.
   *
   * False is not a detail to hide. Without it the tickets can still be
   * matched, but the question the screen exists to answer - is this ticket
   * in the same file on both sides - cannot be asked, and the screen says
   * so rather than showing a clean result that means less than it looks.
   */
  sheetHasReq: boolean;
  /**
   * Where the request on their side came from.
   *
   * 'sheet' - their export stated it. 'typed' - somebody declared it before
   * the file went in. 'none' - nobody said, and the filing check could not
   * run. Carried so the screen can never present a typed claim as though
   * the file had said it.
   */
  reqSource: 'sheet' | 'typed' | 'none';
  /** The requests declared by hand, as given. */
  declared: string[];
  /** The requests the comparison covered, derived from the matches. */
  requests: string[];
  counts: Record<Verdict, number>;
  /** Rows on their sheet, ours in scope, and how many of each side matched. */
  theirRows: number;
  theirTickets: number;
  ourRows: number;
  matched: number;
  /**
   * The earliest ticket on their sheet, and how many of ours predate it.
   *
   * Our older rows are out of this comparison's reach, not missing from
   * it. Carried so the screen can say so.
   */
  sheetFrom: string;
  /**
   * The period actually applied, and where each end came from.
   *
   * 'typed' means somebody said so before the file went in; 'sheet' means
   * it was taken from their own earliest ticket; 'none' means that end is
   * open. Kept apart so the screen can never present a floor the check
   * guessed as one the person chose.
   */
  period: { from: string; to: string };
  periodFromSource: 'typed' | 'sheet' | 'none';
  periodToSource: 'typed' | 'none';
  /** Their rows dated outside the period. Set aside, never reported. */
  theirOutsidePeriod: number;
  /**
   * Ours dated outside the period — older than the floor or later than the
   * ceiling. Out of this comparison's reach, not missing from it, and
   * counted so the screen can say so.
   */
  beforeTheirSystem: number;
  /** Their held options, with no ticket issued. Counted, never listed:
   *  there is nothing for our books to be missing. */
  onHold: number;
  /** True when nothing needs anybody's attention. */
  clean: boolean;
}

/**
 * Below this, a refund gap is two systems rounding, not a disagreement.
 *
 * The real gaps on a full export are 120, 1,450, 2,224 and 2,757; what it
 * keeps out are twelve fils, twenty-two fils and a nine-dirham difference
 * on a four-thousand-dirham refund. Nobody is going to chase those, and a
 * report that lists them is a report that gets skimmed.
 */
export const REFUND_FLOOR = 50;

/**
 * The stretch of time a sheet is for, as yyyy-MM-dd.
 *
 * Either end may be left out. With no `from`, the floor is their sheet's
 * own first ticket, which is what the check did before periods existed.
 * With no `to`, the sheet runs to today.
 */
export interface Period {
  from?: string;
  to?: string;
}

/** Whether a date falls in the period. A blank date always does - see the
 *  note above: a period cannot speak about a date nobody wrote down. */
export function inPeriod(date: string, from: string, to: string): boolean {
  const d = (date || '').trim();
  if (!d) return true;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

const money = (n: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rows that are a refund: the ledger writes them negative and says so. */
const isRefund = (t: Ticket) =>
  (t.amount || 0) < 0 || /^(RFND|REFUND|ACM)$/i.test((t.status || '').trim());

/** A top-up is a payment against the wallet, never a ticket on anybody's
 *  sheet, so it takes no part in this. */
const isTicket = (t: Ticket) => (t.status || '').toUpperCase() !== 'FUND';

export function compareTeamSheet(
  sheet: TeamSheetRow[], ledger: Ticket[], declaredRaw: string[] = [],
  periodRaw: Period = {},
): TeamSheetReport {
  /* What somebody typed before dropping the file. Cleaned the same way a
     request read from a file is, so "ksaml 2053" and "KSAML2053" are one
     thing here too. */
  const declared = [...new Set(declaredRaw.map(x => (x || '').trim()).filter(x => reqKey(x)))];
  const declaredKeys = new Set(declared.flatMap(reqParts));

  /* One request declared is a claim about every row: this sheet is that
     request. It is written onto the rows that do not state their own, so
     every check below runs exactly as it would on an export that said it.
     Several declared cannot say which row is which, so nothing is written
     and the narrower check further down does what it can. */
  if (declared.length === 1)
    sheet = sheet.map(r => (reqKey(r.reqNum) ? r : { ...r, reqNum: declared[0] }));

  /* ── the period this sheet is for ──────────────────────────────────────
     Resolved before anything is indexed, because their out-of-window rows
     must not reach the comparison at all - a row set aside should not turn
     up later as a match, a duplicate or a claim on one of ours.

     The floor falls back to their own earliest ticket, which is what this
     did before periods existed, so a check run without one behaves exactly
     as it always has. */
  const everyIssued = sheet.map(r => r.issued).filter(Boolean).sort();
  const typedFrom = (periodRaw.from || '').trim();
  const typedTo = (periodRaw.to || '').trim();
  const from = typedFrom || (everyIssued[0] ?? '');
  const to = typedTo;

  const theirOutsidePeriod = sheet.filter(r => !inPeriod(r.issued, from, to)).length;
  // Only a typed floor removes their rows. Their own earliest ticket is by
  // definition their earliest, so it excludes nothing - but a period typed
  // by hand is a claim about what the sheet covers, and a row outside it is
  // a row the person did not mean to send.
  if (theirOutsidePeriod) sheet = sheet.filter(r => inPeriod(r.issued, from, to));

  /* ── index our side by serial ─────────────────────────────────────────── */
  const ourBySerial = new Map<string, Ticket[]>();
  for (const t of ledger) {
    if (!isTicket(t)) continue;
    const k = ticketMatchKey(t.ticketNo || '');
    if (!k) continue;
    if (!ourBySerial.has(k)) ourBySerial.set(k, []);
    ourBySerial.get(k)!.push(t);
  }

  /* ── their side, one entry per ticket rather than per row ─────────────── */
  const theirBySerial = new Map<string, TeamSheetRow[]>();
  const noTicket: TeamSheetRow[] = [];
  for (const r of sheet) {
    if (!r.serial) { noTicket.push(r); continue; }
    if (!theirBySerial.has(r.serial)) theirBySerial.set(r.serial, []);
    theirBySerial.get(r.serial)!.push(r);
  }

  // Their FILE, not what was typed onto it: the screen has to be able to
  // say which of the two it is looking at.
  /* Their reference may be sitting in our PNR column, and ours in theirs.
     Built once, used in both directions below. */
  const ourByPnr = new Map<string, Ticket[]>();
  for (const t of ledger) {
    if (!isTicket(t)) continue;
    const k = pnrKey(t.pnr);
    if (!k) continue;
    if (!ourByPnr.has(k)) ourByPnr.set(k, []);
    ourByPnr.get(k)!.push(t);
  }
  const theirPnrs = new Set(sheet.map(r => pnrKey(r.pnr)).filter(Boolean));

  /* The day their system starts. Everything of ours older than this is
     outside the comparison rather than missing from it - see the note. */
  const sheetFrom = sheet.map(r => r.issued).filter(Boolean).sort()[0] ?? '';

  const sheetHasReq = declared.length === 1
    ? sheet.some(r => reqKey(r.reqNum) && !sameReq(r.reqNum, declared[0]))
    : sheet.some(r => !!reqKey(r.reqNum));

  /* Which requests belong together, read out of the ledger - and out of
     their sheet too, since a combined request may be written on either
     side. See the note on relations above. */
  const relations = buildRelations([
    ...ledger.map(t => ({ reqNum: t.reqNum })),
    ...sheet.map(r => ({ reqNum: r.reqNum })),
  ]);

  /* ── the boundary: every request either side names ────────────────────── */
  const requests = new Set<string>();
  // Each part separately: a row filed "KSAML43-SA1157" puts BOTH requests
  // in scope, which is the point of writing them together.
  const addReq = (r: string) => { for (const part of reqParts(r)) requests.add(part); };
  for (const [serial, rows] of theirBySerial) {
    for (const t of ourBySerial.get(serial) ?? []) addReq(t.reqNum || '');
    // A sheet that names its own requests widens the boundary to them even
    // when not one of their tickets reached the ledger - which is exactly
    // the case worth catching on a request nobody has imported yet.
    for (const r of rows) addReq(r.reqNum);
  }
  for (const r of noTicket) addReq(r.reqNum);
  // Declared requests are in scope whether or not a ticket reached them:
  // an empty request that should have held tickets is worth seeing.
  for (const d of declared) addReq(d);

  const findings: Finding[] = [];
  /** Filled by the one pass at the end, once every finding knows which of
   *  their rows it ended up carrying. Spread in so the compiler keeps the
   *  three construction sites honest about it. */
  const UNSOURCED = { issuedFrom: '', portal: '', heldBack: false, heldBackWhy: '' };
  const theirSerials = new Set(theirBySerial.keys());
  /** Rows of ours already accounted for by a finding on their side, so the
   *  sweep below does not report the same tickets a second time as missing
   *  from a sheet that plainly carries them. */
  const claimed = new Set<string>();
  let matched = 0;

  /* ── walk their side ──────────────────────────────────────────────────── */
  for (const [serial, rows] of theirBySerial) {
    const ours = ourBySerial.get(serial) ?? [];
    const first = rows[0];
    const theirReq = (rows.find(r => reqKey(r.reqNum))?.reqNum || '').trim();
    const ourReq = (ours.find(t => reqKey(t.reqNum || ''))?.reqNum || '').trim();
    const theySayRefunded = rows.some(r => r.status === 'REFUNDED');

    /* Whether a void was the LAST thing that happened to this document.
       Their dates settle it; a tie cannot, and is reported instead. See
       the note above - four of the ties carry five figures. */
    const dates = rows.map(r => r.issued).filter(Boolean).sort();
    const latest = dates[dates.length - 1] ?? '';
    const atLatest = latest ? rows.filter(r => r.issued === latest) : rows;
    const anyVoid = rows.some(r => r.status === 'VOID');
    const theySayVoid = anyVoid && atLatest.every(r => r.status === 'VOID');
    // Only a genuine tie: a void and something else sharing the last date.
    // A void that is plainly NOT the last word leaves the ticket live, and
    // a live ticket we do not hold is a missing ticket, not a question.
    const voidAndIssued = anyVoid && !theySayVoid
      && atLatest.some(r => r.status === 'VOID');
    const base: Omit<Finding, 'verdict' | 'note'> = {
      serial, airlineCode: first.airlineCode, pnr: first.pnr, sheet: first, ours,
      reqNum: ourReq, theirReq, ...UNSOURCED,
    };

    if (ours.length === 0) {
      // A carrier reference we file under the PNR instead. Nothing is
      // missing; the two systems chose different columns for one value.
      const filedUnderPnr = isReference(serial) ? (ourByPnr.get(serial) ?? []) : [];
      if (filedUnderPnr.length) {
        for (const t of filedUnderPnr) claimed.add(ticketMatchKey(t.ticketNo || ''));
        findings.push({
          ...base, verdict: 'FILED_ELSEWHERE', ours: filedUnderPnr,
          reqNum: (filedUnderPnr.find(t => (t.reqNum || '').trim())?.reqNum || '').trim(),
          note: `Their ticket column holds ${serial}; ours holds it as the PNR, against`
              + ` ${filedUnderPnr.length} row(s). The same booking, filed differently.`,
        });
        continue;
      }
      // Issued and voided before the supplier ever billed it. Their sheet
      // shows both events; ours shows nothing, and that is correct.
      if (theySayVoid) {
        findings.push({ ...base, verdict: 'VOID_NOT_BILLED',
          note: 'Voided on their side, so no supplier ever billed it. Nothing to record.' });
      } else if (voidAndIssued) {
        // Show the row that carries the money. `first` is whichever of
        // their rows came up the file, and on five of the six that is the
        // void, which has no cost - so the finding would report nothing
        // at stake on a ticket worth 26,540.
        const priced = rows.find(x => x.status !== 'VOID' && x.cost != null) ?? first;
        base.sheet = priced;
        const both = rows.map(r => `${r.rawStatus}${r.issued ? ' ' + r.issued : ''}`
          + (r.cost != null ? ` for ${money(r.cost)}` : '')).join(', and ');
        findings.push({ ...base, verdict: 'VOID_AND_ISSUED',
          note: `Their sheet says ${both} — the same date on both, so it cannot say which`
              + ' came last. If it was voided there is nothing to record; if it was issued'
              + ' again, this is a ticket we do not have.' });
      } else {
        findings.push({ ...base, verdict: 'NOT_IN_LEDGER',
          note: theirReq
            ? `On their sheet under ${theirReq} and nowhere in our books — either the`
              + ' supplier has not billed it yet, or an import missed it.'
            : 'On their sheet and nowhere in our books — either the supplier has not billed'
              + ' it yet, or an import missed it.' });
      }
      continue;
    }

    matched++;

    /* The finding this screen exists for: both sides hold the ticket, and
       they hold it in different files. Reported before anything else,
       because it is the only disagreement that leaves every count looking
       right - two requests are wrong and neither of them says so. */
    if (theirReq && ourReq) {
      const how = relatedReq(ourReq, theirReq, relations);
      if (how === 'RELATED') {
        // A cash-paid ticket under its own number beside the request it was
        // split from. The ledger says elsewhere that these two go together,
        // so this is worth seeing and not worth chasing.
        findings.push({ ...base, verdict: 'REQ_RELATED',
          note: `We file it under ${ourReq}, their sheet under ${theirReq} —`
              + ' two requests the ledger already records as one piece of work.' });
        continue;
      }
      if (how === 'DIFFERENT') {
        findings.push({ ...base, verdict: 'REQ_DIFFERS',
          note: `We file it under ${ourReq}; their sheet files it under ${theirReq}.`
              + ' One of the two requests is carrying a ticket that is not its own.' });
        continue;
      }
      // SAME: either the very same request, or one field naming both.
    } else if (!theirReq && ourReq && declaredKeys.size > 0) {
      /* Several requests were declared for the sheet as a whole. Which row
         belongs to which cannot be known, so the only honest question left
         is whether this ticket is filed under one of them at all - and a
         ticket that is not is in neither of the files this sheet covers. */
      const inDeclared = reqParts(ourReq).some(k => declaredKeys.has(k))
        || declared.some(d => relatedReq(ourReq, d, relations) !== 'DIFFERENT');
      if (!inDeclared) {
        findings.push({ ...base, verdict: 'REQ_DIFFERS',
          note: `We file it under ${ourReq}. This sheet was declared as`
              + ` ${declared.join(', ')}, and ${ourReq} is not among them.` });
        continue;
      }
    }

    // Their sheet names a request and our row has none. Not a mismatch -
    // a gap on our side, and one that can be filled from their sheet.
    if (theirReq && !ourReq) {
      findings.push({ ...base, verdict: 'REQ_DIFFERS',
        note: `Their sheet files it under ${theirReq}; our row carries no request at all.` });
      continue;
    }

    const ourRefunds = ours.filter(isRefund);

    if (theySayRefunded && ourRefunds.length === 0) {
      /* Show the row that carries the figure. Their normal shape is two
         rows per refunded ticket - one Issued, one Cancelled/Refunded -
         and only the second states an amount, so `first` is the issue and
         reading the refund off it would report "no figure stated" on a
         refund their sheet states perfectly clearly. Same trap as the
         void branch above, and the same answer: carry the row that is
         actually about the thing being reported. */
      const stated = rows.find(x => x.refund != null) ?? first;
      const refundRow = { ...base, sheet: stated };
      findings.push({ ...refundRow, verdict: 'REFUND_NOT_IN_LEDGER',
        note: stated.refund != null
          ? `Their sheet refunds ${money(stated.refund)} ${stated.currency || ''}`.trim()
            + ' and our books hold none. The credit has not reached us.'
          : 'Their sheet says refunded and our books hold no refund against it.' });
      continue;
    }

    if (!theySayRefunded && ourRefunds.length > 0) {
      findings.push({ ...base, verdict: 'REFUND_NOT_ON_SHEET',
        note: `We hold a refund of ${money(ourRefunds.reduce((s, t) => s + Math.abs(t.amount || 0), 0))}`
            + ` ${ourRefunds[0].currency || ''}`.trimEnd()
            + ' that their sheet does not show.' });
      continue;
    }

    /* Their sheet stating a refund on more than one row for one ticket.
       Summing those is how 815 became 1,630 - see the note above. */
    const refundRows = rows.filter(r => r.refund != null);
    if (theySayRefunded && refundRows.length > 1) {
      const each = refundRows.map(r => `${money(r.refund!)} on row ${r.rowNo}`).join(' and ');
      findings.push({ ...base, verdict: 'TWICE_ON_THEIR_SHEET',
        note: `Their sheet states a refund for this ticket more than once — ${each}.`
            + (ourRefunds.length
              ? ` We hold ${money(ourRefunds.reduce((s, t) => s + Math.abs(t.amount || 0), 0))}`
                + ` ${ourRefunds[0].currency || ''}`.trimEnd() + '.'
              : ' We hold no refund at all.')
            + ' Nothing can be reconciled until their record settles on one figure.' });
      continue;
    }

    if (theySayRefunded && ourRefunds.length > 0) {
      const theirs = rows.reduce((s, r) => s + Math.abs(r.refund ?? 0), 0);
      // Both of ours: what reached us, and what the airline refunded before
      // our own commission came back off it. Their sheet records either.
      const ourNet = ourRefunds.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
      const ourGross = ourRefunds.reduce((s, t) => s + Math.abs(t.totalDoc || t.amount || 0), 0);
      // A figure written once for a cell naming three tickets is the
      // booking's, not this ticket's. Comparing it against one ticket's
      // refund would report a difference on all three every time.
      const shared = rows.some(r => r.groupSize > 1);
      // Agreement with either is agreement, so the nearer one is the gap.
      const gap = Math.abs(theirs - ourNet) <= Math.abs(theirs - ourGross)
        ? theirs - ourNet : theirs - ourGross;
      // Only when they actually stated a figure; a blank is not a zero.
      if (!shared && rows.some(r => r.refund != null) && Math.abs(gap) >= REFUND_FLOOR) {
        const cur = ourRefunds[0].currency || '';
        const both = Math.abs(ourGross - ourNet) >= 0.01
          ? `${money(ourNet)} after commission, ${money(ourGross)} before`
          : money(ourNet);
        findings.push({ ...base, verdict: 'REFUND_DIFFERS',
          note: `They refund ${money(theirs)}, we hold ${both} ${cur}`.trimEnd()
              + ` — ${money(gap)} apart at the nearest. Neither our commission nor`
              + ' rounding, so one of the two records is wrong.' });
        continue;
      }
    }

    findings.push({ ...base, verdict: 'OK', note: '' });
  }

  /* ── their rows with no ticket number ─────────────────────────────────── */
  /**
   * A damaged number can often still be identified by its PNR.
   *
   * Excel turns a ticket number into 6.55512E+11 and the digits are gone,
   * but the booking reference beside it survives. If exactly one ticket of
   * ours carries that PNR and nothing else on their sheet accounts for it,
   * the row is that ticket - and saying so is worth more than reporting the
   * same ticket twice, once as damaged on their side and once as missing
   * from their sheet.
   *
   * Only when it is unambiguous. A PNR covering three tickets cannot say
   * which one a damaged row is, and guessing there would be inventing the
   * very thing the last fix removed.
   */
  const claimedByPnr = new Set<string>();
  let onHold = 0;
  for (const r of noTicket) {
    // A held option is not a ticket. Nothing was issued, so nothing of
    // ours can be missing, and listing it is listing the system working.
    if (r.status === 'ON_HOLD' && !r.unreadable) { onHold++; continue; }

    let identified: Ticket[] = [];
    if (r.unreadable && r.pnr) {
      const candidates = ledger.filter(t =>
        isTicket(t)
        && (t.pnr || '').replace(/\s+/g, '').toUpperCase() === r.pnr
        && !theirSerials.has(ticketMatchKey(t.ticketNo || ''))
        && reqParts(t.reqNum || '').some(k => requests.has(k)));
      const serials = [...new Set(candidates.map(t => ticketMatchKey(t.ticketNo || '')))];
      if (serials.length === 1) {
        identified = candidates;
        claimedByPnr.add(serials[0]);
      }
    }

    findings.push({
      ...UNSOURCED,
      verdict: r.unreadable ? 'UNREADABLE' : 'NO_TICKET_NUMBER',
      serial: identified.length ? ticketMatchKey(identified[0].ticketNo || '') : '',
      airlineCode: identified[0]?.airlineCode || '', pnr: r.pnr, sheet: r,
      ours: identified,
      reqNum: identified[0]?.reqNum?.trim() || '', theirReq: r.reqNum,
      note: r.unreadable
        // Excel stored a 13-digit number as a number and rounded it away.
        ? `Their cell reads "${r.rawTicket}" — the number was lost on the way out of`
          + ' their system, most likely by being stored as a number.'
          + (identified.length
            ? ` PNR ${r.pnr} identifies it as this ticket, which is in our books, so nothing`
              + ' is missing — but their record still needs the number put back.'
            : ' Ask for the export with the ticket column as text.')
        : `Their sheet marks this ${r.rawStatus || 'issued'} and leaves the ticket number`
          + ' blank, so there is nothing to match it on. Only they can fill it in.',
    });
  }

  /* ── our side: anything under those requests they never mention ───────── */
  const ourExtra = new Map<string, Ticket[]>();
  const tooOld = new Set<string>();
  for (const t of ledger) {
    if (!isTicket(t)) continue;
    if (!reqParts(t.reqNum || '').some(x => requests.has(x))) continue;
    const k = ticketMatchKey(t.ticketNo || '');
    // claimedByPnr: their sheet does carry it, on a row whose number their
    // export damaged. Reporting it as missing as well would be counting the
    // same fault twice.
    if (!k || theirSerials.has(k) || claimedByPnr.has(k) || claimed.has(k)) continue;
    // And our reference sitting in THEIR PNR column, which is the same
    // filing difference read from the other end.
    if (isReference(k) && theirPnrs.has(k)) continue;
    // Outside the stretch this sheet is for. Counted below, never reported
    // as missing from a sheet that does not cover it. Note this is the ONLY
    // place a date narrows anything: every lookup above searched the whole
    // ledger, so a ticket of theirs matched one of ours whatever its date.
    if (!inPeriod((t.date as string) || '', from, to)) { tooOld.add(k); continue; }
    if (!ourExtra.has(k)) ourExtra.set(k, []);
    ourExtra.get(k)!.push(t);
  }
  for (const [serial, ours] of ourExtra)
    findings.push({
      ...UNSOURCED,
      verdict: 'NOT_ON_SHEET', serial, airlineCode: ours[0].airlineCode || '',
      pnr: ours[0].pnr || '', ours, reqNum: (ours[0].reqNum || '').trim(), theirReq: '',
      note: `In our books under ${(ours[0].reqNum || '').trim()} and not on their sheet at all.`,
    });

  /* ── where each one was bought ────────────────────────────────────────
     One pass over the finished list rather than a field set at fifteen
     call sites: the void branch swaps `sheet` for the priced row after
     building it, and a value copied before that swap would name the wrong
     row's portal. Reading it here reads whichever row the finding ended
     up carrying. */
  for (const f of findings) {
    const m = portalSource(f.sheet?.portal || '');
    // A ticket only we hold has no portal of theirs; our own books say
    // who billed us, which is the same question answered from our end.
    const oursSource = (f.ours[0]?.source || '').trim();
    f.portal = m.portal;
    f.issuedFrom = m.source || (m.choices.length ? m.choices.join(' or ') : '')
      || m.portal || oursSource;
    f.heldBack = m.heldBack;
    f.heldBackWhy = m.why;
  }

  findings.sort((a, b) =>
    VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]
    || a.reqNum.localeCompare(b.reqNum)
    || a.serial.localeCompare(b.serial));

  const counts = Object.fromEntries(
    (Object.keys(VERDICT_RANK) as Verdict[]).map(v => [v, 0])) as Record<Verdict, number>;
  for (const f of findings) counts[f.verdict]++;

  /* ── request by request, which is how a sheet gets closed ─────────────── */
  const ourSerialsByReq = new Map<string, Set<string>>();
  for (const t of ledger) {
    if (!isTicket(t)) continue;
    const serial = ticketMatchKey(t.ticketNo || '');
    if (!serial) continue;
    // A row filed "KSAML43-SA1157" counts under both, because it is under
    // both. Keying on the whole string instead would leave each of those
    // requests looking as though it held nothing.
    for (const k of reqParts(t.reqNum || '')) {
      if (!ourSerialsByReq.has(k)) ourSerialsByReq.set(k, new Set());
      ourSerialsByReq.get(k)!.add(serial);
    }
  }

  const byRequest: RequestLine[] = [...requests].sort().map(req => {
    const key = reqKey(req);
    const ourSet = ourSerialsByReq.get(key) ?? new Set<string>();
    /* Their list for this request. When their export names the request we
       use what they wrote; when it does not, the honest reading is "their
       tickets that WE hold under this request" - which still says how much
       of the request their sheet accounts for, and never invents a filing
       they did not state. */
    const theirSet = new Set<string>();
    for (const [serial, rows] of theirBySerial) {
      const stated = rows.find(r => reqKey(r.reqNum));
      if (sheetHasReq) { if (stated && reqParts(stated.reqNum).includes(key)) theirSet.add(serial); }
      else if (ourSet.has(serial)) theirSet.add(serial);
    }
    // A ticket their sheet carries on a row whose number was damaged is on
    // their sheet, whatever the cell now reads.
    for (const serial of claimedByPnr) if (ourSet.has(serial)) theirSet.add(serial);
    for (const serial of claimed) if (ourSet.has(serial)) theirSet.add(serial);
    const touches = (f: Finding) =>
      reqParts(f.reqNum).includes(key) || reqParts(f.theirReq).includes(key);
    const misfiled = findings.filter(f => f.verdict === 'REQ_DIFFERS' && touches(f)).length;
    const related = [...(relations.get(key) ?? [])].filter(x => x !== key).sort();
    const onlyTheirs = [...theirSet].filter(x => !ourSet.has(x)).length;
    const onlyOurs = [...ourSet].filter(x => !theirSet.has(x)).length;
    return {
      reqNum: req, theirTickets: theirSet.size, ourTickets: ourSet.size,
      onlyTheirs, onlyOurs, misfiled, related,
      agrees: onlyTheirs === 0 && onlyOurs === 0 && misfiled === 0,
    };
  });

  const inScope = (t: Ticket) => reqParts(t.reqNum || '').some(k => requests.has(k));
  const ourRows = [...ourBySerial.values()].flat().filter(inScope).length
    + [...ourExtra.values()].flat().length;

  return {
    findings, byRequest, sheetHasReq,
    sheetFrom, beforeTheirSystem: tooOld.size, onHold,
    period: { from, to },
    periodFromSource: typedFrom ? 'typed' : from ? 'sheet' : 'none',
    periodToSource: typedTo ? 'typed' : 'none',
    theirOutsidePeriod,
    reqSource: sheetHasReq ? 'sheet' : declared.length ? 'typed' : 'none',
    declared,
    requests: [...requests].sort(), counts,
    theirRows: sheet.length,
    theirTickets: theirBySerial.size,
    ourRows,
    matched,
    // A void and a row still on hold are states of the world, not
    // disagreements, so a sheet carrying only those is a clean sheet.
    // A void, a row still on hold and a related request are states of the
    // world rather than disagreements, so a sheet carrying only those is a
    // sheet that can be closed.
    clean: findings.every(f =>
      f.verdict === 'OK' || f.verdict === 'VOID_NOT_BILLED'
      || f.verdict === 'REQ_RELATED'
      || f.verdict === 'FILED_ELSEWHERE'),
    // VOID_AND_ISSUED deliberately absent: it is a question, not a state.
  };
}
