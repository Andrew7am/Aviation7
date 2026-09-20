/**
 * A date typed by hand, and the rule that it can only ever be added.
 *
 * Date is not an ordinary editable field. Every period, every vendor
 * statement, the BSP settlement window and every opening balance is decided
 * by which side of a date a row falls on, so changing one silently re-bills a
 * settled period and the balance that comes out still looks like money. A row
 * with NO date has the opposite fault - it sits in no period at all and is
 * why a total quietly fails to foot - and filling that in costs nothing.
 *
 * Hence: fill in, never change. These pin both halves.
 */
import { validDateEntry } from '../src/components/TicketTable';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

/** The rule the cell and the editor both read. */
const canSetDate = (t: Partial<Ticket>) => !(t.date || '').trim();

console.log('\n1. Only a missing date can be set');
{
  check('a row with no date can be filled',   canSetDate({ date: '' }), true);
  check('one with only spaces counts as none', canSetDate({ date: '   ' }), true);
  check('an undefined date can be filled',    canSetDate({}), true);
  check('a date already recorded cannot be changed',
        canSetDate({ date: '2026-04-08' }), false);
}

console.log('\n2. A good date is taken');
{
  check('an ordinary day',   validDateEntry('2026-04-08'), '2026-04-08');
  check('the first day in range', validDateEntry('2024-01-01'), '2024-01-01');
  check('the last day in range',  validDateEntry('2027-12-31'), '2027-12-31');
  check('a leap day that exists',  validDateEntry('2024-02-29'), '2024-02-29');
  check('surrounding spaces are trimmed', validDateEntry('  2026-04-08 '), '2026-04-08');
}

console.log('\n3. A day that does not exist is refused');
{
  // These are the ones that matter: Date() accepts them and rolls them
  // forward, so 31 February would land in the ledger as 3 March without a
  // word. Refusing outright is the only safe answer to a typo.
  check('31 February',          validDateEntry('2026-02-31'), '');
  check('a leap day that is not one', validDateEntry('2026-02-29'), '');
  check('the 31st of a 30-day month', validDateEntry('2026-04-31'), '');
  check('month 13',             validDateEntry('2026-13-01'), '');
  check('day 00',               validDateEntry('2026-04-00'), '');
}

console.log('\n4. A year the agency has not traded in is refused');
{
  // A fat-fingered year is the worst outcome of all: the row saves, sits
  // outside every period forever, and is never looked at again.
  check('a year too early', validDateEntry('2023-12-31'), '');
  check('a year too late',  validDateEntry('2028-01-01'), '');
  check('a fat-fingered 2062', validDateEntry('2062-04-08'), '');
}

console.log('\n5. Anything that is not a date is refused');
{
  check('empty',            validDateEntry(''), '');
  check('only spaces',      validDateEntry('   '), '');
  check('day-first typing', validDateEntry('08/04/2026'), '');
  check('a bare year',      validDateEntry('2026'), '');
  check('words',            validDateEntry('today'), '');
  check('a short month',    validDateEntry('2026-4-8'), '');
  check('a date with time', validDateEntry('2026-04-08T00:00:00'), '');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
