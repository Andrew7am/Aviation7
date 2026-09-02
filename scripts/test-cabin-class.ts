/**
 * Reading a cabin out of whatever the source called it.
 *
 * Every string here is one the agency's own export actually contains.
 *
 * Run: npx tsx scripts/test-cabin-class.ts
 */
import { toCabin, isUnreadableCabin, isMixedCabin, CABIN_LABEL } from '../src/core/helpers/cabinClass';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

console.log('\n1. The plain cases');
check('Economy', toCabin('Economy'), 'ECONOMY');
check('Business', toCabin('Business'), 'BUSINESS');
check('First', toCabin('First'), 'FIRST');
check('Premium Economy', toCabin('Premium Economy'), 'PREMIUM_ECONOMY');
check('Economy Premium, written the other way round', toCabin('Economy Premium'), 'PREMIUM_ECONOMY');

console.log('\n2. Names airlines invented, where the words still say the cabin');
check('Business Elite', toCabin('Business Elite'), 'BUSINESS');
check('Business; Prestige', toCabin('Business; Prestige'), 'BUSINESS');
check('Economy; Main Cabin', toCabin('Economy; Main Cabin'), 'ECONOMY');
check('Economy - Smart', toCabin('Economy - Smart'), 'ECONOMY');
check('Economy Plus; Economy', toCabin('Economy Plus; Economy'), 'ECONOMY');

console.log('\n3. A journey through more than one cabin takes the highest');
check('Economy; Business', toCabin('Economy; Business'), 'BUSINESS');
check('Business; Economy', toCabin('Business; Economy'), 'BUSINESS');
check('Business; First', toCabin('Business; First'), 'FIRST');
check('First; Business; Economy', toCabin('First; Business; Economy'), 'FIRST');
check('Economy; Premium Economy', toCabin('Economy; Premium Economy'), 'PREMIUM_ECONOMY');
check('and it is flagged as mixed', isMixedCabin('Economy; Business'), true);
check('a single cabin is not mixed', isMixedCabin('Economy'), false);

console.log('\n4. "We could not tell" is not a cabin');
check("Class couldn't be determined", toCabin("Class couldn't be determined"), '');
check('and it is not flagged as unreadable either', isUnreadableCabin("Class couldn't be determined"), false);
check('a known cabin beside it still reads',
  toCabin("Business; Class couldn't be determined"), 'BUSINESS');
check("Economy; Class couldn't be determined",
  toCabin("Economy; Class couldn't be determined"), 'ECONOMY');

console.log('\n5. Brand names that state no cabin are left alone, not guessed');
for (const name of ['fly+', 'Fly+', 'flyMax', 'Guest Basic', 'GO Basic', 'Plus', 'Premium Class']) {
  check(`${name} is not assigned a cabin`, toCabin(name), '');
  check(`${name} is reported as unreadable`, isUnreadableCabin(name), true);
}

console.log('\n6. Nothing in means nothing out');
check('empty', toCabin(''), '');
check('blank spaces', toCabin('   '), '');
check('undefined', toCabin(undefined), '');
check('an empty value is not "unreadable"', isUnreadableCabin(''), false);

console.log('\n7. Case and spacing do not matter');
check('ECONOMY', toCabin('ECONOMY'), 'ECONOMY');
check('  business  ', toCabin('  business  '), 'BUSINESS');
check('economy;business', toCabin('economy;business'), 'BUSINESS');

console.log('\n8. Every cabin has a label to show');
check('four labels', Object.keys(CABIN_LABEL).sort(),
  ['BUSINESS', 'ECONOMY', 'FIRST', 'PREMIUM_ECONOMY']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
