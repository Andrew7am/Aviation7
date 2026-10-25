/**
 * flydubai's TA Transaction Report: one line a booking, read as the
 * booking's PNR - not as the older export, which read Y4TG8S with no PNR,
 * no name and no date.
 */
import { runParser } from '../src/core/parsers';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const H = ['CONFIRMATION_NUM', 'MASTER PNR', 'PARENT PNR', 'BOOKING_AGENT', 'IATA_NUM', 'USER_ID', 'TRANSACTION_DATE', 'FIRST_NAME', 'LAST_NAME',
  'TOTALSEGMENTS', 'TOTALPASSENGERS', 'INVOICE_NUM', 'CURRENCY', 'DEPOSITS', 'BOOKEDAMOUNT', 'CANCELLEDAMOUNT', 'COMMENTS', 'REMARKS'];
const row = (pnr: string, date: string, dep: string, booked: string, cancelled: string) =>
  [pnr, '', '', '96008338jana', '96008338', '96008338jana', date, 'GHADA', 'REFAEI', '4', '2', '114701875', 'AED', dep, booked, cancelled, 'A8357124', ''];

console.log('\n1. A booking');
{
  const r = runParser([H, row('Y4TG8S', '10/22/2026   2:27:45PM', '0.000', '3920.000', '0.000')], 'FlyDubai', 'AED', 'FlyDubai');
  check('read by the TA report parser', [r.parserName, r.confidence], ['FlyDubai', 95]);
  const t: any = r.rows[0];
  check('the PNR is the document', [t.ticketNo, t.pnr], ['Y4TG8S', 'Y4TG8S']);
  check('lead passenger, date month first, the invoice kept', [t.passengerName, t.date, t.vendorReference], ['GHADA REFAEI', '2026-10-22', '114701875']);
  check('a sale of 3,920.00 AED', [t.status, t.amount, t.currency], ['ISSUE', 3920, 'AED']);
  check('one booking for two passengers is said', r.warnings.some(w => /2 passengers/.test(w)), true);
}

console.log('\n2. A cancellation and a deposit');
{
  const r = runParser([H, row('Y4TG8S', '10/23/2026  9:00:00AM', '0.000', '0.000', '1960.000'), row('', '10/23/2026  9:05:00AM', '5000.000', '0.000', '0.000')], 'FlyDubai', 'AED', 'FlyDubai');
  check('what was given back is a refund', r.rows.filter((x: any) => x.status === 'REFUND').map((x: any) => [x.ticketNo, x.amount]), [['Y4TG8S', -1960]]);
  check('a deposit is a top-up', r.rows.filter((x: any) => x.status === 'FUND').map((x: any) => x.amount), [5000]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
