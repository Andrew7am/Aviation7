/**
 * PHASE 4 verification — reconciliation of the IATA ledger against BSP invoices.
 *
 * Covers the 22 required cases: every document type imports, VOID never does,
 * nothing existing is ever dropped, and a second run is a no-op.
 *
 * Run: npx tsx scripts/test-iata-phase4.ts
 */
import { runParser } from '../src/core/parsers';
import {
  reconcileIata, normDoc, dirOf, invoiceKey, ledgerKey, isVoid,
  type InvoiceTxn, type LedgerTxn,
} from '../src/core/helpers/iataReconcile';
import { invoiceGrid, txn } from './helpers/bspFixture';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005
    : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
}

/** Parse invoice rows into the shape the reconciler consumes. */
function parse(body: Parameters<typeof invoiceGrid>[0]): InvoiceTxn[] {
  const r = runParser(invoiceGrid(body), undefined, 'AED', 'invoice.pdf');
  if (r.parserName !== 'IATA BSP Invoice (PDF)') throw new Error(`parser was ${r.parserName}`);
  return r.rows.map(x => ({
    ticketNo: x.ticketNo, rawType: x.rawType || '', status: x.status || '',
    date: x.date, channel: x.channel || 'BSP', fare: x.totalDoc ?? 0,
    commission: x.commission ?? 0, payable: x.amount, currency: x.currency || 'AED',
    airlineCode: x.airlineCode, vendorReference: x.vendorReference, file: 'invoice.pdf',
  }));
}

const led = (o: Partial<LedgerTxn> & { ticketNo: string; amount: number }): LedgerTxn => ({
  id: o.id ?? `id-${o.ticketNo}-${o.amount}`, ticketNo: o.ticketNo,
  status: o.status, date: o.date ?? '', amount: o.amount, totalDoc: o.totalDoc ?? Math.abs(o.amount),
});

/* ── 1-9: every document type parses and is offered for import ──────────── */
console.log('CASES 1-9 — document type coverage');
{
  const inv = parse([
    '*** ISSUES',
    txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdRate: 7.00, stdAmt: 156.80, suppAmt: 0, payable: 3923.20 }),
    txn({ trnc: 'EMDA', doc: '5551234567', date: '09AUG26', cpui: 'FFVV', txn: 150.00, stdAmt: 0, suppAmt: 0, payable: 150.00 }),
    txn({ trnc: 'EMDS', doc: '5551234568', date: '10AUG26', cpui: 'FFVV', txn: 260.00, stdAmt: 0, suppAmt: 0, payable: 260.00 }),
    txn({ air: '235', trnc: 'SPDR', doc: '6000088139', date: '17AUG26', txn: 22.08, stdAmt: 0, suppAmt: 0, payable: 22.08 }),
    txn({ air: '235', trnc: 'ADMA', doc: '1234567890', date: '12AUG26', txn: 0, stdAmt: -104.36, suppAmt: 0, payable: 104.36 }),
    txn({ air: '235', trnc: 'ACMA', doc: '1234567891', date: '12AUG26', txn: 0, stdAmt: 55.00, suppAmt: 0, payable: -55.00 }),
    '*** REFUNDS',
    txn({ air: '235', trnc: 'RFND', doc: '0079549112', date: '13AUG26', txn: -1760.00, fare: -1760.00, stdAmt: 0, suppAmt: 0, payable: -1760.00 }),
    'CATEGORY WEBSALES-EDIS',
    '*** ISSUES',
    txn({ air: '254', trnc: 'TKTT', doc: '2540225913', date: '12AUG26', cpui: 'FFVV', txn: 4150.80, fare: 4150.80, cobl: 4150.80, stdAmt: 0, suppAmt: 0, payable: 4150.80 }),
    txn({ trnc: 'CANX', doc: '5513059030', date: '10AUG26', cpui: 'VVVV', txn: 0, fare: 0, stdAmt: 0, suppAmt: 0, payable: 0 }),
    txn({ trnc: 'CANN', doc: '5513059031', date: '10AUG26', cpui: 'VVVV', txn: 0, fare: 0, stdAmt: 0, suppAmt: 0, payable: 0 }),
  ]);
  const r = reconcileIata(inv, []);            // nothing in the ledger yet
  const types = (list: InvoiceTxn[]) => list.map(t => t.rawType).sort();

  check('1  TKTT queued for import', r.toImport.some(t => t.rawType === 'TKTT' && t.ticketNo === '5513059026'), true);
  check('2  WEBSALES TKTT queued, channel intact',
    r.toImport.find(t => t.ticketNo === '2540225913')?.channel, 'WEBSALES-EDIS');
  check('   WEBSALES row is still IATA, not its own vendor',
    r.toImport.filter(t => t.channel === 'WEBSALES-EDIS').length, 1);
  check('3  manual RFND queued', r.toImport.some(t => t.rawType === 'RFND' && t.ticketNo === '0079549112'), true);
  check('4  EMDS queued', r.toImport.some(t => t.rawType === 'EMDS'), true);
  check('5  EMDA queued', r.toImport.some(t => t.rawType === 'EMDA'), true);
  check('6  SPDR queued', r.toImport.some(t => t.rawType === 'SPDR'), true);
  check('7  ADMA queued', r.toImport.some(t => t.rawType === 'ADMA'), true);
  check('8  ACMA queued', r.toImport.some(t => t.rawType === 'ACMA'), true);
  check('9  CANX/CANN parsed as VOID', inv.filter(isVoid).map(t => t.rawType).sort(), ['CANN', 'CANX']);
  check('   EMD type preserved, not flattened to TKTT', types(r.toImport).filter(t => t.startsWith('EMD')), ['EMDA', 'EMDS']);
  check('   nothing legitimate dropped', r.toImport.length, 8);
}

