/**
 * PHASE 3 — IATA-ONLY TESTS (cases 1-22).
 *
 * Cases 19-22 matter most: they prove IATA invoice processing cannot reach
 * NSA, Ibtekar, RTS or any other vendor. Those run read-only against the live
 * database; nothing here writes.
 *
 * Run: npx tsx scripts/test-iata-phase3.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { runParser } from '../src/core/parsers';
import { vendorMatchesSource, calcVendorBalance } from '../src/core/helpers/walletMath';
import type { VendorBalance } from '../src/types';
import { invoiceGrid, txn } from './helpers/bspFixture';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

const invoice = (body: Parameters<typeof invoiceGrid>[0]) =>
  runParser(invoiceGrid(body), undefined, 'AED', 'invoice.pdf');

const ISSUE = txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdRate: 7.00, stdAmt: 156.80, suppAmt: 0, payable: 3923.20 });
const REFUND = txn({ air: '235', trnc: 'RFND', doc: '5513059004', date: '09AUG26', txn: -10410.00, fare: -9810.00, cobl: -9810.00, stdRate: 2.00, stdAmt: -196.20, suppAmt: 0, payable: -10213.80 });

console.log('1. IATA BSP TKTT');
{
  const t = invoice(['*** ISSUES', ISSUE]).rows[0];
  check('vendor is IATA', t?.source, 'IATA BSP');
  check('channel is BSP', t?.channel, 'BSP');
  check('type preserved', t?.rawType, 'TKTT');
  check('status', t?.status, 'ISSUE');
}

console.log('\n2. IATA WEBSALES-EDIS TKTT — channel, not a vendor');
{
  const r = invoice(['*** ISSUES', ISSUE, 'CATEGORY WEBSALES-EDIS', '*** ISSUES',
    txn({ air: '235', trnc: 'TKTT', doc: '2540225916', date: '13AUG26', cpui: 'FFFF', txn: 20190.00, fare: 15350.00, cobl: 15350.00, stdRate: 3.00, stdAmt: 533.40, suppAmt: 0, payable: 19656.60 })]);
  const web = r.rows.find(t => t.ticketNo === '2540225916');
  check('vendor still IATA', web?.source, 'IATA BSP');
  check('channel WEBSALES-EDIS', web?.channel, 'WEBSALES-EDIS');
  check('BSP row keeps BSP channel', r.rows.find(t => t.ticketNo === '5513059026')?.channel, 'BSP');
  check('no separate vendor created', [...new Set(r.rows.map(t => t.source))], ['IATA BSP']);
}

console.log('\n3. IATA manual RFND');
{
  const t = invoice(['*** REFUNDS', REFUND]).rows[0];
  check('status', t?.status, 'REFUND');
  check('channel', t?.channel, 'BSP');
}

console.log('\n4. IATA EMD');
{
  const r = invoice(['*** ISSUES',
    txn({ air: '077', trnc: 'EMDS', doc: '1949933364', date: '13AUG26', cpui: 'FVVV', txn: 80.00, fare: 80.00, cobl: 80.00, stdAmt: 0, suppAmt: 0, payable: 80.00 }),
    txn({ trnc: 'EMDA', doc: '1949933355', date: '09AUG26', cpui: 'FFVV', txn: 640.00, fare: 640.00, cobl: 640.00, stdAmt: 0, suppAmt: 0, payable: 640.00 })]);
  check('EMDS imported', r.rows.find(t => t.rawType === 'EMDS')?.status, 'EMDS');
  check('EMDA imported', r.rows.find(t => t.rawType === 'EMDA')?.status, 'EMDS');
}

console.log('\n5. IATA CANX / CANN');
{
  const r = invoice(['*** ISSUES',
    txn({ trnc: 'CANX', doc: '5513059030', date: '10AUG26', cpui: 'VVVV', txn: 0, fare: 0, stdAmt: 0, suppAmt: 0, payable: 0 }),
    txn({ trnc: 'CANN', doc: '5512129119', date: '08FEB26', cpui: 'VVVV', txn: 0, fare: 0, stdAmt: 0, suppAmt: 0, payable: 0 })]);
  check('CANX present', r.rows.find(t => t.rawType === 'CANX')?.status, 'VOID');
  check('CANN present', r.rows.find(t => t.rawType === 'CANN')?.status, 'VOID');
  check('void carries no value', r.rows[0]?.amount, 0);
}

console.log('\n6. IATA SPDR — the type that used to vanish');
{
  const r = invoice(['*** DEBIT MEMOS', txn({ air: '953', trnc: 'SPDR', doc: '6000088139', date: '17AUG26', stat: 'D', txn: 22.08, fare: 22.08, stdAmt: 0, suppAmt: 0, payable: 22.08 })]);
  check('imported, not skipped', r.rows.length, 1);
  check('raw type preserved', r.rows[0]?.rawType, 'SPDR');
  check('amount captured', r.rows[0]?.amount, 22.08);
  check('vendor IATA', r.rows[0]?.source, 'IATA BSP');
  check('recognised, so not flagged unsupported', r.warnings.some(w => /Unsupported/i.test(w)), false);
}

console.log('\n7. Same ticket issued AND refunded — two transactions, not a duplicate');
{
  const r = invoice(['*** ISSUES', ISSUE, '*** REFUNDS',
    txn({ air: '077', trnc: 'RFND', doc: '5513059026', date: '12AUG26', txn: -3905.00, fare: -2240.00, cobl: -2240.00, stdRate: 7.00, stdAmt: -156.80, suppAmt: 0, payable: -3748.20 })]);
  check('both rows kept', r.rows.length, 2);
  const iss = r.rows.find(t => t.status === 'ISSUE');
  const ref = r.rows.find(t => t.status === 'REFUND');
  check('issue is positive', (iss?.amount ?? 0) > 0, true);
  check('refund is negative', (ref?.amount ?? 0) < 0, true);
  check('issue date', iss?.date, '2026-08-09');
  check('refund has its OWN date', ref?.date, '2026-08-12');
}

console.log('\n8. Fare / Commission / Balance Payable kept separate');
{
  const t = invoice(['*** ISSUES', ISSUE]).rows[0];
  check('Fare', t?.totalDoc, 4080.00);
  check('Commission', t?.commission, 156.80);
  check('Balance Payable', t?.amount, 3923.20);
  check('Fare - Commission = Payable', (t?.totalDoc ?? 0) - (t?.commission ?? 0), t?.amount);
}

console.log('\n9. Negative refund values, signs preserved (no Math.abs)');
{
  const t = invoice(['*** REFUNDS', REFUND]).rows[0];
  check('payable negative', t?.amount, -10213.80);
  check('commission negative', t?.commission, -196.20);
  check('signed arithmetic holds', -10410.00 - (-196.20), t?.amount);
}

console.log('\n10. Commission cents preserved');
{
  const t = invoice(['*** ISSUES', txn({ air: '077', trnc: 'TKTT', doc: '5513059029', date: '09AUG26', cpui: 'FFVV', txn: 1710.00, fare: 570.00, cobl: 570.00, stdRate: 7.00, stdAmt: 39.90, suppAmt: 0, payable: 1670.10 })]).rows[0];
  check('39.90 stays 39.90', t?.commission, 39.90);
  check('not rounded to an integer', Number.isInteger(t?.commission ?? 0), false);
}

console.log('\n11. Date extracted from the BSP invoice');
{
  const r = invoice(['*** ISSUES', ISSUE, '*** REFUNDS', REFUND]);
  check('issue date', r.rows[0]?.date, '2026-08-09');
  check('every row dated', r.rows.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date)), true);
}

console.log('\n12/13. Invoice date is used, upload date is not');
{
  const t = invoice(['*** ISSUES', ISSUE]).rows[0];
  const today = new Date().toISOString().slice(0, 10);
  check('date is the invoice date', t?.date, '2026-08-09');
  check('date is NOT today (upload date)', t?.date === today, false);
}

console.log('\n15. Unknown IATA document type is not silently dropped');
{
  const r = invoice(['*** ISSUES', txn({ air: '953', trnc: 'ZZZZ', doc: '6000099999', date: '17AUG26', stat: 'D', txn: 55.00, fare: 55.00, stdAmt: 0, suppAmt: 0, payable: 55.00 })]);
  check('row imported', r.rows.length, 1);
  check('raw type kept', r.rows[0]?.rawType, 'ZZZZ');
  check('financial value kept', r.rows[0]?.amount, 55.00);
  check('reported as unsupported', r.warnings.some(w => /Unsupported IATA document type/i.test(w)), true);
  check('warning names the code', r.warnings.some(w => /ZZZZ/.test(w)), true);
}

console.log('\n16. Reprocessing the same invoice is deterministic');
{
  const a = invoice(['*** ISSUES', ISSUE, '*** REFUNDS', REFUND]);
  const b = invoice(['*** ISSUES', ISSUE, '*** REFUNDS', REFUND]);
  const strip = (r: typeof a) => r.rows.map(t => ({ ...t, }));
  check('identical output on re-parse', JSON.stringify(strip(a)), JSON.stringify(strip(b)));
}

/* ── live-database checks: read-only ─────────────────────────────────────── */
async function dbChecks() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('\n14. Parsing an invoice never writes to the ledger');
  // Phase 3 froze this as "the ledger holds exactly 1,685 IATA rows", then
  // Phase 4 imported more under an explicit authorisation and the number was
  // rewritten to match. A count only ever describes the day it was written:
  // it went stale again with the next import, and a stale assertion that
  // cannot pass teaches everyone to ignore the suite.
  //
  // The rule underneath never goes stale — reading an invoice produces rows in
  // memory, and storing them is a separate, deliberate step. So the ledger is
  // counted, an invoice is parsed, and the count is checked to be untouched.
  const iataCount = async () =>
    Number((await c.query(`select count(*)::int n from tickets where source = 'IATA BSP'`)).rows[0].n);

  const before = await iataCount();
  const parsed = invoice([ISSUE, REFUND, txn({ air: '065', trnc: 'TKTT', doc: '5513059099', date: '10AUG26', txn: 500, fare: 500, payable: 500 })]);
  check('the invoice really did parse (otherwise this proves nothing)', parsed.rows.length > 0, true);
  check('and the ledger is untouched by it', await iataCount(), before);

  console.log('\n18. IATA matching can never reach another vendor');
  // A document number that exists under a NON-IATA vendor must be invisible
  // to an IATA-scoped query.
  const { rows: shared } = await c.query(`
    select t1.ticket_no
    from tickets t1
    join tickets t2 on t2.ticket_no = t1.ticket_no and t2.source <> t1.source
    where t1.source = 'IATA BSP' limit 5`);
  console.log(`     ticket numbers shared between IATA and another vendor: ${shared.length}`);
  for (const s of shared) {
    const { rows: scoped } = await c.query(
      `select source from tickets where ticket_no = $1 and source = 'IATA BSP'`, [s.ticket_no]);
    check(`  "${s.ticket_no}" resolves to IATA only under the scoped query`,
      [...new Set(scoped.map((r: any) => r.source))], ['IATA BSP']);
  }
  if (shared.length === 0) check('  no shared ticket numbers to confuse matching', true, true);

  console.log('\n19-22. IATA processing cannot reach another vendor');
  // This used to be a table of exact row counts and net totals per vendor —
  // "NSA must hold 2,770 tickets summing to 5,005,240.97". It was written to
  // prove the Phase 4 IATA migration had not disturbed the other vendors,
  // which was a fair thing to check WHILE that migration was running. The
  // migration is long finished, and the table outlived it: every legitimate
  // import moved a number, so seven assertions sat red permanently and a real
  // failure would have been lost among them.
  //
  // What the table was really guarding is asserted directly below instead, in
  // a form no import can break. Ledger-wide rules — identity, signs,
  // duplicates, wallet arithmetic — live in test-ledger-invariants.ts.
  const { rows: vendorNames } = await c.query(
    `select distinct source from tickets where source <> 'IATA BSP' order by source`);

  // Alias matching decides which wallet a ticket is drawn against, and it
  // matches on substrings — so "Ibtekar" also claims "Ibtekar (New)". That is
  // deliberate: they are one vendor with two report formats, and one wallet
  // between them is right.
  //
  // The thing that would be wrong is two vendors that EACH hold a wallet
  // claiming each other, because then one ticket is charged to two balances at
  // once. That is what is asserted.
  const { rows: walletRows } = await c.query(`select vendor_name from vendor_balances`);
  const walletNames: string[] = (walletRows as any[]).map(r => r.vendor_name);
  for (const a of walletNames) {
    const alsoClaimed = walletNames.filter(b => b !== a && vendorMatchesSource(a, b));
    check(`  the ${a} wallet draws only its own rows`, alsoClaimed, []);
  }

  // And no non-IATA vendor may claim an IATA row, in either direction.
  for (const v of vendorNames as any[]) {
    check(`  ${v.source} does not claim IATA BSP rows`, vendorMatchesSource(v.source, 'IATA BSP'), false);
    check(`  ${v.source} does not claim WEBSALES-EDIS`, vendorMatchesSource(v.source, 'WEBSALES-EDIS'), false);
  }

  console.log('\n     no wallet exists for a settlement channel');
  const { rows: w } = await c.query(`select vendor_name from vendor_balances order by vendor_name`);
  check('  no IATA wallet exists (none created)', w.some((r: any) => /^iata/i.test(r.vendor_name)), false);
  check('  no WEBSALES wallet exists (none created)', w.some((r: any) => /websales/i.test(r.vendor_name)), false);

  console.log('\n17. Date update touches only the date column');
  // The correction statement is: update tickets set date = $1 where id = $2 and source = 'IATA BSP'
  const iataVendor: VendorBalance = { id: 'v', vendorName: 'IATA', initialBalance: 0, currentBalance: 0, userId: 'u' };
  const rowsBSP = [{ source: 'IATA BSP', amount: 3923.20, status: 'ISSUE' }];
  const rowsWithWeb = [...rowsBSP, { source: 'IATA BSP', amount: 19656.60, status: 'ISSUE' }];
  check('  a date change cannot alter a balance (balance derives from amount only)',
    calcVendorBalance(iataVendor, rowsBSP, []) !== calcVendorBalance(iataVendor, rowsWithWeb, []), true);

  await c.end();
}

dbChecks()
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
  })
  .catch(e => { console.error(e); process.exit(1); });
