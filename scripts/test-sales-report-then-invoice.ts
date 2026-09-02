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

console.log('\n6. A refund the ledger never saw arrives with the invoice');
{
  // Refund Applications do not appear on the daily sales report — the agency
  // only learns of them when BSP bills them. The ledger has the sale and
  // nothing else, so the credit must be ADDED, not matched to the sale.
  const existing = [fromSalesReport({ id: 'sale', amount: 2810, status: 'ISSUE' })];
  const r = detectDuplicatesAgainstExisting(
    [fromInvoice({ amount: -940, status: 'REFUND', commission: 0 })], existing);
  check('the refund is added as its own row', r.fresh.length, 1);
  check('it is not settled onto the sale', r.settlements.length, 0);
  check('it is not discarded as a duplicate', r.duplicates.length, 0);
  check('it keeps its credit sign', r.fresh[0]?.amount, -940);
}

console.log('\n7. A debit memo (ADM) the ledger never saw');
{
  const existing = [fromSalesReport({ id: 'sale' })];
  const r = detectDuplicatesAgainstExisting(
    [fromInvoice({ ticketNo: '6000088327', amount: 22.08, status: 'ADM', commission: 0 })],
    existing);
  check('the memo is added', r.fresh.length, 1);
  check('nothing is settled', r.settlements.length, 0);
  check('it keeps its status', r.fresh[0]?.status, 'ADM');
}

console.log('\n8. A Turkish ticket the invoice later settles');
{
  // Issued on the portal, uploaded from Turkish\'s own report, then billed by
  // BSP. One sale: the invoice supersedes the money but the ticket stays a
  // Turkish sale.
  const existing = [t({
    id: 'tk', source: 'Turkish Airlines', date: '2026-08-14',
    amount: 2900, commission: 0, route: 'RUH-IST', passengerName: 'A PASSENGER',
  })];
  const r = detectDuplicatesAgainstExisting(
    [fromInvoice({ amount: 2810, commission: 180, date: '2026-08-16' })], existing);
  check('no second row for the same sale', r.fresh.length, 0);
  check('the Turkish row is settled', r.settlements.length, 1);
  check('the vendor stays Turkish Airlines', r.settlements[0]?.source, 'Turkish Airlines');
  check("takes the invoice's payable", r.settlements[0]?.amount, 2810);
  check("takes the invoice's commission", r.settlements[0]?.commission, 180);
  check("takes the invoice's date", r.settlements[0]?.date, '2026-08-16');
  check('keeps the route the portal gave', r.settlements[0]?.route, 'RUH-IST');
}

console.log('\n9. A Riyadh Air ticket the invoice later settles');
{
  const existing = [t({ id: 'rx', source: 'Riyadh Air', date: '2026-08-14', commission: 0 })];
  const r = detectDuplicatesAgainstExisting(
    [fromInvoice({ commission: 95, date: '2026-08-16' })], existing);
  check('settled, not duplicated', r.settlements.length, 1);
  check('vendor stays Riyadh Air', r.settlements[0]?.source, 'Riyadh Air');
  check('date updated', r.settlements[0]?.date, '2026-08-16');
}

console.log('\n10. A sales-report row the invoice does not mention is left alone');
{
  const untouched = fromSalesReport({ id: 'later', ticketNo: '5513059900', date: '2026-08-20' });
  const existing = [fromSalesReport({ id: 'billed' }), untouched];
  const r = detectDuplicatesAgainstExisting([fromInvoice()], existing);
  check('only the billed document is settled', r.settlements.length, 1);
  check('and it is the billed one', r.settlements[0]?.id, 'billed');
  check('the unbilled row is not in any result',
    [...r.fresh, ...r.settlements, ...r.updates, ...r.duplicates].some(x => x.id === 'later'), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
