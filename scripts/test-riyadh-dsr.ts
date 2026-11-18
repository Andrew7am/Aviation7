/**
 * Riyadh Air's DSR as downloaded since Nov 2026: a "DSR Report" title row,
 * a header row, then the data. Copied and pasted, the title and header come
 * along, and "Record Locator" + "Transaction Date" read as an RTS report -
 * so the paste imported nothing.
 *
 *   npx tsx scripts/test-riyadh-dsr.ts
 */
import { parseGrid } from '../src/core/helpers/parseGrid';
import { runParser, smartDetect } from '../src/core/parsers';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const HEADER = ['User Name', 'Booking Sign-In', 'Ticketing Sign-in', 'Agency Name', 'Document No', 'TKT Doc- Airline Code',
  'TKT Doc- Number ', 'TKT Doc- Padding Digit', 'Inconnection Doc number', 'Coupon number', 'Document Type', 'Product',
  'TXN_Sequence', 'TXN_Type', 'Airline PNR', 'Verteil PNR', ' Child/Parent PNR', 'Airline', 'Airline IATA Code',
  'Record Locator', 'Technology Provider Code', 'Payment Status', 'TTL (Due Time Limit in GMT)', 'Transaction Date',
  'Transaction Time', 'Date Of Issue (YYYY-MM-DD)', 'Time Of Issue', 'Class Of Booking', 'FareBasis', 'Flight No',
  'Sectors', 'Coupon Status', 'Departure Date', 'Departure Time (HH:MM)', 'Arrival Date', 'Arrival Time(HH:MM)',
  'Passenger Name', 'Passenger Type', 'Conjunction Ticket No', 'Tour Code', 'Deal Code', 'IATA No', 'Value Store',
  'Utilised Value Store', 'Basic Fare', 'Total Tax', 'Total Fare', 'Form Of Payment', 'Payment Amount', 'PenalityAmount',
  'Payment Surcharge', 'PNR Level Surcharge', 'Amount Retained At PNR Level', 'Fare Surcharge', 'PNR level Fare Surcharge',
  'Amount held', 'PNR level payment', 'Currency', 'Forex Rate', 'Forex Currency', 'Exchange Rate ID', 'Markup Rule ID',
  'Mark Up', 'Fee Rule ID', 'Fee', 'Discount Rule ID', 'Discount', 'Commission Rule ID', 'Commission',
  'PNR Level Commission', 'Service Fee', 'Application Fop', 'Payment Reference Id', 'Cabin Code', 'Cabin Name',
  'Airline OrderID', 'IO Tax', 'K7 Tax'];
const at = (name: string) => HEADER.indexOf(name);
const row = (v: Record<string, string>) => HEADER.map(h => v[h] ?? ' ');
const hold = { 'TXN_Type': 'UNPAID_BOOKING', 'Airline PNR': 'ABC123', 'Airline': 'RX', 'Payment Status': 'UNPAID',
  'Transaction Date': '17-Nov-2026', 'Sectors': 'ELQ-JED', 'Passenger Name': 'TEST/PASSENGER', 'Total Fare': '510.00',
  'Currency': 'AED', 'Airline OrderID': 'RX1223HOLD001' };
const ROWS = [
  row(hold),
  row({ ...hold, 'TXN_Type': 'UNPAID_CANCEL', 'Payment Status': 'CANCELLED' }),
  row({ ...hold, 'Document No': '1222100270410', 'TXN_Type': 'PAID_BOOKING', 'Airline PNR': 'XYZ789', 'Payment Status': 'PAID',
    'Passenger Name': 'PASSENGER/TEST', 'Form Of Payment': 'CA', 'Airline OrderID': 'RX1223PAID001' }),
];
const paste = (rows: string[][]) => [['DSR Report'], HEADER, ...rows].map(r => r.join('\t')).join('\n');

console.log('\nA. A pasted DSR, title and header included');
{
  const grid = parseGrid(paste(ROWS)).rows;
  check('is read as Riyadh Air, not RTS', smartDetect(grid).parser?.name, 'Riyadh Air');
  const r = runParser(grid, undefined, 'SAR');
  check('no errors', r.errors, []);
  check('the paid ticket comes in at its total, in AED',
        r.rows.map(x => [x.ticketNo, x.status, x.amount, x.currency, x.route, x.date]),
        [['1222100270410', 'ISSUE', 510, 'AED', 'ELQ-JED', '2026-11-17']]);
  check('the hold cancelled unpaid is left out, and said', r.warnings.some(w => /1 hold\(s\) cancelled unpaid/.test(w)), true);
  check('...not also called on hold', r.warnings.some(w => /on hold, not ticketed/.test(w)), false);
}

console.log('\nB. The downloaded file (its range starts at the data)');
{
  const grid = parseGrid(ROWS.map(r => r.join(',')).join('\n')).rows;
  const r = runParser(grid, undefined, 'SAR');
  check('is still read as Riyadh Air', r.parserName, 'Riyadh Air');
  check('with the same ticket', r.rows.map(x => [x.ticketNo, x.amount]), [['1222100270410', 510]]);
}

console.log('\nC. A Req column added to the pasted sheet');
{
  const withReq = (r: string[], v: string) => [...r.slice(0, at('Airline OrderID') + 1), v, ...r.slice(at('Airline OrderID') + 1)];
  const H = withReq(HEADER, 'Req Num');
  const grid = parseGrid([['DSR Report'], H, ...ROWS.map((r, i) => withReq(r, i === 2 ? 'KSAML2533' : ''))]
    .map(r => r.join('\t')).join('\n')).rows;
  const r = runParser(grid, undefined, 'SAR');
  check('the request is read by its header', r.rows.map(x => [x.ticketNo, x.reqNum]), [['1222100270410', 'KSAML2533']]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
