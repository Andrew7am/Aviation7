/**
 * Whether a supplier has vouched for a row.
 *
 *   npx tsx scripts/test-supplier-proof.ts
 *
 * 7,025.00 on 5513408117 went into the books from their sheet as an RTS
 * refund, and RTS's own report never carried it. A row from their sheet or
 * typed by hand is unconfirmed until a report of that supplier carries the
 * same document at the same amount.
 */
import { unconfirmed, confirmationsFrom, fromSheetOrHand, correctionsFrom, awaitsSupplier } from '../src/core/helpers/supplierProof';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const t = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36).slice(2), ticketNo: '5513408117', pnr: '', passengerName: '',
  airlineCode: '016', route: '', source: 'RTS', date: '2026-09-17', amount: -7025, totalDoc: 7025, commission: 0, reqNum: 'UAEVP711',
  vendorReference: '', status: 'REFUND', currency: 'AED', isDuplicate: false, closed: false, userId: 'u',
  reportName: 'Team sheet — reviewed', ...o } as Ticket);

console.log('\n1. What waits for a supplier');
check('an RTS refund from their sheet', unconfirmed(t({})), true);
check('typed by hand', unconfirmed(t({ reportName: 'Manual entry' })), true);
check('read from RTS\'s report', unconfirmed(t({ reportName: 'RTS' })), false);
check('a website purchase never waits', unconfirmed(t({ source: 'Airline Website', amount: 1460 })), false);
check('a reissue at 0 moves nothing', unconfirmed(t({ amount: 0, totalDoc: 0 })), false);
check('once confirmed', unconfirmed(t({ confirmedBy: 'RTS sales report' })), false);
check('where it came from is still said', fromSheetOrHand(t({ confirmedBy: 'RTS sales report' })), true);

console.log('\n2. A supplier report confirms, or disagrees');
{
  const ours = [t({ id: 'a' }), t({ id: 'b', ticketNo: '5513303522', amount: 320, totalDoc: 320, status: 'ISSUE' })];
  const report = [
    t({ id: '', reportName: 'RTS', amount: -7025 }),
    t({ id: '', reportName: 'RTS', ticketNo: '5513303522', amount: 5700, totalDoc: 5700, status: 'ISSUE' }),
  ];
  const r = confirmationsFrom(report, ours, 'RTS sales report');
  check('the same refund at the same amount confirms it', r.confirm.map(c => [c.id, c.by]), [['a', 'RTS sales report']]);
  check('a different amount is said, not confirmed', r.differ.map(d => [d.ours.ticketNo, d.report.amount]), [['5513303522', 5700]]);
  const sale = confirmationsFrom([t({ id: '', reportName: 'RTS', amount: 7050, totalDoc: 7050, status: 'ISSUE' })], [t({ id: 'a' })], 'RTS');
  check('a sale never vouches for a refund', [sale.confirm.length, sale.differ.length], [0, 0]);
  const dollars = confirmationsFrom([t({ id: '', reportName: 'X', amount: 1323.4, totalDoc: 1323.4, status: 'ISSUE' })],
    [t({ id: 'c', amount: 4856.88, totalDoc: 4856.88, status: 'ISSUE', originalAmount: 1323.4, originalCurrency: 'USD' })], 'X');
  check('a dollar row is compared in dollars', dollars.confirm.length, 1);
}

console.log('\n3. The supplier\'s figure goes in');
{
  // 5512878161: recorded at 0.00 as a reissue at no charge from their sheet; RTS sells it at 650.00.
  const ours = [t({ id: 'z', ticketNo: '5512878161', amount: 0, totalDoc: 0, status: 'ISSUE', transactionType: 'REISSUE', reqNum: 'UAEVP420' })];
  const report = [t({ id: '', reportName: 'RTS', ticketNo: '5512878161', amount: 650, totalDoc: 650, status: 'ISSUE' })];
  const p = confirmationsFrom(report, ours, 'RTS sales report');
  check('a row at 0.00 is still checked against the report', p.differ.length, 1);
  const fix = correctionsFrom(p.differ, 'RTS sales report');
  check('and corrected to 650.00', fix.correct.map(c => [c.ticketNo, c.was.amount, c.amount]), [['5512878161', 0, 650]]);
  // AL SAUD: 20,140.00 SAR from their sheet, 20.00 AED on RTS - a question, not a copy.
  const saud = confirmationsFrom(
    [t({ id: '', reportName: 'RTS', ticketNo: '5512845081', amount: 20, totalDoc: 20, status: 'ISSUE', currency: 'AED' })],
    [t({ id: 's', ticketNo: '5512845081', amount: 20140, totalDoc: 20140, status: 'ISSUE', currency: 'SAR' })], 'RTS');
  const f2 = correctionsFrom(saud.differ, 'RTS');
  check('another currency is asked, not copied', [f2.correct.length, f2.ask.length], [0, 1]);
  // Another supplier's report: its row goes in on its own; ours is not touched.
  const other = confirmationsFrom(
    [t({ id: '', reportName: 'BSP', source: 'IATA BSP', amount: 5700, totalDoc: 5700, status: 'ISSUE', ticketNo: '5513303522' })],
    [t({ id: 'o', source: 'RTS', amount: 320, totalDoc: 320, status: 'ISSUE', ticketNo: '5513303522' })], 'BSP');
  check('another supplier\'s figure is asked, not copied', correctionsFrom(other.differ, 'BSP').correct.length, 0);
  check('a website purchase never waits for a report', awaitsSupplier(t({ source: 'Airline Website', amount: 0 })), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
