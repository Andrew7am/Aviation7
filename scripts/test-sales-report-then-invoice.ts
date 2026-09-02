/**
 * The agency's actual BSP workflow, pinned as a test.
 *
 * The daily sales report (TJQ) and the weekly invoice both arrive under the
 * vendor 'IATA BSP'. They are the same sales reported twice: the report says
 * what ran, the invoice says what it settled for, what the commission was and
 * which day it was issued. One document must end up as ONE row carrying the
 * invoice's figures — not two rows counting the money twice, which is what was
 * happening until the settlement rule learned to see this pair.
 *
 * Run: npx tsx scripts/test-sales-report-then-invoice.ts
 */
import { detectDuplicatesAgainstExisting } from '../src/core/ImportEngine';
import type { Ticket } from '../src/types';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

const t = (o: Partial<Ticket>): Ticket => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  ticketNo: '5513059052', source: 'IATA BSP', date: '2026-08-16',
  amount: 2810, commission: 0, totalDoc: 2810, reqNum: '', status: 'ISSUE',
  userId: 'u', ...o,
});

/** What the sales report produces: a serial, a PNR, no commission, no channel,
 *  and a date that came from the report's own range. */
const fromSalesReport = (o: Partial<Ticket> = {}) =>
  t({ serial: 6004, pnr: 'ZRWT9Z', reqNum: 'KSAML2025', commission: 0, ...o });

/** What the invoice produces: the money and the commission, a channel, the
 *  exact issue date, and no serial or PNR of its own. */
const fromInvoice = (o: Partial<Ticket> = {}) =>
  t({ channel: 'BSP', commission: 180, ...o });

console.log('\n1. The invoice settles the row the sales report already made');
{
  const existing = [fromSalesReport({ id: 'sales-1', date: '2026-08-14' })];
  const r = detectDuplicatesAgainstExisting([fromInvoice({ date: '2026-08-16' })], existing);
  check('no new row is created', r.fresh.length, 0);
  check('it settles the existing row', r.settlements.length, 1);
  check('settles onto the sales row id', r.settlements[0]?.id, 'sales-1');
  check("takes the invoice's commission", r.settlements[0]?.commission, 180);
  check("takes the invoice's exact date", r.settlements[0]?.date, '2026-08-16');
  check('keeps the serial only the report had', r.settlements[0]?.serial, 6004);
  check('keeps the PNR only the report had', r.settlements[0]?.pnr, 'ZRWT9Z');
  check('records the settlement channel', r.settlements[0]?.channel, 'BSP');
}

console.log('\n2. A refund settles against a refund, never against the sale');
{
  // Same document number, both directions — the ordinary case for a refunded
  // ticket, and the one that must never be collapsed into a single row.
  const existing = [
    fromSalesReport({ id: 'sale', amount: 2810, status: 'ISSUE' }),
    fromSalesReport({ id: 'credit', amount: -940, status: 'REFUND', serial: 6062 }),
  ];
  const r = detectDuplicatesAgainstExisting(
    [fromInvoice({ amount: -940, status: 'REFUND' })], existing);
  check('one settlement', r.settlements.length, 1);
  check('it lands on the refund, not the sale', r.settlements[0]?.id, 'credit');
  check('the sale is untouched', r.fresh.length, 0);
}

console.log('\n3. Re-importing the same invoice does not settle twice');
{
  // After the first import the row carries the channel, so the rule that
  // recognises "invoice meeting a sales-report row" must no longer fire.
  const settled = fromSalesReport({
    id: 'settled', channel: 'BSP', commission: 180, date: '2026-08-16',
  });
  const r = detectDuplicatesAgainstExisting([fromInvoice({ date: '2026-08-16' })], [settled]);
  check('no second settlement', r.settlements.length, 0);
  check('no new row', r.fresh.length, 0);
  check('treated as a duplicate', r.duplicates.length, 1);
}

console.log('\n4. Re-importing the same sales report does not settle anything');
{
  const existing = [fromSalesReport({ id: 'sales-1' })];
  const r = detectDuplicatesAgainstExisting([fromSalesReport()], existing);
  check('no settlement', r.settlements.length, 0);
  check('no new row', r.fresh.length, 0);
}

console.log('\n5. A document the report never saw still arrives as a new row');
{
  const existing = [fromSalesReport({ id: 'other', ticketNo: '5513059999' })];
  const r = detectDuplicatesAgainstExisting([fromInvoice()], existing);
  check('the invoice-only document is added', r.fresh.length, 1);
  check('nothing is settled', r.settlements.length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
