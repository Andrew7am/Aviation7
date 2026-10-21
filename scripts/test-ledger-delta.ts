/**
 * The ledger on the device, brought up to date with only what changed -
 * the read that replaced loading all 6,000 tickets on every open.
 */
import { applyDelta, changedSince, cursorOf } from '../src/core/helpers/ledgerDelta';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const row = (id: string, at: string, amount = 100) => ({ id, updated_at: at, amount });
const T = (m: number) => `2026-10-21T10:${String(m).padStart(2, '0')}:00.000Z`;
const held = () => ({ byId: new Map([['a', row('a', T(0))], ['b', row('b', T(1))], ['c', row('c', T(2))]]), cursor: T(2), fullAt: 1 });

console.log('\n1. What changed comes in, what was deleted goes');
{
  const h = applyDelta(held(), [row('b', T(5), 250), row('d', T(6))], [{ id: 'c', deleted_at: T(4) }]);
  check('an edited row takes its new figure', h.byId.get('b')?.amount, 250);
  check('a new row is added', h.byId.has('d'), true);
  check('a deleted row goes', h.byId.has('c'), false);
  check('untouched rows stay', h.byId.has('a'), true);
  check('the cursor moves to the latest time the server gave', h.cursor, T(6));
  check('the order held is kept, new ones last', [...h.byId.keys()], ['a', 'b', 'd']);
}

console.log('\n2. The cases that would lose or resurrect a ticket');
{
  check('a row read now exists, whatever an earlier delete of its id says',
    applyDelta(held(), [row('c', T(7))], [{ id: 'c', deleted_at: T(3) }]).byId.has('c'), true);
  check('nothing changed: nothing moves', applyDelta(held(), [], []).cursor, T(2));
  check('the cursor never goes back', applyDelta(held(), [row('a', T(1))], []).cursor, T(2));
  check('the held copy is not changed in place', (() => { const h = held(); applyDelta(h, [], [{ id: 'a', deleted_at: T(9) }]); return h.byId.has('a'); })(), true);
}

console.log('\n3. Reading from a minute before the cursor');
check('a write that committed late is still read', changedSince(T(10)), T(9));
check('the whole read sets the cursor to its latest row', cursorOf([row('a', T(3)), row('b', T(8)), row('c', T(1))]), T(8));
check('rows from before the column existed give no cursor', cursorOf([{ id: 'x' } as any]), '');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
