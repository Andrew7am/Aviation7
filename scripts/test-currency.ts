/**
 * The currency must describe the figure the parser took.
 *
 * RTS states the original fare in the customer's currency and then what it
 * billed in its own. Matching any header containing "currency" found the
 * fare's, so amounts read from an AED total were filed as USD.
 */
import { resolveCurrency } from '../src/core/helpers/resolveCurrency';
import { classifyAgainstExisting, detectDuplicatesAgainstExisting } from '../src/core/ImportEngine';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = got === want;
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. RTS: a fare currency beside a total currency');
{
  const h = ['No', 'Fare', 'Fare currency', 'Taxes', 'Taxes currency', 'Total', 'Total currency'];
  check('the total wins over the fare (USD fare)',
        resolveCurrency(['016-1', '920', 'USD', '0', 'AED', '0', 'AED'], h, 'SAR'), 'AED');
  check('the total wins over the fare (EUR fare)',
        resolveCurrency(['006-2', '1635', 'EUR', '1450', 'AED', '8440', 'AED'], h, 'SAR'), 'AED');
  check('an unsupported fare currency is no different',
        resolveCurrency(['076-3', '690', 'GBP', '1840', 'AED', '5280', 'AED'], h, 'SAR'), 'AED');
  check('a genuinely USD total is still USD',
        resolveCurrency(['016-4', '920', 'EUR', '0', 'USD', '900', 'USD'], h, 'SAR'), 'USD');
}

console.log('\n2. A report with one plain currency column');
{
  const h = ['Ticket', 'Amount', 'Currency'];
  check('it is used',           resolveCurrency(['1', '100', 'AED'], h, 'SAR'), 'AED');
  check('SAR is used',          resolveCurrency(['1', '100', 'SAR'], h, 'AED'), 'SAR');
  check('lowercase is read',    resolveCurrency(['1', '100', 'aed'], h, 'SAR'), 'AED');
}

console.log('\n3. Nothing to go on');
{
  check('falls back to the import default',
        resolveCurrency(['1', '100'], ['Ticket', 'Amount'], 'AED'), 'AED');
  check('an unreadable value falls back too',
        resolveCurrency(['1', '100', 'XYZ'], ['Ticket', 'Amount', 'Currency'], 'SAR'), 'SAR');
  check('a blank value falls back too',
        resolveCurrency(['1', '100', ''], ['Ticket', 'Amount', 'Currency'], 'SAR'), 'SAR');
}

console.log('\n4. A fare currency on its own is still better than nothing');
{
  const h = ['Ticket', 'Fare', 'Fare currency'];
  check('used when it is the only one there',
        resolveCurrency(['1', '100', 'USD'], h, 'SAR'), 'USD');
}

console.log('\n5. Other shapes the vendors ship');
{
  check('account currency',
        resolveCurrency(['1', '100', 'AED'], ['Ticket', 'Amount', 'Account Currency'], 'SAR'), 'AED');
  check('booking currency',
        resolveCurrency(['1', '100', 'AED'], ['Ticket', 'Amount', 'Booking Currency'], 'SAR'), 'AED');
  check('"Curr" abbreviated',
        resolveCurrency(['1', '100', 'AED'], ['Ticket', 'Amount', 'Curr'], 'SAR'), 'AED');
}

console.log('\n6. A currency difference is reported, not swallowed');
{
  const mk = (o: any): any => ({
    id: o.id ?? Math.random().toString(36).slice(2),
    ticketNo: '5513436946', pnr: 'XOC5RH', passengerName: 'ALANAZI', airlineCode: '006',
    route: '', source: 'RTS', date: '2026-09-10', amount: 8440, totalDoc: 8440,
    commission: 0, reqNum: 'UAEVP711', status: 'ISSUE', currency: 'AED',
    isDuplicate: false, userId: 'u', ...o,
  });

  const [c] = classifyAgainstExisting([mk({ currency: 'AED' })], [mk({ id: 'held', currency: 'EUR' })]);
  check('the same figure in another currency is flagged', c.cls, 'CURRENCY_DIFF');

  const [same] = classifyAgainstExisting([mk({})], [mk({ id: 'h' })]);
  check('an identical row is still a match', same.cls, 'EXACT_MATCH');

  // A settlement whose only change is the currency has something to do.
  const r = detectDuplicatesAgainstExisting(
    [mk({ source: 'IATA BSP', currency: 'AED', channel: 'BSP' })],
    [mk({ id: 'held', source: 'IATA BSP', currency: 'EUR' })]);
  check('a currency-only settlement is not called a duplicate', r.duplicates.length, 0);
  check('it settles instead', r.settlements.length, 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
