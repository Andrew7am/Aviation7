/**
 * Finding a ticket by what it cost - the Cost column filter on the ticket list.
 */
import { costMatches } from '../src/core/helpers/costMatch';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. As it was printed');
check('with a comma and decimals', costMatches('2,320.00', [2320, 2320]), true);
check('the exact figure, to the halala', costMatches('2320.50', [2320.5, 2400]), true);
check('...and not a near one', costMatches('2320.50', [2320.49, 2400]), false);
check('spaces typed in', costMatches(' 2 320 ', [2320]), true);

console.log('\n2. A whole number finds its whole part');
check('2320 finds 2,320.00', costMatches('2320', [2320]), true);
check('2320 finds 2,320.75', costMatches('2320', [2320.75]), true);
check('2320 does not find 2,321', costMatches('2320', [2321]), false);

console.log('\n3. Either figure, and a refund by its size');
check('the fare when what we pay differs', costMatches('16670', [0, 16670]), true);
check('a refund of -2,320', costMatches('2320', [-2320, 2320]), true);
check('typed negative', costMatches('-2320', [-2320]), true);

console.log('\n4. A range');
check('inside', costMatches('1000-2000', [1500]), true);
check('the ends count', costMatches('1000-2000', [2000]), true);
check('outside', costMatches('1000-2000', [2000.5]), false);
check('written backwards', costMatches('2000-1000', [1500]), true);
check('with commas', costMatches('1,000-2,000', [1999.99]), true);

console.log('\n5. Nothing typed, and nonsense');
check('empty finds everything', costMatches('', [5]), true);
check('letters find nothing', costMatches('abc', [5]), false);
check('a row with no figures', costMatches('5', [null, undefined]), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
