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
