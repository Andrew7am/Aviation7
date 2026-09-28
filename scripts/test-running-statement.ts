/**
 * A vendor's account between two dates, one line at a time, with the
 * balance after every line.
 *
 * The arithmetic is the one Vendor Credit already does — opening balance,
 * plus every payment, less every ticket — so the last line of the statement
 * must be the closing figure on the screen, to the piastre. Checked on the
 * real accounts: NSA walks 1,312 lines from 62,183.48 Cr to 3,795.76 Cr, and
 * Ibtekar 252 lines from 12,660.16 Cr to 3,330.22 Cr, both exactly.
 */
import { runningStatement } from '../src/core/helpers/runningStatement';
import type { Ticket } from '../src/types';
import type { Payment } from '../src/core/helpers/statementMath';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

let n = 0;
const tkt = (date: string, amount: number, o: Partial<Ticket> = {}): Ticket => ({
  id: `t${++n}`, ticketNo: `55133${String(n).padStart(5, '0')}`, source: 'NSA', date, amount,
  totalDoc: Math.abs(amount), commission: 0, reqNum: 'KSAML1', status: amount < 0 ? 'REFUND' : 'ISSUE',
  isDuplicate: false, userId: 'u', currency: 'SAR', airlineCode: '065', ...o,
});
const pay = (date: string, amount: number): Payment =>
  ({ id: `p${++n}`, vendorName: 'NSA', date, amount, note: 'Transfer' });

console.log('\n1. An issue lowers the balance, a refund and a payment raise it');
{
  const r = runningStatement(1000,
    [tkt('2026-09-01', 300)], [tkt('2026-09-02', -100)], [pay('2026-09-03', 500)], 1300);
  check('opening line', [r.lines[0].kind, r.lines[0].balance], ['OPENING', 1000]);
  check('the issue takes 300 off', [r.lines[1].kind, r.lines[1].effect, r.lines[1].balance], ['ISSUE', -300, 700]);
  check('the refund puts 100 back', [r.lines[2].kind, r.lines[2].effect, r.lines[2].balance], ['REFUND', 100, 800]);
  check('the payment adds 500', [r.lines[3].kind, r.lines[3].effect, r.lines[3].balance], ['PAYMENT', 500, 1300]);
  check('it closes where the screen does', [r.closing, r.foots, r.gap], [1300, true, 0]);
}

console.log('\n2. Date order across all three lists');
{
  // Three lists, each in its own order; the statement is one list in time.
  const r = runningStatement(0,
    [tkt('2026-09-05', 100), tkt('2026-09-01', 100)],
    [tkt('2026-09-03', -50)],
    [pay('2026-09-02', 1000)], 850);
  check('in date order', r.lines.slice(1).map(l => l.date),
        ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05']);
  check('the balance after each', r.lines.slice(1).map(l => l.balance), [-100, 900, 950, 850]);
}

console.log('\n3. Inside one day: money in before money out');
{
  /* Only dates are recorded, so the order within a day is chosen, and chosen
     the same way every time. It moves which line a mid-day balance is printed
     against — never the balance at the end of the day. */
  const r = runningStatement(0,
    [tkt('2026-09-01', 300)], [tkt('2026-09-01', -100)], [pay('2026-09-01', 500)], 300);
  check('payment, refund, issue', r.lines.slice(1).map(l => l.kind), ['PAYMENT', 'REFUND', 'ISSUE']);
  check('the day still ends in the same place', r.closing, 300);

  // Same input, different order: same statement.
  const r2 = runningStatement(0,
    [tkt('2026-09-01', 300, { ticketNo: 'B' }), tkt('2026-09-01', 200, { ticketNo: 'A' })], [], [], -500);
  check('same-day issues by document number', r2.lines.slice(1).map(l => l.reference), ['065-A', '065-B']);
}

console.log('\n4. A wallet top-up is a payment, not a ticket');
{
  /* A top-up imported as a FUND row is already counted as a payment. The
     wallet counts it once; so must the statement, or it walks off by the
     size of every top-up. */
  const r = runningStatement(0,
    [tkt('2026-09-01', 50000, { status: 'FUND' }), tkt('2026-09-02', 700)], [],
    [pay('2026-09-01', 50000)], 49300);
  check('the FUND row is not a line', r.lines.some(l => l.effect === -50000), false);
  check('the payment is', r.lines.some(l => l.kind === 'PAYMENT' && l.effect === 50000), true);
  check('and it foots', r.foots, true);
}

console.log('\n5. When it does not foot, it says so');
{
  // The screen says 1,000 and the lines say 700: the file must not pretend.
  const r = runningStatement(1000, [tkt('2026-09-01', 300)], [], [], 1000);
  check('not footed', r.foots, false);
  check('and by how much', r.gap, -300);
}

console.log('\n6. Nothing to check against is not "agrees"');
{
  // A supplier with no wallet has no balance of ours; the walk is the
  // movement only, and claiming it matches something would be untrue.
  const r = runningStatement(0, [tkt('2026-09-01', 300)], [], [], null);
  check('foots is unknown, not true', r.foots, null);
  check('the movement is still there', r.closing, -300);
}

console.log('\n7. Balances do not drift over a long account');
{
  // 1,300 lines of figures with pennies: summed as floats they wander.
  const issues = Array.from({ length: 1300 }, (_, i) => tkt('2026-09-01', 760.2 + (i % 7) * 0.01));
  const total = issues.reduce((s, t) => s + t.amount, 0);
  const expected = Math.round((62183.48 - total) * 100) / 100;
  const r = runningStatement(62183.48, issues, [], [], expected);
  check('still foots to the piastre', r.foots, true);
  check('every balance has two decimals at most',
        r.lines.every(l => Math.round(l.balance * 100) / 100 === l.balance), true);
}

console.log('\n8. An empty range is one line');
{
  const r = runningStatement(500, [], [], [], 500);
  check('the opening, and nothing else', r.lines.length, 1);
  check('closing is opening', [r.closing, r.foots], [500, true]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
