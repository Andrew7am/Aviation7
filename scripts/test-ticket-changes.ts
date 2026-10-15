/**
 * Realtime events applied to the list instead of reading all 6,000 tickets
 * again: the list must come out exactly as a full read would give it.
 */
import { applyTicketChanges } from '../src/core/helpers/applyTicketChanges';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const t = (id: string, o: Partial<Ticket> = {}): Ticket => ({ id, ticketNo: id, source: 'RTS', date: '2026-10-15', amount: 100,
  commission: 0, totalDoc: 100, reqNum: '', userId: 'u', ...o });

const prev = [t('a'), t('b'), t('c')];
check('nothing to apply leaves the list as it is', applyTicketChanges(prev, []) === prev, true);
check('a changed row is replaced where it stands',
  applyTicketChanges(prev, [{ kind: 'UPSERT', ticket: t('b', { route: 'DXB-CAI' }) }]).map(x => [x.id, x.route ?? '']),
  [['a', ''], ['b', 'DXB-CAI'], ['c', '']]);
check('a new row is added at the end', applyTicketChanges(prev, [{ kind: 'UPSERT', ticket: t('d') }]).map(x => x.id), ['a', 'b', 'c', 'd']);
check('a deleted row goes', applyTicketChanges(prev, [{ kind: 'DELETE', id: 'b' }]).map(x => x.id), ['a', 'c']);
check('in the order the events came: changed, then deleted',
  applyTicketChanges(prev, [{ kind: 'UPSERT', ticket: t('b', { reqNum: 'X1' }) }, { kind: 'DELETE', id: 'b' }]).map(x => x.id), ['a', 'c']);
check('the last change of a row wins',
  applyTicketChanges(prev, [{ kind: 'UPSERT', ticket: t('a', { reqNum: 'R1' }) }, { kind: 'UPSERT', ticket: t('a', { reqNum: 'R2' }) }])[0].reqNum, 'R2');
check('an event with nothing in it changes nothing', applyTicketChanges(prev, [null]).map(x => x.id), ['a', 'b', 'c']);
check('the list it was given is not changed', prev.map(x => x.id), ['a', 'b', 'c']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
