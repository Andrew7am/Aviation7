/**
 * A proposal for a document that was cancelled.
 *
 * The review queue is built from the aviation team's sheet, and their sheet
 * lists a ticket as live until somebody updates it. Nobody always does. So a
 * row can sit there looking like a supplier who has not billed us yet when
 * the document was voided months ago and no supplier ever will.
 *
 * Confirming one writes a ticket into the ledger for a document that does
 * not exist — money against nothing, inside a request's cost and a vendor's
 * balance, where it will never reconcile against anything because there is
 * nothing to reconcile it against. Twelve of the hundred and three waiting
 * are exactly this, 58,438 between them.
 */
import { voidIndex, voidFor, voidsInQueue } from '../src/core/helpers/pendingVoids';
import type { PendingTicket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const pend = (o: Partial<PendingTicket> = {}): PendingTicket => ({
  id: Math.random().toString(36).slice(2),
  userId: 'u', ticketNo: '5513373350', source: 'IATA BSP', date: '2026-09-05',
  amount: 0, commission: 0, totalDoc: 0, reqNum: 'KSAML2218', pnr: 'XNZBUG',
  passengerName: '', airlineCode: '065', route: '', status: 'ISSUE',
  currency: 'AED', transactionType: 'ISSUE', origin: 'TEAM_SHEET',
  theirCost: 18200, theirGroup: 1, heldBack: false, state: 'PENDING',
  dedupe: 'x', createdAt: '',
  ...o,
} as PendingTicket);

const v = (ticketNo: string, source = 'IATA BSP', period = '260901') =>
  ({ ticketNo, source, period });

console.log('\n1. A proposal for a cancelled document is found');
{
  const idx = voidIndex([v('5513373350')]);
  check('by its document', voidFor(pend(), idx)?.period, '260901');
  check('a live one is not', voidFor(pend({ ticketNo: '1111111111' }), idx), undefined);
}

console.log('\n2. Punctuation is not identity');
{
  /* The register holds what the invoice printed and the queue holds what
     their sheet typed, and the two are punctuated differently. */
  const idx = voidIndex([v('5513373350')]);
  check('prefixed in the queue', voidFor(pend({ ticketNo: '065-5513373350' }), idx)?.period, '260901');
  check('unpunctuated in the queue', voidFor(pend({ ticketNo: '0655513373350' }), idx)?.period, '260901');
  const idx2 = voidIndex([v('065-5513373350')]);
  check('and prefixed in the register', voidFor(pend(), idx2)?.period, '260901');
}

console.log('\n3. The supplier is not part of the question');
{
  /* A ticket bought through RTS and cancelled by BSP is one document
     cancelled once. Requiring both sides to name the same vendor would
     miss it — and missing it is what puts the money in the books. */
  const idx = voidIndex([v('5513373350', 'IATA BSP')]);
  check('cancelled by one, proposed under another',
        voidFor(pend({ source: 'RTS' }), idx)?.source, 'IATA BSP');
}

console.log('\n4. What the queue is holding');
{
  const rows = [
    pend({ ticketNo: '5513373350', theirCost: 18200 }),
    pend({ ticketNo: '5512760048', theirCost: 14848 }),
    pend({ ticketNo: '1111111111', theirCost: 500 }),
  ];
  const r = voidsInQueue(rows, [v('5513373350'), v('5512760048', 'IATA BSP', '260602')]);
  check('two of the three', r.matched.length, 2);
  check('and what confirming them would have written', r.value, 33048);
  check('in one currency', r.currencies, ['AED']);
  check('the live one is untouched',
        r.matched.some(x => x.proposal.ticketNo === '1111111111'), false);
}

console.log('\n5. Only what is still waiting');
{
  /* A proposal already confirmed or rejected is finished work. Counting it
     here would report a problem somebody has already dealt with. */
  const rows = [
    pend({ state: 'CONFIRMED' }),
    pend({ state: 'REJECTED' }),
    pend({ state: 'PENDING' }),
  ];
  const r = voidsInQueue(rows, [v('5513373350')]);
  check('one, not three', r.matched.length, 1);
  check('and it is the pending one', r.matched[0].proposal.state, 'PENDING');
}

console.log('\n6. Their figure, because we hold none');
{
  // We have nothing in the books for these — that is why they are proposals
  // — so their sheet's cost is the only number there is.
  const r = voidsInQueue([pend({ amount: 0, theirCost: 4780 })], [v('5513373350')]);
  check('their cost is used', r.value, 4780);

  // Where somebody already priced the row, that is what would be written.
  const priced = voidsInQueue([pend({ amount: 4700, theirCost: undefined })], [v('5513373350')]);
  check('otherwise the amount on the row', priced.value, 4700);

  const nothing = voidsInQueue([pend({ amount: 0, theirCost: undefined })], [v('5513373350')]);
  check('and an unpriced row adds nothing', nothing.value, 0);
  check('  ...but is still reported', nothing.matched.length, 1);
}

console.log('\n7. Nothing to say when there is nothing to say');
{
  check('no voids', voidsInQueue([pend()], []).matched, []);
  check('no queue', voidsInQueue([], [v('5513373350')]).matched, []);
  check('neither', voidsInQueue([], []).value, 0);
  // A document cancelled twice is one cancellation.
  const idx = voidIndex([v('5513373350', 'IATA BSP', '260901'), v('5513373350', 'IATA BSP', '260902')]);
  check('one entry, not two', idx.size, 1);
  check('  ...the first kept', idx.get('5513373350')?.period, '260901');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
