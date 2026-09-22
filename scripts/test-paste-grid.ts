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
import { IbtekarV2Parser } from '../src/core/parsers/IbtekarV2Parser';

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

console.log('\n5. A row the copy broke into pieces');
{
  // Ibtekar's report wraps every ticket into three lines when it is copied
  // out of their page: the clipboard keeps the line breaks and does not
  // quote them. Read as three rows it produced one ticket numbered 0, with
  // the PNR reading "ELECTRON" and the route in the passenger's column.
  const HEAD = ['Tk Date','RecLoc','OfficeId Bk','OfficeId Tk','Passenger','No','Status',
                'Type','Iss','VC','Route','Fop','Pax','Fare eq.','Taxes','Fee',
                'NGrandTotal','GrandTotal','Actions'];
  const paste = [
    HEAD.join('\t'),
    '2026-09-21\t7FYTSN\tRUHS22420\tRUHS2234T\tJAMJOOM HYTHAM TALAL',
    '065-4862141169',
    'issd\tElectron\tBSP\tSV\tJED-RUH; RUH-JED\tCASH\t0\t0.00 SAR\t592.95 SAR\t0.00 SAR'
      + '\t1193.00 SAR\t1785.95 SAR\t1785.95 SAR',
    '2026-09-21\t7B3MX9\tRUHS22420\tRUHS2234T\tALZAHRANI RAZAN',
    '065-4862083218',
    'issd\tElectron\tBSP\tSV\tRUH-JED; JED-ELQ; ELQ-RUH\tCASH\t0\t0.00 SAR\t606.67 SAR'
      + '\t0.00 SAR\t1227.00 SAR\t1833.67 SAR\t1833.67 SAR',
  ].join('\n');

  const g = parseGrid(paste);
  check('seven lines become three rows', g.rows.length, 3);
  check('each the width of the header', [...new Set(g.rows.map(r => r.length))], [19]);
  check('the ticket number lands in its column', g.rows[1][5], '065-4862141169');
  check('the PNR in its own',                    g.rows[1][1], '7FYTSN');
  check('the passenger in theirs',               g.rows[1][4], 'JAMJOOM HYTHAM TALAL');
  check('and the second ticket too',             g.rows[2][5], '065-4862083218');

  // Read through the parser, which is where it went wrong on screen.
  const out = IbtekarV2Parser.parse(g.rows.slice(1), g.rows[0], 'SAR');
  check('two tickets, not one', out.rows.length, 2);
  check('numbered properly',    out.rows.map(t => t.ticketNo),
    ['4862141169', '4862083218']);
  check('with their carrier',   out.rows.map(t => t.airlineCode), ['065', '065']);
  check('and their money',      out.rows.map(t => t.amount), [1785.95, 1833.67]);
  // What it produced before: a ticket called 0 at nothing.
  check('no ticket numbered zero', out.rows.some(t => t.ticketNo === '0'), false);
  check('and the PNR is not the word Electron',
    out.rows.some(t => t.pnr === 'ELECTRON'), false);
}

console.log('\n6. Rows are joined only when the arithmetic is exact');
{
  // The whole safety of it: pieces of one row add up to the header's width.
  // Anything that does not add up is left exactly as it was, because a
  // wrong join is worse than a short row — it shifts every column after it.
  check('a whole grid is untouched',
    parseGrid('a\tb\tc\n1\t2\t3\n4\t5\t6').rows, [['a','b','c'],['1','2','3'],['4','5','6']]);

  // A totals line at the foot is short and belongs to nobody.
  const withTotal = parseGrid('a\tb\tc\n1\t2\t3\nTOTAL\t9');
  check('a totals line stays its own row', withTotal.rows.length, 3);
  check('and keeps its cells', withTotal.rows[2], ['TOTAL', '9']);

  // Two short rows that do not add up to the width stay apart.
  const noFit = parseGrid('a\tb\tc\td\te\n1\t2\n3\t4');
  check('four cells do not make five', noFit.rows.length, 3);

  // Two that do add up are one row.
  const fits = parseGrid('a\tb\tc\td\n1\t2\n3\t4');
  check('two and two make four', fits.rows.length, 2);
  check('joined in order', fits.rows[1], ['1','2','3','4']);

  // A short row between two whole ones is not swallowed by either.
  const middle = parseGrid('a\tb\tc\n1\t2\t3\nX\n4\t5\t6');
  check('a lone short row stays alone', middle.rows.length, 4);
  check('and the whole rows are untouched', middle.rows[3], ['4','5','6']);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
