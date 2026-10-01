/**
 * A ticket is shown in its own currency, not its vendor's.
 *
 *   npx tsx scripts/test-ticket-currency.ts
 *
 * 2792120971148, JetBlue bought on the airline's site: 1,323.40 USD on
 * their sheet, in Airtable and in our database — and "SAR" in the ticket
 * list, in "Net SAR" and in every export, because the list read the
 * currency off the vendor and "Airline Website" is not an AED vendor.
 */
import { ticketCurrency, sourceToCurrency, byCurrencyOrder } from '../src/core/helpers/sourceCurrency';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. Its own currency wins');
check('the JetBlue ticket is dollars', ticketCurrency({ source: 'Airline Website', currency: 'USD' }), 'USD');
check('the vendor alone would have said riyals', sourceToCurrency('Airline Website'), 'SAR');
check('an AED vendor ticket billed in riyals stays riyals', ticketCurrency({ source: 'RTS', currency: 'SAR' }), 'SAR');
check('euros', ticketCurrency({ source: 'Airline Website', currency: 'eur' }), 'EUR');

console.log('\n2. No currency recorded — the vendor\'s, as before');
check('RTS', ticketCurrency({ source: 'RTS', currency: null }), 'AED');
check('Ibtekar', ticketCurrency({ source: 'Ibtekar', currency: '' }), 'SAR');

console.log('\n3. Order for the summary bar');
check('SAR, AED, then the rest', ['USD', 'AED', 'EUR', 'SAR', 'GBP'].sort(byCurrencyOrder), ['SAR', 'AED', 'USD', 'EUR', 'GBP']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
