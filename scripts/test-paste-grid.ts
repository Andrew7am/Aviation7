/**
 * Pasted text must either split into columns or say it could not.
 *
 * A Turkish paste whose tabs had become spaces came through as one field per
 * line. Nothing failed: the parser found none of its columns and built a
 * ticket out of the whole line — numbered with the line, priced 2.37e+22, in
 * a currency the row never mentioned, sitting in the preview ready to import.
 */
import { parseGrid, gridProblem } from '../src/core/helpers/parseGrid';
import { runParser } from '../src/core/parsers';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const H = ['PNR','req num','Ticket Number','User Code','Transaction Date','Operation Type',
           'Payment Method','Total Fare','Base Fare','Equivalent Fare','Taxes','Currency','Domestic/International'];
const D = ['S2QE37','KSAML2325','2352540225958','7M','13.09.2026','ISSUE','CA','2140','540','540','1600','AED','INT'];

console.log('\n1. The delimiters a file uses');
for (const [label, sep] of [['tab', '\t'], ['comma', ','], ['semicolon', ';']] as [string, string][]) {
  const g = parseGrid(`${H.join(sep)}\n${D.join(sep)}`);
  check(`${label}: columns are found`, g.rows[0]?.length, 13);
  check(`${label}: no complaint`, gridProblem(g), '');
}

console.log('\n2. The same table pasted with spaces');
for (const [label, sep] of [['four spaces', '    '], ['tab-ish runs', '   ']] as [string, string][]) {
  const g = parseGrid(`${H.join(sep)}\n${D.join(sep)}`);
  check(`${label}: columns are recovered`, g.rows[0]?.length, 13);
  check(`${label}: recognised as whitespace`, g.delimiter, 'whitespace');
  const r = runParser(g.rows, undefined, 'SAR', 'turkish.txt');
  check(`${label}: the ticket reads correctly`, r.rows[0]?.ticketNo, '2540225958');
  check(`${label}: and the amount`, r.rows[0]?.amount, 2140);
  check(`${label}: and the currency`, r.rows[0]?.currency, 'AED');
}

console.log('\n3. Text with no columns at all');
{
  const g = parseGrid('just one line of prose\nand another');
  check('no delimiter is claimed', g.delimiter, 'none');
  check('and it says so', gridProblem(g).startsWith('The columns could not be told apart'), true);
}
{
  const g = parseGrid('   ');
  check('empty input asks for data', gridProblem(g), 'Please enter some data.');
}

console.log('\n4. A single space stays a single space');
{
  // Passenger names and routes contain spaces; splitting on one would shred them.
  const g = parseGrid('Ticket,Passenger,Route\n123,SMITH JOHN MR,JED RUH');
  check('a comma file keeps its fields whole', g.rows[1], ['123', 'SMITH JOHN MR', 'JED RUH']);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
