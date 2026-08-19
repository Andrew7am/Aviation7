/**
 * PHASE 6 — commission is READ from its own column, never derived.
 *
 * The old parser computed commission as `Transaction Amount - Balance Payable`.
 * That is wrong wherever the two are not related by commission alone, and the
 * invoice says so itself:
 *
 *   Balance Payable = Transaction Amount CA FOP (or 0)
 *                     - Std Comm - Supp Comm +/- Tax on Comm
 *
 * On a credit-card sale "CA FOP" is 0, so Balance Payable is 0.00 while the
 * transaction amount is not — and the derivation returns the whole fare as
 * commission. These tests pin the corrected behaviour.
 *
 * Run: npx tsx scripts/test-bsp-commission.ts [dir-of-invoices]
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
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

/* ── 1-4: commission comes from its own columns ─────────────────────────── */
console.log('1-4  commission is read, not derived');
{
  // Standard commission only. Deriving would also give 156.80 here, so this
  // case alone cannot tell the two apart — cases 3 and 4 do that.
  const r = parse(['*** ISSUES', txn({
    trnc: 'TKTT', doc: '5513059026', date: '09AUG26', cpui: 'FFVV',
    txn: 4080.00, fare: 2240.00, cobl: 2240.00, stdRate: 7.00, stdAmt: 156.80,
    suppRate: 0, suppAmt: 0, taxOnComm: 0, payable: 3923.20,
  })]);
  const t = r.rows[0];
  check('1  Standard Commission read from its own column', t?.commission, 156.80);
  check('   transaction amount kept as the fare', t?.totalDoc, 4080.00);
  check('   balance payable kept as the amount', t?.amount, 3923.20);
}
{
  // Supplementary only: nothing in the Std column at all.
  const t = parse(['*** ISSUES', txn({
    trnc: 'TKTT', doc: '5513059031', date: '09AUG26',
    txn: 1000.00, fare: 1000.00, stdRate: 0, stdAmt: 0,
    suppRate: 5.00, suppAmt: 50.00, payable: 950.00,
  })]).rows[0];
  check('2  Supplementary Commission read from its own column', t?.commission, 50.00);
}
{
  // Both columns carry a value — the total is their sum, and no single
  // column would produce it.
  const t = parse(['*** ISSUES', txn({
    trnc: 'TKTT', doc: '5513059032', date: '09AUG26',
    txn: 1000.00, fare: 1000.00, stdRate: 7.00, stdAmt: 70.00,
    suppRate: 3.00, suppAmt: 30.00, payable: 900.00,
  })]).rows[0];
  check('3  total commission = Std + Supp', t?.commission, 100.00);
}
{
  // The decisive case: payable does NOT equal fare minus commission, because
  // a penalty was withheld. Deriving would return 500.00; the columns say 70.
  const t = parse(['*** ISSUES', txn({
    trnc: 'TKTT', doc: '5513059033', date: '09AUG26',
    txn: 1000.00, fare: 1000.00, taxes: { pen: 430.00 },
    stdRate: 7.00, stdAmt: 70.00, suppAmt: 0, payable: 500.00,
  })]).rows[0];
  check('4  commission is NOT fare - payable', t?.commission, 70.00);
  check('   (the derivation would have said 500.00)', t?.commission === 500.00, false);
}

