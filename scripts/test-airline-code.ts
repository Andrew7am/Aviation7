/**
 * The airline column holds a number, in one alphabet, always.
 *
 * A ticket carries its carrier as three digits - 065 is Saudia - and that is
 * what a BSP invoice prints, what the first three digits of a document
 * number are, and what every screen in this app reads: the A/L filter, the
 * document number the tables rebuild, the carrier name beside it.
 *
 * Ibtekar's export does not. It has a "VC" column - validating carrier -
 * and writes the two-letter designator in it: SV, MS, TK. That went into
 * the ledger's airline column untranslated, so an import preview showed
 * "SV" in a column every other row fills with a number, and a ticket saved
 * that way would have been invisible to a search for 065.
 *
 * Two alphabets for one fact. These tests pin the translation, and pin the
 * cases where translating would be inventing.
 */
import { airlineNumeric, airlineIata, airlineName } from '../src/core/config/airlines';
import { IbtekarV2Parser } from '../src/core/parsers/IbtekarV2Parser';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. A designator becomes the code it stands for');
{
  check('SV is Saudia',        airlineNumeric('SV'), '065');
  check('MS is EgyptAir',      airlineNumeric('MS'), '077');
  check('TK is Turkish',       airlineNumeric('TK'), '235');
  check('GF is Gulf Air',      airlineNumeric('GF'), '072');
  check('lower case reads too', airlineNumeric('sv'), '065');
  check('and padding is ignored', airlineNumeric('  SV  '), '065');
}

console.log('\n2. A number stays a number, padded the way the ledger stores it');
{
  check('already three digits', airlineNumeric('065'), '065');
  check('two digits pad',       airlineNumeric('65'), '065');
  check('one digit pads',       airlineNumeric('6'), '006');
  check('and 235 is itself',    airlineNumeric('235'), '235');
}

console.log('\n3. What is not in the table translates to nothing, never a guess');
{
  // A wrong carrier code in an accounting report is worse than a blank one:
  // it routes a ticket to an airline that never flew it.
  check('an unknown designator', airlineNumeric('XX'), '');
  check('IndiGo, which we have not been given', airlineNumeric('6E'), '');
  check('blank',                 airlineNumeric(''), '');
  check('nothing at all',        airlineNumeric(undefined), '');
  check('a name is not a code',  airlineNumeric('Saudia'), '');
}

console.log('\n4. The two directions cannot drift apart');
{
  // Both are built from one table, so every designator it holds must come
  // back to the code it came from. A collision would mean two carriers
  // sharing a designator, and the reverse lookup silently picking one.
  let round = 0;
  const broken: string[] = [];
  for (let n = 1; n <= 999; n++) {
    const iata = airlineIata(String(n));
    if (!iata) continue;
    if (airlineNumeric(iata) === String(n).padStart(3, '0')) round++;
    else broken.push(`${n} -> ${iata} -> ${airlineNumeric(iata)}`);
  }
  check('every designator round trips', broken, []);
  check('and there are plenty of them', round > 60, true);
}

console.log("\n5. Ibtekar's VC column, through the parser");
{
  // Their real shape: a ten-digit document with no carrier prefix, so the
  // VC column is the only place the carrier appears at all.
  const HEAD = ['Tk Date', 'RecLoc', 'Passenger', 'No', 'Status', 'VC', 'Route',
                'GrandTotal', 'Req Num'];
  const run = (rows: string[][], headers = HEAD) =>
    IbtekarV2Parser.parse(rows, headers, 'SAR');

  const out = run([
    ['21/09/2026', '7FYTSN', 'JAMJOOM HYTHAM', '4862141169', 'issd', 'SV', 'JED-RUH',
     '1785.95', 'KSAML2552'],
    ['21/09/2026', '7B3MX9', 'ALZAHRANI RAZAN', '4862083218', 'issd', 'SV', 'RUH-JED',
     '1833.67', 'KSAML2628'],
  ]);
  check('two tickets read', out.rows.length, 2);
  check('the carrier is a number', out.rows.map(t => t.airlineCode), ['065', '065']);
  check('not the designator', out.rows.some(t => t.airlineCode === 'SV'), false);
  check('and it names the airline', airlineName(out.rows[0].airlineCode), 'Saudia');
  check('the ticket number is untouched',
    out.rows.map(t => t.ticketNo), ['4862141169', '4862083218']);

  // A carrier we have no code for leaves the column blank rather than
  // filling it with letters, and says so. 6E is IndiGo, which flies these
  // routes and is not in the agency's table - the first designator picked
  // for this test was XY, which turned out to be flynas.
  const unknown = run([
    ['21/09/2026', '7FYTSN', 'SOMEBODY', '4862141170', 'issd', '6E', 'JED-RUH', '100',
     'KSAML1'],
  ]);
  check('an unknown carrier leaves it blank', unknown.rows[0].airlineCode, '');
  check('and warns rather than staying quiet',
    unknown.warnings.some(w => w.includes('6E')), true);
  // The one it was nearly wrong about: a designator that IS in the table.
  check('XY is flynas, not an unknown', airlineNumeric('XY'), '593');

  // A VC column holding the number already is taken as it stands.
  const numeric = run([
    ['21/09/2026', '7FYTSN', 'SOMEBODY', '4862141171', 'issd', '065', 'JED-RUH', '100',
     'KSAML1'],
  ]);
  check('a numeric VC passes through', numeric.rows[0].airlineCode, '065');

  // And with no VC column at all, the code off the document is still used.
  const noVc = IbtekarV2Parser.parse(
    [['21/09/2026', '7FYTSN', 'SOMEBODY', '065-4862141172', 'issd', 'JED-RUH', '100',
      'KSAML1']],
    ['Tk Date', 'RecLoc', 'Passenger', 'No', 'Status', 'Route', 'GrandTotal', 'Req Num'],
    'SAR');
  check('read off the document instead', noVc.rows[0].airlineCode, '065');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
