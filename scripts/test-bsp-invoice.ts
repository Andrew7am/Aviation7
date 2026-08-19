/**
 * Verification for the BSP invoice import (PDF) and its money handling.
 *
 * Mirrors the project's existing verify-* script convention: a runnable tsx
 * script that asserts and reports, rather than adding a test framework the
 * repo does not currently use.
 *
 * Transactions are built with the column-aware fixture, because the parser
 * reads every value from the column it physically sits under — a fixture of
 * bare text lines would not exercise the real path at all.
 *
 * Run: npx tsx scripts/test-bsp-invoice.ts [path-to-invoice.pdf]
 */
import { readFileSync, existsSync } from 'fs';
import Papa from 'papaparse';
import { runParser } from '../src/core/parsers';
import { extractPdfRows, pdfRowsToCsv } from '../src/core/helpers/pdfText';
import { invoiceGrid, txn } from './helpers/bspFixture';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005
    : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
}

const parse = (body: Parameters<typeof invoiceGrid>[0]) =>
  runParser(invoiceGrid(body), undefined, 'AED', 'invoice.pdf');

console.log('CASE 1 — fare 4,080.00, commission 156.80, payable 3,923.20');
{
  const r = parse(['*** ISSUES', txn({
    air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV',
    txn: 4080.00, fare: 2240.00, cobl: 2240.00,
    stdRate: 7.00, stdAmt: 156.80, suppRate: 0, suppAmt: 0, taxOnComm: 0, payable: 3923.20,
  })]);
  const t = r.rows[0];
  check('parser detected', r.parserName, 'IATA BSP Invoice (PDF)');
  check('fare (totalDoc)', t?.totalDoc, 4080.00);
  check('commission', t?.commission, 156.80);
  check('balance payable (amount)', t?.amount, 3923.20);
  check('status', t?.status, 'ISSUE');
  check('date from invoice', t?.date, '2026-08-09');
  check('source/channel', t?.source, 'IATA BSP');
  check('currency', t?.currency, 'AED');
}

console.log('\nCASE 2 — fare 9,710.00, commission 167.20, payable 9,542.80');
{
  const t = parse(['*** ISSUES', txn({
    air: '235', trnc: 'TKTT', doc: '5513059038', date: '12AUG26', cpui: 'FFVV',
    txn: 9710.00, fare: 8360.00, taxes: { tax: 10.00, fc: 110.00 }, cobl: 8360.00,
    stdRate: 2.00, stdAmt: 167.20, suppAmt: 0, payable: 9542.80,
  })]).rows[0];
  check('fare', t?.totalDoc, 9710.00);
  check('commission', t?.commission, 167.20);
  check('payable', t?.amount, 9542.80);
}

console.log('\nCASE 3 — refund: fare -10,410.00, commission -196.20, payable -10,213.80');
{
  const t = parse(['*** REFUNDS', txn({
    air: '235', trnc: 'RFND', doc: '5513059004', date: '09AUG26',
    txn: -10410.00, fare: -9810.00, taxes: { tax: -1040.00, fc: 740.00 }, cobl: -9810.00,
    stdRate: 2.00, stdAmt: -196.20, suppAmt: 0, payable: -10213.80,
  })]).rows[0];
  check('status', t?.status, 'REFUND');
  check('payable stays negative', t?.amount, -10213.80);
  check('fare magnitude', t?.totalDoc, 10410.00);
  check('commission sign preserved', t?.commission, -196.20);
  check('fare - commission = payable', (-10410.00) - (-196.20), t?.amount);
}

console.log('\nCASE 4 — no commission: payable equals fare');
{
  const t = parse(['*** ISSUES', txn({
    trnc: 'TKTT', doc: '5513059027', date: '09AUG26', cpui: 'FFVV',
    txn: 6830.00, fare: 5170.00, taxes: { tax: 680.00 }, cobl: 5170.00,
    stdRate: 0, stdAmt: 0, suppRate: 0, suppAmt: 0, payable: 6830.00,
  })]).rows[0];
  check('commission', t?.commission, 0);
  check('payable == fare', t?.amount, 6830.00);
}

console.log('\nCASE 5 — cents preserved, never rounded to whole units');
{
  const t = parse(['*** ISSUES', txn({
    air: '077', trnc: 'TKTT', doc: '5513059029', date: '09AUG26', cpui: 'FFVV',
    txn: 1710.00, fare: 570.00, cobl: 570.00,
    stdRate: 7.00, stdAmt: 39.90, suppAmt: 0, payable: 1670.10,
  })]).rows[0];
  check('commission keeps cents', t?.commission, 39.90);
  check('payable keeps cents', t?.amount, 1670.10);
  check('commission is not an integer', Number.isInteger(t?.commission ?? 0), false);
}

console.log('\nCASE 6 — WEBSALES-EDIS keeps its own channel');
{
  const r = parse([
    '*** ISSUES',
    txn({ trnc: 'TKTT', doc: '5513059027', date: '09AUG26', txn: 6830.00, fare: 5170.00, cobl: 5170.00, stdAmt: 0, suppAmt: 0, payable: 6830.00 }),
    // The invoice's real channel marker — a bare mention of the name is
    // deliberately NOT enough (see CASE 9).
    'CATEGORY WEBSALES-EDIS',
    txn({ air: '254', trnc: 'TKTT', doc: '2540225913', date: '12AUG26', txn: 4150.80, fare: 4150.80, cobl: 4150.80, stdAmt: 0, suppAmt: 0, payable: 4150.80 }),
  ]);
  const bsp = r.rows.find(t => t.ticketNo === '5513059027');
  const web = r.rows.find(t => t.ticketNo === '2540225913');
  check('BSP row vendor', bsp?.source, 'IATA BSP');
  check('BSP row channel', bsp?.channel, 'BSP');
  check('web row vendor is still IATA', web?.source, 'IATA BSP');
  check('web row channel', web?.channel, 'WEBSALES-EDIS');
  check('warns about separate settlement', r.warnings.some(w => /WEBSALES-EDIS/.test(w)), true);
}