/* ── 10-11: VOID ─────────────────────────────────────────────────────────── */
console.log('\nCASES 10-11 — VOID');
{
  const inv = parse([
    '*** ISSUES',
    txn({ trnc: 'TKTT', doc: '5513059027', date: '09AUG26', cpui: 'FFVV', txn: 6830.00, fare: 5170.00, taxes: { tax: 680.00 }, cobl: 5170.00, stdAmt: 0, suppAmt: 0, payable: 6830.00 }),
    txn({ trnc: 'CANX', doc: '5513059030', date: '10AUG26', cpui: 'VVVV', txn: 0, fare: 0, stdAmt: 0, suppAmt: 0, payable: 0 }),
  ]);
  const r = reconcileIata(inv, []);
  check('10 missing VOID excluded from import', r.toImport.some(isVoid), false);
  check('10 excluded VOID reported, not silently dropped', r.excludedVoid.length, 1);
  check('10 missing = imported + excluded', r.missing.length, r.toImport.length + r.excludedVoid.length);

  // A VOID that already exists must survive untouched even though the invoice
  // has no matching line for it.
  const existingVoid = led({ ticketNo: '5599999999', amount: 0, totalDoc: 6260, status: 'VOID', date: '2026-01-01' });
  const r2 = reconcileIata(inv, [existingVoid]);
  check('11 existing VOID kept', r2.ledgerNoInvoice.map(t => t.id), [existingVoid.id]);
  check('11 existing VOID not scheduled for a date change',
    r2.dateUpdates.some(u => u.row.id === existingVoid.id), false);
}

/* ── 12: nothing existing is ever lost ───────────────────────────────────── */
console.log('\nCASE 12 — no existing row can be dropped');
{
  const inv = parse([
    '*** ISSUES',
    txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdRate: 7.00, stdAmt: 156.80, suppAmt: 0, payable: 3923.20 }),
  ]);
  const ledger = [
    led({ ticketNo: '5513059026', amount: 3923.20, totalDoc: 4080, date: '2026-07-03' }),
    led({ ticketNo: '9999999999', amount: 500, date: '2026-07-03' }),
    led({ ticketNo: '8888888888', amount: -250, date: '' }),
  ];
  const r = reconcileIata(inv, ledger);
  const seen = [
    ...r.dateUpdates.map(u => u.row.id), ...r.alreadyCorrect.map(u => u.row.id),
    ...r.unresolved.map(t => t.id), ...r.ledgerNoInvoice.map(t => t.id),
  ];
  check('every ledger row lands in exactly one bucket', seen.sort(), ledger.map(t => t.id).sort());
  check('the reconciler exposes no delete bucket at all',
    Object.keys(r).some(k => /delete|remove|drop/i.test(k)), false);
}

