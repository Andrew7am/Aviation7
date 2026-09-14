/**
 * Ibtekar writes dd/mm/yyyy, on every row of every document.
 *
 * The ticket rows were being split by hand in that order; the receipt rows went
 * through parseDate on its mm/dd default. So within one parser the tickets
 * landed on the right day and the payments did not — and only on the first
 * twelve days of a month, because there is no month 19 for 19/05 to swap into.
 * Five of Ibtekar's thirteen payments were on the wrong day, and 11/06 became
 * the 6th of November: a date in the future, outside every period a balance
 * could be drawn for.
 *
 * The dates below are the real ones off their statement of account.
 */
import { parseDate } from '../src/core/helpers/parseDate';
import { runParser } from '../src/core/parsers';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. parseDate, told which way round to read');
{
  check('01/06 day-first is the 1st of June',  parseDate('01/06/2026', 'dmy'), '2026-06-01');
  check('and month-first the 6th of January',  parseDate('01/06/2026', 'mdy'), '2026-01-06');
  check('11/06 day-first is the 11th of June', parseDate('11/06/2026', 'dmy'), '2026-06-11');
  check('and month-first the 6th of November', parseDate('11/06/2026', 'mdy'), '2026-11-06');
  // Where the day is past 12 there is nothing to get wrong.
  check('19/05 can only be the 19th',          parseDate('19/05/2026', 'dmy'), '2026-05-19');
  check('even read the other way',             parseDate('19/05/2026', 'mdy'), '2026-05-19');
  check('single digits are padded',            parseDate('1/6/2026', 'dmy'), '2026-06-01');
  check('an ISO date is left alone',           parseDate('2026-06-11T00:00:00', 'dmy'), '2026-06-11');
}

/** Ibtekar's statement, in the shape their export arrives in. */
const HEADERS = ['Date', 'File No', 'Doc No', 'Ticket', 'PNR', 'Issue Date',
                 'Passenger', 'Sector', 'Debit', 'Credit', 'Balance', 'Status'];
const row = (o: Partial<Record<string, string>>) => HEADERS.map(h => o[h] ?? '');

console.log('\n2. A receipt lands on the day Ibtekar received it');
{
  const grid = [HEADERS,
    row({ Date: '01/06/2026', 'File No': 'TOPUP', Ticket: 'RV261566', Credit: '15000' }),
    row({ Date: '11/06/2026', 'File No': 'TOPUP', Ticket: 'RV261687', Credit: '20000' }),
    row({ Date: '19/05/2026', 'File No': 'TOPUP', Ticket: 'RV261419', Credit: '20000' }),
  ];
  const { rows } = runParser(grid, 'Ibtekar', 'SAR', 'Ibtekar');
  check('three receipts',   rows.length, 3);
  check('all are top-ups',  rows.every(r => r.status === 'FUND'), true);
  check('RV261566 on 1 June',   rows[0].date, '2026-06-01');
  check('RV261687 on 11 June',  rows[1].date, '2026-06-11');
  check('RV261419 on 19 May',   rows[2].date, '2026-05-19');
  check('nothing lands in the future',
        rows.every(r => r.date <= '2026-12-31'), true);
  check('and the money is unchanged',
        rows.map(r => r.amount), [15000, 20000, 20000]);
}

console.log('\n3. A ticket lands on the day it was issued');
{
  const grid = [HEADERS,
    row({ Date: '13/06/2026', 'File No': 'KSAML2004', 'Doc No': 'INV261903',
          Ticket: '065 - 6906344403', PNR: '9ISWZF', 'Issue Date': '11/06/2026',
          Passenger: 'ALQAHTANY/MUATH', Sector: 'RUH/MED/RUH', Debit: '1975',
          Credit: '0', Status: 'Not Closed' }),
    row({ Date: '08/08/2026', 'File No': 'KSAML2400', 'Doc No': 'INV263097',
          Ticket: '593 - 4861234273', 'Issue Date': '08/08/2026',
          Passenger: 'ALSHEHRI/SAHAR', Debit: '783', Credit: '0' }),
  ];
  const { rows } = runParser(grid, 'Ibtekar', 'SAR', 'Ibtekar');
  check('two tickets', rows.length, 2);
  check('issued the 11th of June, not the 6th of November', rows[0].date, '2026-06-11');
  check('the 8th either way round',                         rows[1].date, '2026-08-08');
  check('the document number is kept', rows[0].vendorReference || rows[0].reqNum, 'KSAML2004');
  check('and the money',               rows.map(r => r.amount), [1975, 783]);
}

console.log('\n4. Tickets and receipts in one file agree with each other');
{
  // The defect was that these two disagreed inside a single parse.
  const grid = [HEADERS,
    row({ Date: '11/06/2026', 'File No': 'KSAML2004', 'Doc No': 'INV261903',
          Ticket: '065 - 6906344403', 'Issue Date': '11/06/2026', Debit: '1975' }),
    row({ Date: '11/06/2026', 'File No': 'TOPUP', Ticket: 'RV261687', Credit: '20000' }),
  ];
  const { rows } = runParser(grid, 'Ibtekar', 'SAR', 'Ibtekar');
  check('the same day on the ticket and on the receipt',
        [...new Set(rows.map(r => r.date))], ['2026-06-11']);
}

console.log('\n5. An Excel serial and a blank still behave');
{
  const grid = [HEADERS,
    row({ Date: '46184', 'File No': 'TOPUP', Ticket: 'RV999999', Credit: '1000' }),
    row({ Date: '', 'File No': 'TOPUP', Ticket: 'RV999998', Credit: '2000' }),
  ];
  const { rows } = runParser(grid, 'Ibtekar', 'SAR', 'Ibtekar');
  check('a serial is converted, not read as a day',
        rows[0].date, new Date((46184 - 25569) * 86400000).toISOString().slice(0, 10));
  check('a blank stays blank rather than becoming today', rows[1].date, '');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
