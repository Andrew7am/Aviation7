import { Ticket } from '../../types';
import { ticketMatchKey } from './ticketIdentity';
import { TeamSheetRow } from '../parsers/teamSheet';

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
 * The cost is NOT compared. Their figure carries their markup and is written
 * in whichever currency the booking was quoted in: on one sheet their column
 * read 1,371 SAR beside our 1,340 AED, and 2,530 beside our 2,520, for
 * tickets that are certainly the same ticket. Flagging those would raise
 * thirty findings out of thirty-one matches, and a report that is wrong
 * thirty times stops being read the first time. Both figures are carried so
 * they can be looked at; neither is called an error.
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
 * A VOID IS NOT A GAP
 *
 * A ticket issued and voided the same day never reaches the supplier's
 * invoice, so its absence from our ledger is correct. Reporting it as
 * missing would be reporting the system working. It is counted separately
 * and said plainly.
 */

export type Verdict =
  | 'OK'
  | 'REQ_DIFFERS'
  | 'REQ_RELATED'
  | 'FILED_ELSEWHERE'
  | 'NOT_IN_LEDGER'
  | 'VOID_NOT_BILLED'
  | 'REFUND_NOT_IN_LEDGER'
  | 'REFUND_NOT_ON_SHEET'
  | 'REFUND_DIFFERS'
  | 'NOT_ISSUED_YET'
  | 'UNREADABLE'
  | 'NOT_ON_SHEET';

export const VERDICT_LABEL: Record<Verdict, string> = {
  OK:                   'Agrees',
  REQ_DIFFERS:          'Filed under a different request',
  REQ_RELATED:          'A related request',
  FILED_ELSEWHERE:      'In both, in different columns',
  NOT_IN_LEDGER:        'Not in our ledger',
  VOID_NOT_BILLED:      'Void — never billed',
  REFUND_NOT_IN_LEDGER: 'Refund not in our ledger',
  REFUND_NOT_ON_SHEET:  'Refunded, their sheet does not say so',
  REFUND_DIFFERS:       'Refund differs',
  NOT_ISSUED_YET:       'No ticket number yet',
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
  // A row that cannot be checked at all. Above the states of the world,
  // because somebody has to go and ask for the number.
  UNREADABLE: 5.5,
  NOT_ISSUED_YET: 6,
  // Two requests that belong together - a cash ticket beside the request it
  // was split from. Worth seeing, never worth chasing.
  REQ_RELATED: 7,
  // The same reference, one side's ticket column against the other's PNR.
  // Nothing is missing; the filing differs.
  FILED_ELSEWHERE: 7.5,
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
export const reqKey = (s: string | undefined | null) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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
  /** Our request for this ticket, or theirs when we do not hold it. */
  reqNum: string;
  /** Their request, when their sheet states one. Kept beside ours rather
   *  than collapsed into it: on a misfiled ticket the two differ, and which
   *  is which is the whole finding. */
  theirReq: string;
  /** One line saying what to do about it, in the reader's own terms. */
  note: string;
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
  /** True when nothing needs anybody's attention. */
  clean: boolean;
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
    const theySayVoid = rows.some(r => r.status === 'VOID');
    const base = {
      serial, airlineCode: first.airlineCode, pnr: first.pnr, sheet: first, ours,
      reqNum: ourReq || theirReq, theirReq,
    };

    if (ours.length === 0) {
      // A carrier reference we file under the PNR instead. Nothing is
      // missing; the two systems chose different columns for one value.
      const filedUnderPnr = isReference(serial) ? (ourByPnr.get(serial) ?? []) : [];
      if (filedUnderPnr.length) {
        for (const t of filedUnderPnr) claimed.add(ticketMatchKey(t.ticketNo || ''));
        findings.push({
          ...base, verdict: 'FILED_ELSEWHERE', ours: filedUnderPnr,
          reqNum: (filedUnderPnr.find(t => (t.reqNum || '').trim())?.reqNum || '').trim() || theirReq,
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
      findings.push({ ...base, verdict: 'REFUND_NOT_IN_LEDGER',
        note: first.refund != null
          ? `Their sheet refunds ${money(first.refund)} ${first.currency || ''}`.trim()
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

    if (theySayRefunded && ourRefunds.length > 0) {
      const theirs = rows.reduce((s, r) => s + Math.abs(r.refund ?? 0), 0);
      const ourSum = ourRefunds.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
      // A figure written once for a cell naming three tickets is the
      // booking's, not this ticket's. Comparing it against one ticket's
      // refund would report a difference on all three every time.
      const shared = rows.some(r => r.groupSize > 1);
      // Only when they actually stated a figure; a blank is not a zero.
      if (!shared && rows.some(r => r.refund != null) && Math.abs(theirs - ourSum) >= 0.01) {
        findings.push({ ...base, verdict: 'REFUND_DIFFERS',
          note: `They refund ${money(theirs)}, we hold ${money(ourSum)}`
              + ` ${ourRefunds[0].currency || ''}`.trimEnd()
              + ` — a difference of ${money(theirs - ourSum)}.` });
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
  for (const r of noTicket) {
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
      verdict: r.unreadable ? 'UNREADABLE' : 'NOT_ISSUED_YET',
      serial: identified.length ? ticketMatchKey(identified[0].ticketNo || '') : '',
      airlineCode: identified[0]?.airlineCode || '', pnr: r.pnr, sheet: r,
      ours: identified,
      reqNum: identified[0]?.reqNum?.trim() || r.reqNum, theirReq: r.reqNum,
      note: r.unreadable
        // Excel stored a 13-digit number as a number and rounded it away.
        ? `Their cell reads "${r.rawTicket}" — the number was lost on the way out of`
          + ' their system, most likely by being stored as a number.'
          + (identified.length
            ? ` PNR ${r.pnr} identifies it as this ticket, which is in our books, so nothing`
              + ' is missing — but their record still needs the number put back.'
            : ' Ask for the export with the ticket column as text.')
        : r.status === 'ON_HOLD'
          ? 'Still on hold on their side — no ticket has been issued to compare.'
          : 'Their row carries no ticket number, so there is nothing to match it on.',
    });
  }

  /* ── our side: anything under those requests they never mention ───────── */
  const ourExtra = new Map<string, Ticket[]>();
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
    if (!ourExtra.has(k)) ourExtra.set(k, []);
    ourExtra.get(k)!.push(t);
  }
  for (const [serial, ours] of ourExtra)
    findings.push({
      verdict: 'NOT_ON_SHEET', serial, airlineCode: ours[0].airlineCode || '',
      pnr: ours[0].pnr || '', ours, reqNum: (ours[0].reqNum || '').trim(), theirReq: '',
      note: `In our books under ${(ours[0].reqNum || '').trim()} and not on their sheet at all.`,
    });

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
      || f.verdict === 'NOT_ISSUED_YET' || f.verdict === 'REQ_RELATED'
      || f.verdict === 'FILED_ELSEWHERE'),
  };
}
