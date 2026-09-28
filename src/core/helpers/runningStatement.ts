import type { Ticket } from '../../types';
import type { Payment } from './statementMath';

/**
 * A vendor's account between two dates, one line at a time, with the balance
 * after every line — the shape of a bank statement.
 *
 * The screen above it already has every figure: the balance at each end, and
 * three lists — issued, refunded, paid. What it cannot do is say what the
 * balance was after any one ticket, and that is the question asked when a
 * figure somewhere in the middle looks wrong. Three lists in three orders
 * cannot answer it; one list in date order can.
 *
 * THE ARITHMETIC IS THE SCREEN'S, NOT A NEW ONE
 *
 * Opening balance, plus every payment, less every ticket — exactly what
 * Vendor Credit does. An issue is a positive amount and lowers the balance;
 * a refund is a negative amount and so, subtracted, raises it; a payment
 * raises it. Wallet top-ups filed as FUND rows are left out of the tickets,
 * because they are already counted as payments and the wallet counts them
 * once. So the last line's balance is the closing figure on the screen, to
 * the piastre — and if it ever is not, `foots` says so instead of printing a
 * statement that quietly disagrees with the page it came from.
 *
 * WITHIN A DAY
 *
 * Only dates are recorded, not times, so the order inside a day is chosen:
 * money in before money out — payments, then refunds, then issues — and by
 * document number after that, so the same range always prints the same way.
 * It changes which line a mid-day balance is printed against, never the
 * balance at the end of the day.
 */

export type LineKind = 'OPENING' | 'PAYMENT' | 'REFUND' | 'ISSUE';

export interface StatementLine {
  kind: LineKind;
  date: string;
  /** Ticket number, or the payment's note. */
  reference: string;
  passenger: string;
  reqNum: string;
  invoice: string;
  /** What the line did to the balance: positive raises it, negative lowers it. */
  effect: number;
  /** The balance after this line. */
  balance: number;
}

export interface RunningStatement {
  lines: StatementLine[];
  opening: number;
  closing: number;
  /** Does the walk arrive where the screen says the account closes? Null
   *  when there is nothing to check it against — a supplier with no wallet
   *  has no balance of ours to agree with, and saying "agrees" about nothing
   *  would be the one claim here that is not true. */
  foots: boolean | null;
  /** closing the walk reached, less the screen's; 0 when it foots. */
  gap: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ORDER: Record<LineKind, number> = { OPENING: 0, PAYMENT: 1, REFUND: 2, ISSUE: 3 };

export function runningStatement(
  opening: number,
  issues: Ticket[],
  refunds: Ticket[],
  payments: Payment[],
  expectedClosing: number | null,
): RunningStatement {
  const fund = (t: Ticket) => (t.status || '').toUpperCase() === 'FUND';
  const ticketLine = (t: Ticket): Omit<StatementLine, 'balance'> => ({
    kind: (t.amount || 0) < 0 ? 'REFUND' : 'ISSUE',
    date: (t.date || '').slice(0, 10),
    reference: t.airlineCode && t.ticketNo ? `${t.airlineCode}-${t.ticketNo}` : (t.ticketNo || ''),
    passenger: t.passengerName || '',
    reqNum: t.reqNum || '',
    invoice: t.vendorReference || '',
    effect: -(t.amount || 0),
  });

  const moves: Omit<StatementLine, 'balance'>[] = [
    ...issues.filter(t => !fund(t)).map(ticketLine),
    ...refunds.filter(t => !fund(t)).map(ticketLine),
    ...payments.map(p => ({
      kind: 'PAYMENT' as const,
      date: (p.date || '').slice(0, 10),
      reference: p.note || 'Payment',
      passenger: '', reqNum: '', invoice: '',
      effect: p.amount || 0,
    })),
  ].sort((a, b) =>
    a.date.localeCompare(b.date)
    || ORDER[a.kind] - ORDER[b.kind]
    || a.reference.localeCompare(b.reference));

  let bal = round2(opening);
  const lines: StatementLine[] = [{
    kind: 'OPENING', date: moves[0]?.date ?? '', reference: 'Opening balance',
    passenger: '', reqNum: '', invoice: '', effect: 0, balance: bal,
  }];
  for (const m of moves) {
    bal = round2(bal + m.effect);
    lines.push({ ...m, effect: round2(m.effect), balance: bal });
  }

  const gap = expectedClosing === null ? 0 : round2(bal - expectedClosing);
  return {
    lines, opening: round2(opening), closing: bal, gap,
    foots: expectedClosing === null ? null : Math.abs(gap) < 0.005,
  };
}
