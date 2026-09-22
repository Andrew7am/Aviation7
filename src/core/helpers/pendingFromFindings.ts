import { Finding } from './teamSheetCompare';
import { PendingTicket, Ticket } from '../../types';
import { SupportedCurrency } from './resolveCurrency';
import { portalSource } from '../config/teamPortals';

/**
 * Turn what the check found into tickets somebody can agree to.
 *
 * The comparison ends with a couple of hundred tickets that are on their
 * sheet and in nobody's books. Each is almost certainly a real ticket; none
 * of them is a ticket we have checked. This builds the PROPOSAL — the row as
 * it would be recorded, with everything their sheet can honestly supply
 * filled in and everything it cannot left visibly empty — so that the work
 * left to a person is reading and correcting rather than typing.
 *
 * WHAT COMES ACROSS, AND WHAT DELIBERATELY DOES NOT
 *
 * The ticket number, the PNR, the airline, the date, the request and the
 * vendor all come across: those are facts of the booking and their sheet is
 * the better witness for every one of them.
 *
 * THE PRICE COMES ACROSS TOO, AND THAT WAS ONCE WRONG
 *
 * Their "Net Cost" was treated here as a marked-up figure and deliberately
 * not copied, so every proposal arrived at zero and could not be confirmed
 * until somebody typed a price. That was a misreading. Their sheet keeps
 * the marked-up rate in a column of its own ("Rate with MU") which is
 * never read; "Net Cost" is a net. Measured on 986 rows where both sides
 * hold one priced ticket in one currency, it equals our net exactly 533
 * times, our gross 86 times, and sits within a dirham 63 times more.
 *
 * So it is prefilled. A figure that is right two times in three and
 * correctable in one click beats a blank on 221 rows, and the row keeps
 * `theirCost` beside it so an untouched figure can still be told from a
 * checked one.
 *
 * ONE CELL, SEVERAL TICKETS, ONE PRICE
 *
 * Except when their cell named more than one ticket. The money on that
 * cell is the BOOKING'S, not any one ticket's, so prefilling three tickets
 * from it would treble the cost. Those arrive at zero and say why.
 *
 * A refund is prefilled for a different reason: it is not a price anybody
 * quoted, it is what the airline actually gave back, and on a full export
 * 95 of them match our net to the fils and 12 match our gross.
 *
 * WHAT CANNOT BE PROPOSED AT ALL
 *
 * Ibtekar and NSA bill on a statement that is imported whole and settles
 * against a credit wallet. Their tickets are still raised — a gap nobody can
 * see is a gap nobody closes — but flagged `heldBack`, and confirming is
 * closed on them. They arrive when their statement does.
 */

/** The verdicts that describe a ticket our books do not have. */
const PROPOSABLE = new Set(['NOT_IN_LEDGER', 'REFUND_NOT_IN_LEDGER']);

/**
 * What a proposal is ABOUT: its origin, the document, and the finding.
 *
 * The same sheet is checked several times before it is signed off, so the
 * second run must land on the row the first run raised. Not the id, which is
 * new every time, and not the whole row, which changes as their sheet is
 * corrected — the identity of the question being asked.
 *
 * The verdict is part of it because one document can raise two: a ticket we
 * are missing and a refund we are missing are two separate things to agree
 * to, and collapsing them would lose one.
 */
export function dedupeKey(origin: string, serial: string, pnr: string, verdict: string): string {
  return [origin, (serial || pnr || '').toUpperCase(), verdict].join('|');
}

/** A refund is stored negative, as everywhere else in the ledger. */
const refundAmount = (n: number) => -Math.abs(n);

export interface BuildOptions {
  /** Where these came from, for the dedupe key and the screen. */
  origin?: string;
  /** Ids are supplied rather than generated so the build stays pure and a
   *  test can name what it expects. */
  newId: () => string;
  userId: string;
}

