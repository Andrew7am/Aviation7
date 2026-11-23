/**
 * Riyadh Air's DSR as downloaded since Nov 2026: a "DSR Report" title row,
 * a header row, then the data. Copied and pasted, the title and header come
 * along, and "Record Locator" + "Transaction Date" read as an RTS report -
 * so the paste imported nothing.
 *
 *   npx tsx scripts/test-riyadh-dsr.ts
 */
import { parseGrid } from '../src/core/helpers/parseGrid';
import type { Ticket } from '../src/types';
import { invoiceDifferences } from '../src/core/helpers/portalVsInvoice';
import { detectDuplicatesAgainstExisting } from '../src/core/ImportEngine';
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
        [['2100270410', 'ISSUE', 510, 'AED', 'ELQ-JED', '2026-11-17']]);
  check('its airline kept apart from the number', r.rows.map(x => x.airlineCode), ['122']);
  check('the hold cancelled unpaid is left out, and said', r.warnings.some(w => /1 hold\(s\) cancelled unpaid/.test(w)), true);
  check('...not also called on hold', r.warnings.some(w => /on hold, not ticketed/.test(w)), false);
}

console.log('\nB. The downloaded file (its range starts at the data)');
{
  const grid = parseGrid(ROWS.map(r => r.join(',')).join('\n')).rows;
  const r = runParser(grid, undefined, 'SAR');
  check('is still read as Riyadh Air', r.parserName, 'Riyadh Air');
  check('with the same ticket', r.rows.map(x => [x.ticketNo, x.amount]), [['2100270410', 510]]);
}

console.log('\nC. A Req column added to the pasted sheet');
{
  const withReq = (r: string[], v: string) => [...r.slice(0, at('Airline OrderID') + 1), v, ...r.slice(at('Airline OrderID') + 1)];
  const H = withReq(HEADER, 'Req Num');
  const grid = parseGrid([['DSR Report'], H, ...ROWS.map((r, i) => withReq(r, i === 2 ? 'KSAML2533' : ''))]
    .map(r => r.join('\t')).join('\n')).rows;
  const r = runParser(grid, undefined, 'SAR');
  check('the request is read by its header', r.rows.map(x => [x.ticketNo, x.reqNum]), [['2100270410', 'KSAML2533']]);
}

