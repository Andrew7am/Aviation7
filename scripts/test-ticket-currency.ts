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
import { toDirhams } from '../src/core/helpers/toDirhams';
import { ticketFromPending } from '../src/core/helpers/pendingFromFindings';
import type { Ticket } from '../src/types';

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

console.log('\n4. Dollars go into the books as dirhams, the dollars kept');
{
  const t = toDirhams<Partial<Ticket>>({ ticketNo: '2120971148', amount: 1323.4, totalDoc: 1323.4, commission: 0, currency: 'USD' });
  check('1,323.40 USD is 4,856.88 AED', [t.amount, t.currency], [4856.88, 'AED']);
  check('the fare too', t.totalDoc, 4856.88);
  check('and what it was', [t.originalCurrency, t.originalAmount, t.fxRate], ['USD', 1323.4, 3.67]);
  check('never converted twice', toDirhams(t).amount, 4856.88);
  check('a refund stays a refund', toDirhams({ amount: -100, currency: 'USD' }).amount, -367);
  check('riyals are left alone', toDirhams({ amount: 1274, currency: 'SAR' }), { amount: 1274, currency: 'SAR' });
}

console.log('\n5. From their sheet into the books');
{
  // Their row: United, bought on the airline's site, 70.00 USD.
  const p = { id: 'p', state: 'PENDING', source: 'Airline Website', ticketNo: '4733988310', pnr: 'Y29G7O',
    date: '2026-09-23', amount: 70, totalDoc: 70, currency: 'USD', reqNum: 'UAECO716', transactionType: 'ISSUE' } as any;
  const t = ticketFromPending(p, 'id', 'u');
  check('recorded in dirhams', [t.amount, t.currency], [256.9, 'AED']);
  check('saying it was 70 dollars', [t.originalCurrency, t.originalAmount], ['USD', 70]);
  check('a riyal ticket goes in as riyals',
        ticketFromPending({ ...p, amount: 1274, totalDoc: 1274, currency: 'SAR' }, 'id', 'u').currency, 'SAR');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
