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
  | 'NOT_IN_LEDGER'
  | 'VOID_NOT_BILLED'
  | 'REFUND_NOT_IN_LEDGER'
  | 'REFUND_NOT_ON_SHEET'
  | 'REFUND_DIFFERS'
  | 'NOT_ISSUED_YET'
  | 'NOT_ON_SHEET';

export const VERDICT_LABEL: Record<Verdict, string> = {
  OK:                   'Agrees',
  REQ_DIFFERS:          'Filed under a different request',
  NOT_IN_LEDGER:        'Not in our ledger',
  VOID_NOT_BILLED:      'Void — never billed',
  REFUND_NOT_IN_LEDGER: 'Refund not in our ledger',
  REFUND_NOT_ON_SHEET:  'Refunded, their sheet does not say so',
  REFUND_DIFFERS:       'Refund differs',
  NOT_ISSUED_YET:       'No ticket number yet',
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
  NOT_ISSUED_YET: 6,
  VOID_NOT_BILLED: 7,
  OK: 8,
};

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

export function compareTeamSheet(sheet: TeamSheetRow[], ledger: Ticket[]): TeamSheetReport {
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

  const sheetHasReq = sheet.some(r => !!reqKey(r.reqNum));

  /* ── the boundary: every request either side names ────────────────────── */
  const requests = new Set<string>();
  const addReq = (r: string) => { if (reqKey(r)) requests.add(r.trim().toUpperCase()); };
  for (const [serial, rows] of theirBySerial) {
    for (const t of ourBySerial.get(serial) ?? []) addReq(t.reqNum || '');
    // A sheet that names its own requests widens the boundary to them even
    // when not one of their tickets reached the ledger - which is exactly
    // the case worth catching on a request nobody has imported yet.
    for (const r of rows) addReq(r.reqNum);
  }
  for (const r of noTicket) addReq(r.reqNum);

  const findings: Finding[] = [];
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
    if (theirReq && ourReq && !sameReq(theirReq, ourReq)) {
      findings.push({ ...base, verdict: 'REQ_DIFFERS',
        note: `We file it under ${ourReq}; their sheet files it under ${theirReq}.`
            + ' One of the two requests is carrying a ticket that is not its own.' });
      continue;
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
      // Only when they actually stated a figure; a blank is not a zero.
      if (rows.some(r => r.refund != null) && Math.abs(theirs - ourSum) >= 0.01) {
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
  for (const r of noTicket)
    findings.push({
      verdict: 'NOT_ISSUED_YET', serial: '', airlineCode: '', pnr: r.pnr, sheet: r,
      ours: [], reqNum: r.reqNum, theirReq: r.reqNum,
      note: r.status === 'ON_HOLD'
        ? 'Still on hold on their side — no ticket has been issued to compare.'
        : 'Their row carries no ticket number, so there is nothing to match it on.',
    });

  /* ── our side: anything under those requests they never mention ───────── */
  const theirSerials = new Set(theirBySerial.keys());
  const ourExtra = new Map<string, Ticket[]>();
  for (const t of ledger) {
    if (!isTicket(t)) continue;
    const req = (t.reqNum || '').trim().toUpperCase();
    if (!req || !requests.has(req)) continue;
    const k = ticketMatchKey(t.ticketNo || '');
    if (!k || theirSerials.has(k)) continue;
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
    const k = reqKey(t.reqNum || '');
    if (!k) continue;
    const serial = ticketMatchKey(t.ticketNo || '');
    if (!serial) continue;
    if (!ourSerialsByReq.has(k)) ourSerialsByReq.set(k, new Set());
    ourSerialsByReq.get(k)!.add(serial);
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
      if (sheetHasReq) { if (stated && reqKey(stated.reqNum) === key) theirSet.add(serial); }
      else if (ourSet.has(serial)) theirSet.add(serial);
    }
    const misfiled = findings.filter(f =>
      f.verdict === 'REQ_DIFFERS'
      && (reqKey(f.reqNum) === key || reqKey(f.theirReq) === key)).length;
    const onlyTheirs = [...theirSet].filter(x => !ourSet.has(x)).length;
    const onlyOurs = [...ourSet].filter(x => !theirSet.has(x)).length;
    return {
      reqNum: req, theirTickets: theirSet.size, ourTickets: ourSet.size,
      onlyTheirs, onlyOurs, misfiled,
      agrees: onlyTheirs === 0 && onlyOurs === 0 && misfiled === 0,
    };
  });

  const ourRows = [...ourBySerial.values()].flat()
    .filter(t => requests.has((t.reqNum || '').trim().toUpperCase())).length
    + [...ourExtra.values()].flat().length;

  return {
    findings, byRequest, sheetHasReq, requests: [...requests].sort(), counts,
    theirRows: sheet.length,
    theirTickets: theirBySerial.size,
    ourRows,
    matched,
    // A void and a row still on hold are states of the world, not
    // disagreements, so a sheet carrying only those is a clean sheet.
    clean: findings.every(f =>
      f.verdict === 'OK' || f.verdict === 'VOID_NOT_BILLED' || f.verdict === 'NOT_ISSUED_YET'),
  };
}
