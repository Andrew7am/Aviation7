/**
 * Verification for the BSP invoice import (PDF) and its commission maths.
 *
 * Mirrors the project's existing verify-* script convention: a runnable tsx
 * script that asserts and reports, rather than adding a test framework the
 * repo does not currently use.
 *
 * Run: npx tsx scripts/test-bsp-invoice.ts [path-to-invoice.pdf]
 */
import { readFileSync, existsSync } from 'fs';
import Papa from 'papaparse';
import { runParser } from '../src/core/parsers';
import { extractPdfRows } from '../src/core/helpers/pdfText';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005
    : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
}

/** Build a synthetic invoice so the money cases are testable without a PDF. */
function invoiceLines(body: string[]): string[][] {
  return [
    ['FCAGBILLDET AGENT BILLING DETAILS 86-2 1913 6 LUXURY EVENTS AND VIP TRAVEL FZC'],
    ['Billing Period: 260802(09-AUG-2026 to 15-AUG-2026) REFERENCE: 86219136 - 260802'],
    ['GRAND TOTAL (AED) 126,925.08 97,052.08 8,605.00 17,603.00 3,665.00'],
    ...body.map(l => [l]),
  ];
}

const parse = (body: string[]) => runParser(invoiceLines(body), undefined, 'AED', 'invoice.pdf');

console.log('CASE 1 — fare 4,080.00, commission 156.80, payable 3,923.20');
{
  const r = parse(['*** ISSUES', '077 TKTT 5513059026 09AUG26 FFVV I 4,080.00 2,240.00 2,240.00 7.00 156.80 0.00 0.00 3,923.20']);
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
  const t = parse(['*** ISSUES', '235 TKTT 5513059038 12AUG26 FFVV NR:5B I CA 9,710.00 8,360.00 10.00 E3 110.00 YQ 8,360.00 0.00 0.00 2.00 167.20 0.00 9,542.80']).rows[0];
  check('fare', t?.totalDoc, 9710.00);
  check('commission', t?.commission, 167.20);
  check('payable', t?.amount, 9542.80);
}

console.log('\nCASE 3 — refund: fare -10,410.00, commission 196.20, payable -10,213.80');
{
  const t = parse(['*** REFUNDS', '235 RFND 5513059004 09AUG26 NR:5B I -10,410.00 -9,810.00 -1,040.00 YR 740.00 CP -9,810.00 0.00 0.00 2.00 -196.20 0.00 -10,213.80']).rows[0];
  check('status', t?.status, 'REFUND');
  check('payable stays negative', t?.amount, -10213.80);
  check('fare magnitude', t?.totalDoc, 10410.00);
  check('commission sign preserved', t?.commission, -196.20);
  check('fare - commission = payable', (-10410.00) - (-196.20), t?.amount);
}

console.log('\nCASE 4 — no commission: payable equals fare');
{
  const t = parse(['*** ISSUES', '065 TKTT 5513059027 09AUG26 FFVV I 6,830.00 5,170.00 680.00 YR 5,170.00 0.00 0.00 0.00 0.00 6,830.00']).rows[0];
  check('commission', t?.commission, 0);
  check('payable == fare', t?.amount, 6830.00);
}

console.log('\nCASE 5 — cents preserved, never rounded to whole units');
{
  const t = parse(['*** ISSUES', '077 TKTT 5513059029 09AUG26 FFVV I 1,710.00 570.00 570.00 7.00 39.90 0.00 0.00 1,670.10']).rows[0];
  check('commission keeps cents', t?.commission, 39.90);
  check('payable keeps cents', t?.amount, 1670.10);
  check('commission is not an integer', Number.isInteger(t?.commission ?? 0), false);
}

console.log('\nCASE 6 — WEBSALES-EDIS keeps its own channel');
{
  const r = parse([
    '*** ISSUES',
    '065 TKTT 5513059027 09AUG26 FFVV I 6,830.00 5,170.00 5,170.00 0.00 0.00 0.00 0.00 6,830.00',
    // The invoice's real channel marker — a bare mention of the name is
    // deliberately NOT enough (see CASE 9).
    'CATEGORY WEBSALES-EDIS',
    '254 TKTT 2540225913 12AUG26 FFVV I 4,150.80 4,150.80 4,150.80 0.00 0.00 0.00 0.00 4,150.80',
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
  const t = parse(['*** ISSUES', '065 CANX 5513059030 10AUG26 VVVV I 0.00 0.00 0.00 0.00 0.00 0.00']).rows[0];
  check('status', t?.status, 'VOID');
  check('amount', t?.amount, 0);
}

console.log('\nCASE 8 — an implausible line is reported, not imported');
{
  // Payable larger in magnitude than the fare would mean a commission bigger
  // than the fare itself — impossible, so the tokens must have been misread.
  const r = parse(['*** ISSUES', '077 TKTT 9999999999 09AUG26 FFVV I 100.00 50.00 -5,000.00']);
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
    '077 TKTT 5513059026 09AUG26 FFVV I 4,080.00 2,240.00 2,240.00 7.00 156.80 0.00 0.00 3,923.20',
    'CATEGORY WEBSALES-EDIS',
    '*** ISSUES',
    '235 TKTT 2540225913 12AUG26 FFFF I 4,230.00 2,640.00 2,640.00 3.00 79.20 0.00 4,150.80',
  ]);
  check('BSP ticket stayed BSP', r.rows.find(t => t.ticketNo === '5513059026')?.channel, 'BSP');
  check('web ticket is WEBSALES-EDIS', r.rows.find(t => t.ticketNo === '2540225913')?.channel, 'WEBSALES-EDIS');
}

// ── Against the real invoice, when available ────────────────────────────────
const pdfPath = process.argv[2] ?? 'C:/Users/andre/AppData/Local/Temp/AE_FCAGBILLDET_8621913_20260802.PDF';
console.log(`\nREAL INVOICE — ${pdfPath}`);
if (!existsSync(pdfPath)) {
  console.log('  SKIPPED (file not present)');
} else {
  const buf = readFileSync(pdfPath);
  // extractPdfRows uses DecompressionStream, available in Node 18+ as well.
  extractPdfRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    .then(rows => {
      const csv = rows.map(r => `"${r.replace(/"/g, '""')}"`).join('\n');
      const grid = Papa.parse(csv, { skipEmptyLines: true }).data as string[][];
      const r = runParser(grid, undefined, 'AED', 'invoice.pdf');
      check('detected as BSP invoice', r.parserName, 'IATA BSP Invoice (PDF)');
      check('no parse errors', r.errors.length, 0);
      const bsp = r.rows.filter(t => t.channel === 'BSP');
      const web = r.rows.filter(t => t.channel === 'WEBSALES-EDIS');
      console.log(`  parsed ${r.rows.length} transactions — ${bsp.length} BSP, ${web.length} WEBSALES-EDIS`);
      const everyRowReconciles = r.rows.every(t =>
        Math.abs((t.status === 'VOID' ? 0 : (t.amount < 0 ? -(t.totalDoc ?? 0) : (t.totalDoc ?? 0))) - (t.commission ?? 0) - t.amount) < 0.011);
      check('every row satisfies fare - commission = payable', everyRowReconciles, true);
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
if (!existsSync(pdfPath)) done();
