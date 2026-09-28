/**
 * The second coupon of a conjunction is not a ticket.
 *
 *   npx tsx scripts/test-conjunction.ts
 *
 * Their sheet writes "157-5511323226-27": one passenger, one fare, two
 * document numbers. The queue proposed 227 as a ticket of its own, priced at
 * an even share of the cell, and sixteen rows worth 42,617 were exactly
 * this. Asserted on the real cells.
 */
import { conjunctionFirst, secondCouponsIn, passengersInCell } from '../src/core/helpers/conjunction';
import {
  whyNotConfirmable, passengersNamed, cellShares, canSplit, takesShare,
} from '../src/core/helpers/pendingFromFindings';
import type { PendingTicket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const CELL = '157-5511323226-27 , 157-5511323228-29';
const row = (ticketNo: string, extra: Partial<PendingTicket> = {}): PendingTicket => ({
  id: ticketNo, state: 'PENDING', source: 'Qatar Airways', ticketNo, pnr: '', date: '2026-08-01',
  amount: 0, totalDoc: 0, currency: 'AED', theirCost: 8020, theirGroup: 4, theirCell: CELL,
  ...extra,
} as PendingTicket);

console.log('\n1. Reading the cell');
check('227 is the second coupon of 226', conjunctionFirst('1575511323227', CELL), '5511323226');
check('229 is the second coupon of 228', conjunctionFirst('5511323229', CELL), '5511323228');
check('226 is a first coupon', conjunctionFirst('5511323226', CELL), null);
check('a number not in the cell', conjunctionFirst('5511323230', CELL), null);
check('the second coupons', [...secondCouponsIn(CELL)], ['5511323227', '5511323229']);
check('two passengers', passengersInCell(CELL), 2);
check('a plain list is not a conjunction',
      conjunctionFirst('5511323227', '157-5511323226 , 157-5511323227'), null);
check('a tail rolling over a ten', conjunctionFirst('5512970110', '157-5512970109-10'), '5512970109');
check('a run is not a conjunction', conjunctionFirst('5512938092', '180-5512938088-92'), null);
check('nor anything inside it', [...secondCouponsIn('180-5512938088-92')], []);
check('no cell, no answer', conjunctionFirst('5511323227', ''), null);

console.log('\n2. It cannot be confirmed, priced or not');
check('unpriced', whyNotConfirmable(row('5511323227')).startsWith('Second coupon of 5511323226'), true);
check('priced — typing a cost does not make it a ticket',
      whyNotConfirmable(row('5511323227', { amount: 2005, totalDoc: 2005 })).startsWith('Second coupon'), true);
check('the first coupon, priced, is fine', whyNotConfirmable(row('5511323226', { amount: 4010 })), '');

console.log('\n3. Dividing the cell by passengers, not documents');
const first = row('5511323226');
check('the cell covers two fares', passengersNamed(first), 2);
const group = [row('5511323226'), row('5511323227'), row('5511323228'), row('5511323229')].filter(takesShare);
check('only first coupons take a share', group.map(x => x.ticketNo), ['5511323226', '5511323228']);
check('each gets half of 8,020', cellShares(group, first), [4010, 4010]);
check('and it can be split', canSplit(group, first), '');
check('a cell of one conjunction is one fare — nothing to split',
      canSplit([row('5511323226', { theirCell: '157-5511323226-27', theirGroup: 2 })],
               row('5511323226', { theirCell: '157-5511323226-27', theirGroup: 2 })),
      'Their cell named only this ticket.');
check('a cell without conjunctions is unchanged',
      passengersNamed(row('5511323226', { theirCell: '157-5511323226 , 157-5511323228', theirGroup: 2 })), 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
