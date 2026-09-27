/**
 * Two things a ledger row can be quiet about: money it carries that nobody
 * billed, and a date that is not a date.
 *
 * Fourteen Ibtekar tickets hold about ten riyals more than Ibtekar's own
 * movement sheet bills for the same document, and the rule is exact rather
 * than approximate — every one is the sheet's figure plus ten, rounded to
 * the whole riyal. Nothing in the ledger said so, because a price is just a
 * number and nothing about it says where it came from.
 *
 * And three of those rows carry 1970-01-01, which is what an empty date
 * becomes after a trip through a number. That is worse than blank: blank is
 * visibly missing and the screen offers to fill it, while the epoch looks
 * like a date, sorts to the top, and files the row in a period fifty-six
 * years before the business existed.
 */
import { missingDate, displayDate } from '../src/core/helpers/missingDate';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. A date that says when');
{
  check('an ordinary date', missingDate('2026-07-04'), false);
  check('the first day the rule allows', missingDate('2000-01-01'), false);
  check('with a time on it', missingDate('2026-07-04T00:00:00Z'), false);
  check('kept as written', displayDate('2026-07-04'), '2026-07-04');
}

console.log('\n2. A date that does not');
{
  check('empty', missingDate(''), true);
  check('null', missingDate(null), true);
  check('undefined', missingDate(undefined), true);
  check('whitespace', missingDate('   '), true);
  // The one actually in the ledger.
  check('the Unix epoch', missingDate('1970-01-01'), true);
  check('  ...with a time on it', missingDate('1970-01-01T00:00:00.000Z'), true);
  check('Excel serial zero', missingDate('1899-12-30'), true);
  check('and anything else from last century', missingDate('1975-06-01'), true);
  check('or implausibly far ahead', missingDate('2126-01-01'), true);
  check('a non-date string', missingDate('not a date'), true);
}

console.log('\n3. What the screen shows for one');
{
  // The editor opens empty rather than pre-filled with 1970-01-01, so the
  // date typed is the date meant and not an edit of a number nobody chose.
  check('the epoch displays as nothing', displayDate('1970-01-01'), '');
  check('empty displays as nothing', displayDate(''), '');
  check('a real date displays itself', displayDate('2026-09-23'), '2026-09-23');
}

/* ── the ten riyals ──────────────────────────────────────────────────── */

console.log('\n4. The adjustment is what the row carries above its own fare');
{
  /* The question is inside the row: Balance Payable against Fare. Twenty-one
     Ibtekar rows sit about ten riyals apart, and no other vendor does it.

     An earlier version of this asked the ledger against Ibtekar's movement
     sheet instead, and found a different fourteen. The tax invoices then
     showed the ledger agreeing with the invoice to the fil on every one of
     them - so the SHEET was the short document and there was nothing to
     settle. Eleven of those fourteen also showed the same number in both
     columns on screen, which is how the wrong question announced itself. */
  const gap = (fare: number, payable: number) => Math.round((payable - fare) * 100) / 100;

  // Real rows: fare, payable.
  const real: [number, number][] = [
    [711.85,  722.00],  [786.60,  797.00],  [772.80,  783.00],  [1846.90, 1857.00],
    [1791.70, 1803.00], [897.00,  906.00],  [761.30,  770.99],  [458.85,  469.00],
    [5618.90, 5629.00], [848.70,  859.00],  [1604.25, 1614.00], [722.20,  732.00],
    [1728.45, 1739.00], [672.75,  683.00],  [1000.50, 1011.00], [596.85,  607.00],
    [400.20,  410.00],  [940.70,  951.00],  [878.60,  889.00],  [825.70,  836.00],
    [1982.60, 1993.00],
  ];
  check('twenty-one of them', real.length, 21);

  const gaps = real.map(([f, p]) => gap(f, p));
  check('every one is above its fare', gaps.every(g => g > 0), true);
  check('and every one is about ten', gaps.every(g => g >= 9 && g <= 11.5), true);
  check('they run from', Math.min(...gaps), 9);
  check('  ...to', Math.max(...gaps), 11.3);
  check('and come to', Math.round(gaps.reduce((n, g) => n + g, 0) * 100) / 100, 213.59);

  // Not a flat ten, so a flat ten must not be what gets stored.
  check('they are not all the same figure', new Set(gaps).size > gaps.length / 2, true);

  // A row whose two columns agree carries nothing, whatever some other
  // document says about it.
  check('equal fare and payable is not an adjustment', gap(1707, 1707), 0);
  check('  ...and a payable BELOW the fare is a different question',
        gap(1000, 999) < 0, true);
}

console.log('\n5. An untouched row is not a checked row');
{
  /* The column is null where nothing was added, never 0. Zero is a claim
     that somebody looked and found nothing, and almost no row has been
     looked at. The two have to stay distinguishable or the column stops
     meaning anything the moment it is used. */
  const rows: { adjustment?: number }[] = [
    { adjustment: 10 }, { adjustment: 0 }, {},
  ];
  const carries = rows.filter(r => r.adjustment != null);
  check('a row with an adjustment is found', carries.length, 2);
  check('  ...including one settled at zero',
        carries.some(r => r.adjustment === 0), true);
  check('an untouched row is not', rows.filter(r => r.adjustment == null).length, 1);
  // The trap: a falsy test would drop the settled row out of the list.
  check('a falsy test would lose the settled one',
        rows.filter(r => r.adjustment).length, 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