console.log('\nD. Seats given back, a reissue and a bag (the 23 Aug 2026 report)');
{
  const doc = (no: string, v: Record<string, string>) => row({ 'Document No': no, 'Airline': 'RX', 'Payment Status': 'PAID', 'Currency': 'AED',
    'Transaction Date': '23-Aug-2026', 'Date Of Issue (YYYY-MM-DD)': '26-Jul-2026', 'Airline PNR': 'RX1223TEST01', 'Airline OrderID': 'RX1223TEST01',
    'Sectors': 'LHR-RUH', 'Passenger Name': 'TEST/PASSENGER', 'IATA No': '86219136', 'Form Of Payment': 'CA', ...v });
  const seat = (no: string, v: Record<string, string> = {}) => doc(no, { 'TXN_Type': 'DELETE_SEAT', 'Coupon Status': 'REFUND', ...v });
  const credit = () => row({ 'TXN_Type': 'DELETE_SEAT', 'Airline': 'RX', 'Payment Status': 'PAID', 'Airline PNR': 'RX1223TEST01', 'Transaction Date': '23-Aug-2026',
    'Coupon Status': 'REFUND', 'Total Fare': '-420.00', 'Payment Amount': '-420.00', 'Currency': 'AED' });
  const D = [
    doc('1222100060907', { 'TXN_Type': 'TICKETING', 'Coupon Status': 'OPEN/OPEN', 'Total Fare': '6,670.00', 'Payment Amount': '6,670.00' }),
    doc('1224200006309', { 'TXN_Type': 'PAID_SEAT', 'Coupon Status': 'OPEN', 'Total Fare': '420.00', 'Payment Amount': '420.00' }),
    seat('1224200006308', { 'Total Fare': '0.00', 'Payment Amount': '0.00' }),
    seat('1224200006309', { 'Total Fare': '420.00', 'Payment Amount': '420.00' }),
    ...Array.from({ length: 6 }, credit),
    doc('1222100106141', { 'TXN_Type': 'REISSUE', 'Coupon Status': 'OPEN', 'Total Fare': '8,600.00', 'Payment Amount': '1,810.00', 'Date Of Issue (YYYY-MM-DD)': '23-Aug-2026' }),
    doc('1222100106143', { 'TXN_Type': 'REISSUE', 'Coupon Status': 'OPEN', 'Total Fare': '7,120.00', 'Payment Amount': '950.00', 'Discount': '450.0', 'Date Of Issue (YYYY-MM-DD)': '23-Aug-2026' }),
    doc('1224200008691', { 'TXN_Type': 'PAID_ANCILLARY', 'Total Fare': '2,130.00', 'Payment Amount': '2,130.00', 'Date Of Issue (YYYY-MM-DD)': '08-Aug-2026' }),
    doc('1224200009999', { 'TXN_Type': 'SOME_NEW_THING', 'Total Fare': '5.00', 'Payment Amount': '5.00' }),
  ];
  const want = [['2100060907', 'ISSUE', 6670, '2026-07-26'], ['4200006309', 'EMDS', 420, '2026-07-26'], ['4200006309', 'REFUND', -420, '2026-08-23'],
    ['2100106141', 'ISSUE', 1810, '2026-08-23'], ['2100106143', 'ISSUE', 950, '2026-08-23'], ['4200008691', 'EMDS', 2130, '2026-08-08']];
  for (const [name, text] of [['with its header', paste(D)],
    ['without it', D.map(r => r.map(v => v.includes(',') ? `"${v}"` : v).join(',')).join('\n')]] as const) {
    const r = runParser(parseGrid(text).rows, undefined, 'SAR');
    check(`${name}: every document once, at what was paid`, r.rows.map(x => [x.ticketNo, x.status, x.amount, x.date]), want);
    check(`${name}: no errors`, r.errors, []);
    check(`${name}: the seat refunded at 0.00 is said, not recorded`, r.warnings.some(w => /^4200006308 .*refunds 0\.00/.test(w)), true);
    check(`${name}: the repeated credits are left out, and said`, r.warnings.some(w => /^6 refund line/.test(w)), true);
    check(`${name}: an unknown transaction is said`, r.warnings.some(w => /SOME_NEW_THING.*4200009999/.test(w)), true);
    check(`${name}: the refund names its seat`, r.rows.filter(x => x.status === 'REFUND').map(x => x.relatedTicket), ['4200006309']);
  }
}

console.log('\nE. Against what the IATA invoice already put in');
{
  const tk = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36), ticketNo: '', pnr: '', passengerName: '', airlineCode: '122', route: '', source: 'IATA BSP',
    date: '2026-08-23', amount: 0, totalDoc: 0, commission: 0, reqNum: 'UAEVP575', vendorReference: '', status: 'ISSUE', currency: 'AED', isDuplicate: false, closed: true, userId: '', channel: 'BSP', ...o } as Ticket);
  const held = [tk({ ticketNo: '2100106141', amount: 1810, totalDoc: 1810 }), tk({ ticketNo: '2100106143', amount: 1400, totalDoc: 1400 }),
    tk({ ticketNo: '4200006309', amount: -420, totalDoc: 420, status: 'REFUND', date: '2026-07-26' })];
  const dsr = (o: Partial<Ticket>) => tk({ source: 'Riyadh Air', channel: undefined, reqNum: '', closed: false, ...o });
  const incoming = [dsr({ ticketNo: '2100106141', amount: 1810, totalDoc: 1810 }), dsr({ ticketNo: '2100106143', amount: 950, totalDoc: 950 }),
    dsr({ ticketNo: '4200006309', amount: -420, totalDoc: 420, status: 'REFUND' }), dsr({ ticketNo: '4200008691', amount: 2130, totalDoc: 2130, status: 'EMDS' })];
  const d = detectDuplicatesAgainstExisting(incoming, held);
  check('only what IATA never billed is new', d.fresh.map(t => t.ticketNo), ['4200008691']);
  check('nothing of the invoice is overwritten', [d.updates.length, d.settlements.length], [0, 0]);
  check('the one at another price is said', invoiceDifferences(incoming, held).map(x => [x.ticketNo, x.reported, x.invoiced, x.apart]), [['2100106143', 950, 1400, 450]]);
  check('a refund is not held against a sale', invoiceDifferences([dsr({ ticketNo: '2100106141', amount: -50, status: 'REFUND' })], held), []);
  check('another airline\'s serial is another document', invoiceDifferences([dsr({ ticketNo: '2100106143', amount: 950, airlineCode: '065' })], held), []);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