/* ── 5-6: the card (FOP = CC) case ──────────────────────────────────────── */
console.log('\n5-6  credit-card rows settle nothing, and carry no phantom commission');
{
  const t = parse(['*** ISSUES', txn({
    trnc: 'TKTT', doc: '5512129174', date: '19FEB26', cpui: 'FFVV', fop: 'CC',
    txn: 20.00, fare: 0, taxes: { tax: 20.00 },
    stdRate: 0, stdAmt: 0, suppRate: 0, suppAmt: 0, taxOnComm: 0, payable: 0,
  })]).rows[0];
  check('5  card sale: commission is the printed 0.00', t?.commission, 0);
  check('   payable is 0.00', t?.amount, 0);
  check('   the transaction amount is still recorded', t?.totalDoc, 20.00);
  check('   the row is kept, not skipped', t !== undefined, true);
}
{
  // The seven refunds from the investigation, in their real shape.
  const docs = ['5512129174', '5512129175', '5512129176', '5512129177', '5512129178', '5512129179', '5512129180'];
  const r = parse(['*** REFUNDS', ...docs.map(doc => txn({
    trnc: 'RFND', doc, date: '19MAR26', fop: 'CC',
    txn: -48890.00, fare: -45290.00, taxes: { fc: -2820.00 }, cobl: -45290.00,
    stdRate: 0, stdAmt: 0, suppRate: 0, suppAmt: 0, taxOnComm: 0, payable: 0,
  }))]);
  check('6  all seven parsed', r.rows.length, 7);
  check('   every one carries commission 0.00', r.rows.every(t => t.commission === 0), true);
  check('   none carries the phantom -48,890.00', r.rows.some(t => Math.abs(t.commission ?? 0) > 0.005), false);
  check('   the refund value itself is preserved', r.rows[0]?.totalDoc, 48890.00);
  check('   status is REFUND', r.rows[0]?.status, 'REFUND');
}

/* ── 7-9: memos, fees and signs ─────────────────────────────────────────── */
console.log('\n7-9  memos, SPDR and signed refunds');
{
  // A commission recall: no fare at all, the whole line IS the commission.
  const t = parse(['*** DEBIT MEMOS', txn({
    air: '235', trnc: 'ADMA', doc: '1234567890', date: '12AUG26',
    txn: 0, stdAmt: -104.36, suppAmt: 0, payable: 104.36,
  })]).rows[0];
  check('7  ADMA with no fare is accepted', t !== undefined, true);
  check('   its commission keeps the minus sign', t?.commission, -104.36);
  check('   its payable is positive', t?.amount, 104.36);
  check('   status', t?.status, 'ADM');
}
{
  const t = parse(['*** DEBIT MEMOS', txn({
    air: '235', trnc: 'SPDR', doc: '6000088139', date: '17AUG26',
    txn: 22.08, stdAmt: 0, suppAmt: 0, payable: 22.08,
  })]).rows[0];
  check('8  SPDR parsed', t?.ticketNo, '6000088139');
  check('   value kept', t?.amount, 22.08);
  check('   commission 0.00, not derived from anything', t?.commission, 0);
  check('   raw type preserved', t?.rawType, 'SPDR');
}
{
  const t = parse(['*** REFUNDS', txn({
    air: '235', trnc: 'RFND', doc: '5513059004', date: '09AUG26',
    txn: -10410.00, fare: -9810.00, taxes: { tax: -1040.00 }, cobl: -9810.00,
    stdRate: 2.00, stdAmt: -196.20, suppAmt: 0, payable: -10213.80,
  })]).rows[0];
  check('9  refund commission keeps its sign', t?.commission, -196.20);
  check('   payable stays negative', t?.amount, -10213.80);
  check('   no Math.abs was applied', t?.amount < 0, true);
  check('   cents survive', Number.isInteger(t?.commission ?? 0), false);
}

/* ── 10: WEBSALES-EDIS ──────────────────────────────────────────────────── */
console.log('\n10   WEBSALES-EDIS commission survives the channel switch');
{
  const r = parse([
    '*** ISSUES',
    txn({ trnc: 'TKTT', doc: '5513059027', date: '09AUG26', txn: 6830.00, stdAmt: 0, suppAmt: 0, payable: 6830.00 }),
    'CATEGORY WEBSALES-EDIS',
    '*** ISSUES',
    txn({ air: '254', trnc: 'TKTT', doc: '2540225913', date: '12AUG26', txn: 4230.00, stdRate: 3.00, stdAmt: 79.20, suppAmt: 0, payable: 4150.80 }),
  ]);
  const bsp = r.rows.find(t => t.ticketNo === '5513059027');
  const web = r.rows.find(t => t.ticketNo === '2540225913');
  check('10 BSP row stays on the BSP channel', bsp?.channel, 'BSP');
  check('   web row is WEBSALES-EDIS', web?.channel, 'WEBSALES-EDIS');
  check('   web row is still the IATA vendor', web?.source, 'IATA BSP');
  check('   its commission is the printed one', web?.commission, 79.20);
}

