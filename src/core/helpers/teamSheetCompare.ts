import { Ticket } from '../../types';
import { ticketMatchKey } from './ticketIdentity';
import { TeamSheetRow } from '../parsers/teamSheet';

/**
 * Their sheet against our ledger, before a flight sheet is signed off.
 *
 * Two lists of the same tickets, kept by two teams from two directions: they
 * record what they booked, we record what we were billed. Where they differ,
 * one of four things happened - a ticket was never billed, a ticket was
 * never logged, a refund was never claimed, or a refund was never recorded -
 * and the last two are money.
 *
 * WHAT IS COMPARED, AND WHAT DELIBERATELY IS NOT
 *
 * The ticket number is the identity and it is compared. The refund is
 * compared, because both sides state it and, on the sheets seen so far, the
 * two agree to the fils.
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
  | 'NOT_IN_LEDGER'
  | 'VOID_NOT_BILLED'
  | 'REFUND_NOT_IN_LEDGER'
  | 'REFUND_NOT_ON_SHEET'
  | 'REFUND_DIFFERS'
  | 'NOT_ISSUED_YET'
  | 'NOT_ON_SHEET';

export const VERDICT_LABEL: Record<Verdict, string> = {
  OK:                   'Agrees',
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
  NOT_IN_LEDGER: 0,
  REFUND_NOT_IN_LEDGER: 1,
  NOT_ON_SHEET: 2,
  REFUND_NOT_ON_SHEET: 3,
  REFUND_DIFFERS: 4,
  NOT_ISSUED_YET: 5,
  VOID_NOT_BILLED: 6,
  OK: 7,
};

export interface Finding {
  verdict: Verdict;
  serial: string;
  airlineCode: string;
  pnr: string;
  /** Their side, when they have one. */
  sheet?: TeamSheetRow;
  /** Our side: every ledger row on that ticket, issue and refund together. */
  ours: Ticket[];
  reqNum: string;
  /** One line saying what to do about it, in the reader's own terms. */
  note: string;
}

export interface TeamSheetReport {
  findings: Finding[];
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

  /* ── the boundary: the requests their matched tickets belong to ───────── */
  const requests = new Set<string>();
  for (const [serial, rows] of theirBySerial) {
    for (const t of ourBySerial.get(serial) ?? [])
      if ((t.reqNum || '').trim()) requests.add((t.reqNum || '').trim().toUpperCase());
    // A sheet that names its own request widens the boundary to it, even
    // when not one of its tickets reached the ledger - which is exactly the
    // case worth catching on a sheet nobody has imported yet.
    for (const r of rows) if (r.reqNum) requests.add(r.reqNum.trim().toUpperCase());
  }
  for (const r of noTicket) if (r.reqNum) requests.add(r.reqNum.trim().toUpperCase());

  const findings: Finding[] = [];
  let matched = 0;

  /* ── walk their side ──────────────────────────────────────────────────── */
  for (const [serial, rows] of theirBySerial) {
    const ours = ourBySerial.get(serial) ?? [];
    const first = rows[0];
    const reqNum = (ours.find(t => (t.reqNum || '').trim())?.reqNum || first.reqNum || '').trim();
    const theySayRefunded = rows.some(r => r.status === 'REFUNDED');
    const theySayVoid = rows.some(r => r.status === 'VOID');
    const base = { serial, airlineCode: first.airlineCode, pnr: first.pnr, sheet: first, ours, reqNum };

    if (ours.length === 0) {
      // Issued and voided before the supplier ever billed it. Their sheet
      // shows both events; ours shows nothing, and that is correct.
      if (theySayVoid) {
        findings.push({ ...base, verdict: 'VOID_NOT_BILLED',
          note: 'Voided on their side, so no supplier ever billed it. Nothing to record.' });
      } else {
        findings.push({ ...base, verdict: 'NOT_IN_LEDGER',
          note: 'On their sheet and nowhere in our books — either the supplier has not billed'
              + ' it yet, or an import missed it.' });
      }
      continue;
    }

    matched++;
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
      ours: [], reqNum: r.reqNum,
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
      pnr: ours[0].pnr || '', ours, reqNum: (ours[0].reqNum || '').trim(),
      note: `In our books under ${(ours[0].reqNum || '').trim()} and not on their sheet at all.`,
    });

  findings.sort((a, b) =>
    VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]
    || a.serial.localeCompare(b.serial));

  const counts = Object.fromEntries(
    (Object.keys(VERDICT_RANK) as Verdict[]).map(v => [v, 0])) as Record<Verdict, number>;
  for (const f of findings) counts[f.verdict]++;

  const ourRows = [...ourBySerial.values()].flat()
    .filter(t => requests.has((t.reqNum || '').trim().toUpperCase())).length
    + [...ourExtra.values()].flat().length;

  return {
    findings, requests: [...requests].sort(), counts,
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