export function pendingFromFindings(
  findings: Finding[],
  { origin = 'TEAM_SHEET', newId, userId }: BuildOptions,
): PendingTicket[] {
  const out: PendingTicket[] = [];

  for (const f of findings) {
    if (!PROPOSABLE.has(f.verdict)) continue;
    const s = f.sheet;
    // Every proposable finding comes from their side, so this cannot
    // normally be missing; a finding without one carries nothing to propose.
    if (!s) continue;

    const isRefund = f.verdict === 'REFUND_NOT_IN_LEDGER';
    // A carrier that issues no IATA ticket puts the booking reference in the
    // ticket column, and that reference IS the document. Either way the
    // serial is what identifies it; the PNR is the fallback for a row whose
    // number their export damaged.
    const ticketNo = f.serial || (f.pnr || '');
    const match = portalSource(s.portal || '');

    out.push({
      id: newId(),
      userId,

      ticketNo,
      // Ambiguous on purpose when their portal names an airline rather than
      // a house that bills us: FlyAdeal bills from two, and the choice is
      // the reviewer's. An empty source is what stops the confirm.
      source: match.source,
      date: s.issued || '',
      // Their net, which is a net. Zero when their cell named several
      // tickets: that figure is the booking's and would treble the cost.
      // See the note above.
      amount: isRefund
        ? (s.refund != null ? refundAmount(s.refund) : 0)
        : (s.groupSize === 1 && s.cost != null ? Math.abs(s.cost) : 0),
      commission: 0,
      totalDoc: isRefund
        ? (s.refund != null ? Math.abs(s.refund) : 0)
        : (s.groupSize === 1 && s.cost != null ? Math.abs(s.cost) : 0),
      // We hold no row for it, so their request is the only one there is.
      // Kept in both places: this is what it would be filed under, and
      // `theirReq` is the record of where that came from.
      reqNum: (f.theirReq || '').toUpperCase(),
      pnr: (f.pnr || '').toUpperCase(),
      // Their sheet names the person who booked it, not the passenger. It
      // is left empty rather than filled with the wrong name.
      passengerName: '',
      airlineCode: f.airlineCode || '',
      route: '',
      status: isRefund ? 'REFUND' : 'ISSUE',
      currency: (s.currency || 'AED') as SupportedCurrency,
      transactionType: isRefund ? 'REFUND' : 'ISSUE',
      // A booking bought on an airline's own site will never be invoiced, so
      // its own reference is the only one it will ever have.
      vendorReference: '',

      origin,
      theirPortal: match.portal,
      theirReq: f.theirReq || '',
      theirCost: isRefund ? (s.refund ?? undefined) : (s.cost ?? undefined),
      theirGroup: s.groupSize,
      theirCell: s.rawTicket,
      finding: f.verdict,
      note: f.note,
      heldBack: f.heldBack,
      heldBackWhy: f.heldBackWhy,

      state: 'PENDING',
      dedupe: dedupeKey(origin, f.serial, f.pnr, f.verdict),
    });
  }

  return out;
}

/**
 * Whether a proposal is complete enough to become a ticket.
 *
 * Three things stop it, and each is something only a person can settle: a
 * vendor, because their portal sometimes names an airline rather than the
 * house that bills us; a price, on the rows where their cell priced a whole
 * booking rather than this ticket; and the held-back rule, which no amount
 * of filling in can satisfy.
 */
export function whyNotConfirmable(p: PendingTicket): string {
  if (p.state !== 'PENDING') return `Already ${p.state.toLowerCase()}.`;
  if (p.heldBack) return p.heldBackWhy || 'Held back.';
  if (!p.source.trim()) return 'Pick the vendor that billed it.';
  if (!p.ticketNo.trim() && !(p.pnr || '').trim()) return 'No ticket number and no PNR.';
  if (!p.date.trim()) return 'Give it a date.';
  if (!p.amount) {
    // Two different reasons a row arrives unpriced, and telling somebody
    // their cell priced a whole booking when it in fact priced nothing
    // sends them looking for a division that does not exist.
    return (p.theirGroup ?? 1) > 1
      ? `Enter what it cost — their figure covers all ${p.theirGroup} tickets in that cell.`
      : 'Enter what it cost — their sheet states no figure for it.';
  }
  return '';
}

export const canConfirm = (p: PendingTicket) => whyNotConfirmable(p) === '';

/**
 * The ticket a confirmed proposal becomes.
 *
 * The most consequential line in the feature, so it is here rather than
 * inside the service: this is what actually reaches the ledger, and it has
 * to obey the same rules a ticket keyed by hand obeys.
 *
 * A refund is stored negative however it was typed, so a credit can never
 * be booked as a sale by a stray minus sign. Identifiers are uppercased,
 * because the ledger matches on them and "ysml73" would be a ticket nobody
 * ever finds again. `reportName` says where it came from without pretending
 * a supplier reported it.
 */