/* ── a grid with no positions must fail loudly ──────────────────────────── */
console.log('\n     a converted copy without positions is refused, not guessed at');
{
  const r = runParser(
    [['FCAGBILLDET AGENT BILLING DETAILS'],
     ['*** ISSUES'],
     ['077 TKTT 5513059026 09AUG26 FFVV I 4,080.00 2,240.00 156.80 3,923.20']],
    undefined, 'AED', 'converted.csv');
  check('   no rows invented', r.rows.length, 0);
  check('   the reason is reported', r.errors.some(e => /column positions/i.test(e)), true);
}

/* ── 11-12: the real 32 invoices ────────────────────────────────────────── */
const DIR = process.argv[2]
  ?? 'C:/Users/andre/AppData/Local/Temp/claude/C--Users-andre-Downloads-aviation-v2-full-aviation-v2/7afbf2a6-6146-4119-b309-e7247479d463/scratchpad/iata';
console.log(`\n11-12 full invoice regression — ${DIR}`);

async function realInvoices() {
  if (!existsSync(DIR)) { console.log('  SKIPPED (invoice directory not present)'); return; }
  const files = readdirSync(DIR).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f)).sort();
  const all: ReturnType<typeof runParser>['rows'] = [];
  let errors = 0;
  for (const f of files) {
    const buf = readFileSync(path.join(DIR, f));
    const rows = await extractPdfRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const grid = Papa.parse(pdfRowsToCsv(rows), { skipEmptyLines: true }).data as string[][];
    const r = runParser(grid, undefined, 'AED', f);
    if (r.parserName !== 'IATA BSP Invoice (PDF)') { fail++; console.log(`  FAIL  ${f} detected as ${r.parserName}`); }
    errors += r.errors.length;
    all.push(...r.rows);
  }
  check('11 all 32 invoices parsed', files.length, 32);
  check('   no parse errors', errors, 0);
  check('12 every row accounted for', all.length, 1936);
  check('   none undated', all.filter(t => !/^\d{4}-\d{2}-\d{2}$/.test(t.date)).length, 0);

  const byType: Record<string, number> = {};
  for (const t of all) byType[t.rawType ?? '?'] = (byType[t.rawType ?? '?'] ?? 0) + 1;
  check('   TKTT', byType.TKTT, 1268);
  check('   RFND', byType.RFND, 319);
  check('   CANN', byType.CANN, 131);
  check('   CANX', byType.CANX, 73);
  check('   EMDA', byType.EMDA, 69);
  check('   EMDS', byType.EMDS, 60);
  check('   SPDR', byType.SPDR, 12);
  check('   ADMA', byType.ADMA, 2);
  check('   ACMA', byType.ACMA, 2);

  // The 18 card rows must now carry no commission at all.
  const cardDocs = ['5512129174', '5512129175', '5512129176', '5512129177', '5512129178',
                    '5512129179', '5512129180', '1930576214', '1930576215', '1930576216', '1930576217'];
  const card = all.filter(t => cardDocs.includes(t.ticketNo) && t.amount === 0 && (t.totalDoc ?? 0) !== 0);
  check('   the card rows are present', card.length, 18);
  check('   and every one carries commission 0.00', card.every(t => (t.commission ?? 0) === 0), true);
  const phantom = card.reduce((s, t) => s + Math.abs(t.commission ?? 0), 0);
  check('   no phantom commission anywhere in them', phantom, 0);

  // The invoice's own formula, on the rows it applies to.
  const cash = all.filter(t => t.status !== 'VOID' && t.amount !== 0);
  const holds = cash.filter(t => {
    const fareSigned = t.amount < 0 ? -(t.totalDoc ?? 0) : (t.totalDoc ?? 0);
    return Math.abs(fareSigned - (t.commission ?? 0) - t.amount) < 0.011;
  });
  check('   cash rows satisfy fare - commission = payable', holds.length, cash.length);

  console.log(`\n  total printed commission across all 32 invoices: ${
    all.reduce((s, t) => s + (t.commission ?? 0), 0).toFixed(2)} AED`);
}

realInvoices()
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
  })
  .catch(e => { console.error(e); process.exit(1); });