console.log('\nCASE 7 — VOID carries no value');
{
  const t = parse(['*** ISSUES', txn({
    trnc: 'CANX', doc: '5513059030', date: '10AUG26', cpui: 'VVVV',
    txn: 0, fare: 0, stdAmt: 0, suppAmt: 0, payable: 0,
  })]).rows[0];
  check('status', t?.status, 'VOID');
  check('amount', t?.amount, 0);
}

console.log('\nCASE 8 — an implausible line is reported, not imported');
{
  // A commission larger than the fare it is a cut of cannot be right — the
  // number must have been picked up from the wrong column.
  const r = parse(['*** ISSUES', txn({
    air: '077', trnc: 'TKTT', doc: '9999999999', date: '09AUG26',
    txn: 100.00, fare: 50.00, stdAmt: 5000.00, suppAmt: 0, payable: -4900.00,
  })]);
  check('row rejected', r.rows.length, 0);
  check('error raised', r.errors.some(e => /misread/i.test(e)), true);
}

console.log('\nCASE 9 — page-1 summary must not switch the channel');
{
  // The summary block names WEBSALES-EDIS long before any transaction. If that
  // flips the channel, every BSP ticket is mislabelled and hits the wrong wallet.
  const r = parse([
    '91,535.08 68,632.08 7,015.00 12,783.00 3,105.00 68,632.08 506.90 -29.00 0.00 91,057.18',
    'BSP TOTAL',
    '35,390.00 28,420.00 1,590.00 4,820.00 560.00 28,420.00 0.00 853.50 0.00 34,536.50',
    'WEBSALES-EDIS TOTAL',
    '*** ISSUES',
    txn({ air: '077', trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV', txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdRate: 7.00, stdAmt: 156.80, suppAmt: 0, payable: 3923.20 }),
    'CATEGORY WEBSALES-EDIS',
    '*** ISSUES',
    txn({ air: '235', trnc: 'TKTT', doc: '2540225913', date: '12AUG26', cpui: 'FFFF', txn: 4230.00, fare: 2640.00, cobl: 2640.00, stdRate: 3.00, stdAmt: 79.20, suppAmt: 0, payable: 4150.80 }),
  ]);
  check('BSP ticket stayed BSP', r.rows.find(t => t.ticketNo === '5513059026')?.channel, 'BSP');
  check('web ticket is WEBSALES-EDIS', r.rows.find(t => t.ticketNo === '2540225913')?.channel, 'WEBSALES-EDIS');
}

// ── Against the real invoice, when available ────────────────────────────────
const pdfPath = process.argv[2]
  ?? 'C:/Users/andre/AppData/Local/Temp/claude/C--Users-andre-Downloads-aviation-v2-full-aviation-v2/7afbf2a6-6146-4119-b309-e7247479d463/scratchpad/iata/260802__AE_FCAGBILLDET_8621913_20260802.PDF';
console.log(`\nREAL INVOICE — ${pdfPath}`);
if (!existsSync(pdfPath)) {
  console.log('  SKIPPED (file not present)');
  done();
} else {
  const buf = readFileSync(pdfPath);
  // extractPdfRows uses DecompressionStream, available in Node 18+ as well.
  extractPdfRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    .then(rows => {
      const grid = Papa.parse(pdfRowsToCsv(rows), { skipEmptyLines: true }).data as string[][];
      const r = runParser(grid, undefined, 'AED', 'invoice.pdf');
      check('detected as BSP invoice', r.parserName, 'IATA BSP Invoice (PDF)');
      check('no parse errors', r.errors.length, 0);
      const bsp = r.rows.filter(t => t.channel === 'BSP');
      const web = r.rows.filter(t => t.channel === 'WEBSALES-EDIS');
      console.log(`  parsed ${r.rows.length} transactions — ${bsp.length} BSP, ${web.length} WEBSALES-EDIS`);
      // The invoice's formula is "Transaction Amount CA FOP (or 0) - commission",
      // so it reduces to fare - commission = payable only where the sale
      // settled in cash. A card sale pays nothing through BSP.
      const settled = r.rows.filter(t => t.status !== 'VOID' && t.amount !== 0);
      const reconciles = settled.every(t =>
        Math.abs((t.amount < 0 ? -(t.totalDoc ?? 0) : (t.totalDoc ?? 0)) - (t.commission ?? 0) - t.amount) < 0.011);
      check('every settled row satisfies fare - commission = payable', reconciles, true);
      check('all dates populated', r.rows.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date)), true);
      const webTotal = web.reduce((s, t) => s + t.amount, 0);
      console.log(`  WEBSALES-EDIS payable total: ${webTotal.toFixed(2)} (invoice states 34,536.50)`);
      check('WEBSALES-EDIS total matches the invoice', Math.round(webTotal * 100) / 100, 34536.50);
      done();
    })
    .catch(e => { fail++; console.log('  FAIL  real invoice:', e.message); done(); });
}

function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
