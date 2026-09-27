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

/** The ledger figure, given what the vendor's sheet bills: plus ten, rounded
 *  to the whole riyal. This is the rule the fourteen rows follow exactly. */
const withFee = (sheet: number) => Math.round(sheet + 10);

console.log('\n4. The rule behind the fourteen is exact, not "about ten"');
{
  // Every pair below is a real row: the sheet's debit and what the ledger holds.
  const real: [number, number][] = [
    [1288.00, 1298.00], [1607.70, 1618.00], [1607.70, 1618.00], [947.60, 958.00],
    [711.85,  722.00],  [1037.30, 1047.00], [1697.40, 1707.00], [6118.00, 6128.00],
    [6118.00, 6128.00], [711.85,  722.00],  [786.60,  797.00],  [715.30,  725.00],
    [1183.35, 1193.00], [1869.90, 1880.00],
  ];
  check('fourteen of them', real.length, 14);
  const off = real.filter(([sheet, ledger]) => withFee(sheet) !== ledger);
  check('every one is the sheet plus ten, rounded', off, []);

  // The gaps range 9.60 to 10.40 — which is why "about ten" looked like the
  // rule and is not one. The rounding is what makes them differ.
  const gaps = real.map(([s, l]) => Math.round((l - s) * 100) / 100);
  check('the gaps are not all ten', new Set(gaps).size > 1, true);
  check('  ...they run from', Math.min(...gaps), 9.6);
  check('  ...to', Math.max(...gaps), 10.4);
  check('and together they come to',
        Math.round(gaps.reduce((n, g) => n + g, 0) * 100) / 100, 140.45);
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