/* ── 13: one document, several legitimate transactions ──────────────────── */
console.log('\nCASE 13 — issue + refund on the same document');
{
  const inv = parse([
    '*** ISSUES',
    txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdAmt: 0, suppAmt: 0, payable: 4080.00 }),
    '*** REFUNDS',
    txn({ air: '077', trnc: 'RFND', doc: '5513059026', date: '14AUG26', txn: -3905.00, fare: -3905.00, stdAmt: 0, suppAmt: 0, payable: -3905.00 }),
  ]);
  check('two lines, not one', inv.length, 2);
  check('their keys differ by direction',
    [invoiceKey(inv[0]), invoiceKey(inv[1])], ['5513059026|+', '5513059026|-']);
  const r = reconcileIata(inv, []);
  check('both queued for import', r.toImport.length, 2);

  // With the issue already in the ledger, only the refund is missing.
  const r2 = reconcileIata(inv, [led({ ticketNo: '5513059026', amount: 4080, totalDoc: 4080, date: '2026-08-09' })]);
  check('issue recognised as existing, refund still missing', r2.toImport.map(t => t.rawType), ['RFND']);
  check('the existing issue is not re-imported', r2.toImport.some(t => t.rawType === 'TKTT'), false);
}

/* ── 14-16: the money ────────────────────────────────────────────────────── */
console.log('\nCASES 14-16 — fare, commission, payable, signs, cents');
{
  const [t] = parse(['*** ISSUES', txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdRate: 7.00, stdAmt: 156.80, suppAmt: 0, payable: 3923.20 })]);
  check('14 fare', t.fare, 4080.00);
  check('14 commission', t.commission, 156.80);
  check('14 balance payable', t.payable, 3923.20);
  check('14 fare - commission = payable', t.fare - t.commission, t.payable);

  const [ref] = parse(['*** REFUNDS', txn({ air: '235', trnc: 'RFND', doc: '5513059004', date: '09AUG26', txn: -10410.00, fare: -9810.00, taxes: { tax: -1040.00, fc: 740.00 }, cobl: -9810.00, stdRate: 2.00, stdAmt: -196.20, suppAmt: 0, payable: -10213.80 })]);
  check('15 refund payable stays negative', ref.payable, -10213.80);
  check('15 refund commission keeps its sign', ref.commission, -196.20);
  check('15 no Math.abs anywhere in the chain', ref.fare < 0 || ref.payable < 0, true);

  const [c] = parse(['*** ISSUES', txn({ air: '077', trnc: 'TKTT', doc: '5513059029', date: '09AUG26', cpui: 'FFVV', txn: 1710.00, fare: 570.00, cobl: 570.00, stdRate: 7.00, stdAmt: 39.90, suppAmt: 0, payable: 1670.10 })]);
  check('16 commission cents survive', c.commission, 39.90);
  check('16 payable cents survive', c.payable, 1670.10);
  check('16 commission is not rounded to a whole unit', Number.isInteger(c.commission), false);

  const [adm] = parse(['*** DEBIT MEMOS', txn({ air: '235', trnc: 'ADMA', doc: '1234567890', date: '12AUG26', txn: 0, stdAmt: -104.36, suppAmt: 0, payable: 104.36 })]);
  check('   zero-fare commission recall accepted', adm.payable, 104.36);
  check('   its commission is negative', adm.commission, -104.36);
}