export function ticketFromPending(p: PendingTicket, id: string, userId: string): Ticket {
  const isRefund = (p.transactionType || '').toUpperCase() === 'REFUND';
  return {
    id,
    ticketNo: (p.ticketNo || p.pnr || '').toUpperCase(),
    pnr: (p.pnr || '').toUpperCase(),
    passengerName: (p.passengerName || '').toUpperCase(),
    airlineCode: p.airlineCode || '',
    route: (p.route || '').toUpperCase(),
    source: p.source,
    date: p.date,
    amount: isRefund ? -Math.abs(p.amount) : Math.abs(p.amount),
    totalDoc: Math.abs(p.totalDoc || p.amount),
    commission: p.commission ?? 0,
    reqNum: (p.reqNum || '').toUpperCase(),
    vendorReference: (p.vendorReference || '').toUpperCase(),
    status: isRefund ? 'REFUND' : 'ISSUE',
    transactionType: isRefund ? 'REFUND' : 'ISSUE',
    currency: p.currency,
    reportName: 'Team sheet — reviewed',
    importTime: new Date().toISOString(),
    isDuplicate: false,
    closed: false,
    userId,
  };
}

/**
 * Which proposals came out of one cell of their sheet.
 *
 * Their export puts a whole booking in one cell and prices it once, so
 * five tickets arrive as five proposals carrying one figure between them.
 * Pricing them means dividing that figure, and dividing it means first
 * knowing which five.
 *
 * The cell text alone is not enough: "157-5511323214-15" appears twice on
 * a sheet where the same booking was issued and later reissued, and those
 * are different money. The request, the date and the currency are what
 * separate them, and together with the cell they are what their sheet
 * itself treats as one line.
 */
export function cellKey(p: PendingTicket): string {
  return [p.theirCell || '', p.currency || '', p.reqNum || '', p.date || '',
          p.transactionType || ''].join('|');
}

/**
 * Divide a cell's figure across the tickets that shared it.
 *
 * Their sheet prices the booking and never the tickets, and the per-ticket
 * fares are not recoverable from it. What IS exact is the total, and on a
 * request the total is the figure that has to be right — so the division
 * is even and the remainder goes to the last ticket. The tickets are then
 * approximate and the total is exact, which is the way round that costs
 * nothing on a reconciliation.
 *
 * Every figure is rounded to the fils before the remainder is worked out,
 * so the parts always add back to the whole: 100 over 3 is 33.33, 33.33
 * and 33.34, never three 33.33s and a penny lost.
 */
export function splitEvenly(total: number, n: number): number[] {
  if (n < 1) return [];
  const round = (x: number) => Math.round(x * 100) / 100;
  const whole = Math.abs(round(total));
  const each = round(whole / n);
  const parts = Array.from({ length: n }, () => each);
  parts[n - 1] = round(whole - each * (n - 1));
  return parts;
}

/**
 * What each ticket in front of us gets when a cell is divided.
 *
 * ALWAYS divided by the number their cell NAMED, never by how many of
 * them happen to be in the queue. Their cell "176-5512938117-18
 * 180-5512938088 …" names five tickets and only two are waiting, because
 * the other three are already in our books with their own recorded cost.
 * Dividing 2,960 by the two in front of us would give each of them 1,480
 * — two fifths of a booking priced as two halves — and the request would
 * come out over by nearly a thousand.
 *
 * So each present ticket gets one fifth, the three already recorded keep
 * what we recorded, and the request picks up exactly the share of the
 * booking that was missing from it.
 *
 * When every one of them IS here, the remainder goes to the last so the
 * parts add back to the cell exactly. When some are not, there is no last
 * to give it to — the fils belongs to a ticket we are not touching.
 */
export function cellShares(group: PendingTicket[], p: PendingTicket): number[] {
  const named = p.theirGroup ?? 1;
  const total = Math.abs(p.theirCost ?? 0);
  if (named < 2 || !total) return [];
  if (group.length === named) return splitEvenly(total, named);
  const each = Math.round((total / named) * 100) / 100;
  return group.map(() => each);
}

/**
 * Whether a cell can be divided at all.
 *
 * Not whether all of it is here — see `cellShares`, which divides by what
 * their cell named and is right either way. What stops it is a cell that
 * named one ticket, a cell with no figure, and a row somebody has already
 * decided about.
 */
export function canSplit(group: PendingTicket[], p: PendingTicket): string {
  const want = p.theirGroup ?? 1;
  if (want < 2) return 'Their cell named only this ticket.';
  if (!p.theirCost) return 'Their sheet states no figure for that cell.';
  if (group.some(x => x.state !== 'PENDING')) return 'Some of them are already decided.';
  if (!group.length) return 'None of them are waiting.';
  return '';
}
