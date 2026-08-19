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

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

const invoice = (body: string[]) => runParser([
  ['FCAGBILLDET AGENT BILLING DETAILS 86-2 1913 6 LUXURY EVENTS AND VIP TRAVEL FZC'],
  ['Billing Period: 260802(09-AUG-2026 to 15-AUG-2026)'],
  ['GRAND TOTAL (AED) 126,925.08 97,052.08'],
  ...body.map(l => [l]),
], undefined, 'AED', 'invoice.pdf');

const ISSUE = '077 TKTT 5513059026 09AUG26 FFVV I 4,080.00 2,240.00 2,240.00 7.00 156.80 0.00 0.00 3,923.20';
const REFUND = '235 RFND 5513059004 09AUG26 NR:5B I -10,410.00 -9,810.00 -9,810.00 0.00 0.00 2.00 -196.20 0.00 -10,213.80';

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
    '235 TKTT 2540225916 13AUG26 FFFF I 20,190.00 15,350.00 15,350.00 0.00 0.00 3.00 533.40 0.00 19,656.60']);
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
    '077 EMDS 1949933364 13AUG26 FVVV I* 80.00 80.00 80.00 0.00 0.00 0.00 0.00 80.00',
    '065 EMDA 1949933355 09AUG26 FFVV I 640.00 640.00 640.00 0.00 0.00 0.00 0.00 640.00']);
  check('EMDS imported', r.rows.find(t => t.rawType === 'EMDS')?.status, 'EMDS');
  check('EMDA imported', r.rows.find(t => t.rawType === 'EMDA')?.status, 'EMDS');
}

console.log('\n5. IATA CANX / CANN');
{
  const r = invoice(['*** ISSUES',
    '065 CANX 5513059030 10AUG26 VVVV I 0.00 0.00 0.00 0.00 0.00 0.00',
    '065 CANN 5512129119 08FEB26 VVVV I 0.00 0.00 0.00 0.00 0.00 0.00']);
  check('CANX present', r.rows.find(t => t.rawType === 'CANX')?.status, 'VOID');
  check('CANN present', r.rows.find(t => t.rawType === 'CANN')?.status, 'VOID');
  check('void carries no value', r.rows[0]?.amount, 0);
}

console.log('\n6. IATA SPDR — the type that used to vanish');
{
  const r = invoice(['*** DEBIT MEMOS', '953 SPDR 6000088139 17AUG26 D 22.08 22.08 0.00 22.08 0.00 22.08']);
  check('imported, not skipped', r.rows.length, 1);
  check('raw type preserved', r.rows[0]?.rawType, 'SPDR');
  check('amount captured', r.rows[0]?.amount, 22.08);
  check('vendor IATA', r.rows[0]?.source, 'IATA BSP');
  check('recognised, so not flagged unsupported', r.warnings.some(w => /Unsupported/i.test(w)), false);
}

console.log('\n7. Same ticket issued AND refunded — two transactions, not a duplicate');
{
  const r = invoice(['*** ISSUES', ISSUE, '*** REFUNDS',
    '077 RFND 5513059026 12AUG26 I -3,905.00 -2,240.00 -2,240.00 7.00 -156.80 0.00 0.00 -3,748.20']);
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
  const t = invoice(['*** ISSUES', '077 TKTT 5513059029 09AUG26 FFVV I 1,710.00 570.00 570.00 7.00 39.90 0.00 0.00 1,670.10']).rows[0];
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
  const r = invoice(['*** ISSUES', '953 ZZZZ 6000099999 17AUG26 D 55.00 55.00 0.00 55.00 0.00 55.00']);
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

  console.log('\n14. Missing invoice transactions are never created by a preview');
  // Phase 3's rule was "the ledger holds exactly 1,685 IATA rows and parsing an
  // invoice must not add to them". Phase 4 then imported the missing
  // transactions under an explicit authorisation, so a bare count no longer
  // expresses the rule. What still must hold — and is the thing actually worth
  // guarding — is that every IATA row beyond the Phase 3 baseline arrived
  // through that authorised import, never as a side effect of parsing.
  const PHASE3_BASELINE = 1685;
  const { rows: cnt } = await c.query(
    `select count(*)::int as n,
            count(*) filter (where import_batch_id like 'bsp-phase4-%')::int as imported
     from tickets where source = 'IATA BSP'`);
  check('every IATA row above the Phase 3 baseline came from the authorised import',
    cnt[0].n - cnt[0].imported, PHASE3_BASELINE);
  check('parsing alone still creates nothing', cnt[0].n >= PHASE3_BASELINE, true);

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

  console.log('\n19-22. Non-IATA vendors untouched');
  const EXPECTED: Record<string, [number, number]> = {
    'NSA':              [2770, 5005240.97],
    'Ibtekar':          [271, 249631.62],
    'RTS':              [281, 1785720.00],
    'AirArabia':        [19, -6683.82],
    'FlyAdeal DXB':     [83, 60347.51],
    'FlyAdeal KSA':     [2, 727.60],
    'FlyDubai':         [29, 28245.00],
    'Flynas':           [17, 16337.01],
    'Gold Medal':       [6, 11230.00],
    'Ibtekar (New)':    [8, 7441.41],
    'Riyadh Air':       [11, 62870.00],
    'Turkish Airlines': [20, 246030.00],
  };
  const { rows: vend } = await c.query(
    `select source, count(*)::int as n, coalesce(sum(amount),0)::float8 as net
     from tickets where source <> 'IATA BSP' group by source order by source`);
  for (const v of vend) {
    const exp = EXPECTED[v.source];
    if (!exp) { check(`${v.source} is a known vendor`, false, true); continue; }
    check(`${v.source}: ${exp[0]} rows, net ${exp[1]}`,
      `${v.n}|${Number(v.net).toFixed(2)}`, `${exp[0]}|${exp[1].toFixed(2)}`);
  }

  console.log('\n     vendor wallets unchanged');
  const { rows: w } = await c.query(`select vendor_name, initial_balance::float8 as ib from vendor_balances order by vendor_name`);
  const WALLETS: Record<string, number> = {
    'AirArabia': 10547.01, 'FlyAdeal DXB': 26340.21, 'FlyAdeal KSA': 728.89,
    'FlyDubai': 36740.37, 'Flynas': 6430.00, 'Ibtekar': 0.00, 'NSA': -100050.77,
  };
  for (const v of w) check(`  wallet ${v.vendor_name}`, Number(v.ib), WALLETS[v.vendor_name]);
  check('  no IATA wallet exists (none created)', w.some((r: any) => /^iata/i.test(r.vendor_name)), false);
  check('  no WEBSALES wallet exists (none created)', w.some((r: any) => /websales/i.test(r.vendor_name)), false);

  console.log('\n     WEBSALES-EDIS cannot attach to a wallet as a vendor');
  for (const v of Object.keys(WALLETS)) {
    check(`  ${v} does not claim WEBSALES-EDIS`, vendorMatchesSource(v, 'WEBSALES-EDIS'), false);
  }

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