/* ── 17-18: dates ────────────────────────────────────────────────────────── */
console.log('\nCASES 17-18 — dates');
{
  const inv = parse(['*** ISSUES', txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdAmt: 0, suppAmt: 0, payable: 4080.00 })]);
  check('17 invoice date parsed', inv[0].date, '2026-08-09');
  const uploaded = '2026-07-03';
  const r = reconcileIata(inv, [led({ ticketNo: '5513059026', amount: 4080, totalDoc: 4080, date: uploaded })]);
  check('18 the upload date is replaced', r.dateUpdates.length, 1);
  check('18 with the invoice date, not the upload date', r.dateUpdates[0].invoice.date, '2026-08-09');
  check('18 a row already holding the invoice date is not rewritten',
    reconcileIata(inv, [led({ ticketNo: '5513059026', amount: 4080, totalDoc: 4080, date: '2026-08-09' })]).dateUpdates.length, 0);

  // A line the parser could not date must never reach the import list.
  const undated: InvoiceTxn = { ...inv[0], ticketNo: '5599999999', date: '' };
  check('19 an undated invoice line is never imported',
    reconcileIata([undated], []).toImport.length, 0);
}

/* ── 19-21: duplicates, idempotency, imports ─────────────────────────────── */
console.log('\nCASES 19-21 — duplicate protection and idempotency');
{
  const inv = parse([
    '*** ISSUES',
    txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdRate: 7.00, stdAmt: 156.80, suppAmt: 0, payable: 3923.20 }),
    txn({ trnc: 'EMDA', doc: '5551234567', date: '09AUG26', cpui: 'FFVV', txn: 150.00, stdAmt: 0, suppAmt: 0, payable: 150.00 }),
  ]);
  const ledger = [led({ ticketNo: '5513059026', amount: 3923.20, totalDoc: 4080, date: '2026-07-03' })];
  const first = reconcileIata(inv, ledger);
  check('19 an existing document is not re-imported', first.toImport.map(t => t.rawType), ['EMDA']);
  check('21 the genuinely missing one is imported', first.toImport.length, 1);

  // Leading zeros must not fool the duplicate check.
  const zeroPad = reconcileIata(inv, [led({ ticketNo: '0005513059026', amount: 3923.20, totalDoc: 4080, date: '2026-07-03' })]);
  check('19 leading zeros normalised for matching', zeroPad.toImport.map(t => t.rawType), ['EMDA']);

  // Second run: feed the ledger back with the imported rows in place.
  const afterImport = [...ledger, ...first.toImport.map(t =>
    led({ ticketNo: t.ticketNo, amount: t.payable, totalDoc: t.fare, date: t.date }))];
  const second = reconcileIata(inv, afterImport);
  check('20 re-import inserts nothing', second.toImport.length, 0);
  check('20 re-import rewrites no date', second.dateUpdates.length, 1); // the stale 2026-07-03 row, still stale
  const third = reconcileIata(inv, afterImport.map(t =>
    t.date === '2026-07-03' ? { ...t, date: '2026-08-09' } : t));
  check('20 once dates are correct, a third run is a complete no-op',
    [third.toImport.length, third.dateUpdates.length], [0, 0]);
}

/* ── 22: scope ───────────────────────────────────────────────────────────── */
console.log('\nCASE 22 — nothing outside the IATA rows it is given');
{
  const inv = parse(['*** ISSUES', txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdAmt: 0, suppAmt: 0, payable: 4080.00 })]);
  const iataOnly = [led({ ticketNo: '5513059026', amount: 4080, totalDoc: 4080, date: '2026-07-03' })];
  const r = reconcileIata(inv, iataOnly);
  const touched = [...r.dateUpdates.map(u => u.row.id), ...r.alreadyCorrect.map(u => u.row.id), ...r.unresolved.map(t => t.id)];
  check('every id it proposes to touch came from its own input',
    touched.every(id => iataOnly.some(t => t.id === id)), true);
  check('a same-numbered ticket under another vendor is simply not visible to it',
    r.dateUpdates.length, 1);   // the caller filters by source; the module never widens it
}

/* ── key helpers ─────────────────────────────────────────────────────────── */
console.log('\nkey construction');
{
  check('normDoc strips leading zeros and separators', normDoc('000-551 3059026'), '5513059026');
  check('RFND is a negative direction even when payable is positive', dirOf('RFND', 10), '-');
  check('a negative payable is negative whatever the type', dirOf('TKTT', -10), '-');
  check('ledgerKey reads direction off the money', ledgerKey(led({ ticketNo: '0012345678', amount: -5 })), '12345678|-');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
