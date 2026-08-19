/**
 * PHASE 7 — correction preview calculations.
 *
 * These test the arithmetic of a correction that has NOT been applied, so the
 * important assertions are as much about what stays still as what moves:
 * rounding rows, card rows and Phase-4 imports must come back with a delta of
 * exactly zero, and the two kinds of commission gap must never be merged.
 *
 * Run: npx tsx scripts/test-iata-phase7.ts
 */
import { readFileSync } from 'fs';
import {
  planRow, summarise, planIssueStubs, projectScenarios, categorise, validateA,
  type LedgerSide, type InvoiceSide, type IssueStub, type Totals,
} from '../src/core/helpers/iataCommissionPlan';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005
    : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
}

const led = (o: Partial<LedgerSide> & { fare: number; commission: number; payable: number }): LedgerSide => ({
  id: o.id ?? 'led-1', ticketNo: o.ticketNo ?? '5511323149', type: o.type ?? 'TKTT',
  channel: o.channel ?? 'BSP', date: o.date ?? '2026-01-08',
  fare: o.fare, commission: o.commission, payable: o.payable, phase4: o.phase4 ?? false,
});
const inv = (o: Partial<InvoiceSide> & { fare: number; commission: number; payable: number }): InvoiceSide => ({
  type: o.type ?? 'TKTT', channel: o.channel ?? 'BSP', date: o.date ?? '2026-01-08',
  fare: o.fare, commission: o.commission, payable: o.payable,
});

/* ── 1: category A, gross to net ────────────────────────────────────────── */
console.log('1  Category A — gross becomes net');
{
  // The worked example from the spec.
  const p = planRow(
    led({ fare: 16950.00, commission: 0, payable: 16950.00 }),
    inv({ fare: 16950.00, commission: 272.00, payable: 16678.00 }));
  check('classified A', p.category, 'A genuine missing');
  check('new commission', p.newCommission, 272.00);
  check('new balance payable', p.newBalancePayable, 16678.00);
  check('commission delta', p.commissionDelta, 272.00);
  check('balance payable delta', p.balancePayableDelta, -272.00);
  check('fare is not touched', p.currentFare, 16950.00);
  check('the action names both moves', /commission AND move balance payable/.test(p.proposedAction), true);
  check('all five §4 checks pass', Object.values(p.validation).every(Boolean), true);
}
{
  // A row whose ledger payable is NOT the gross fails validation and is set
  // aside rather than corrected on a guess.
  const p = planRow(
    led({ fare: 16950.00, commission: 0, payable: 16000.00 }),
    inv({ fare: 16950.00, commission: 272.00, payable: 16678.00 }));
  check('a row that fails §4 is not category A', p.category === 'A genuine missing', false);
  check('and nothing is proposed for it', [p.commissionDelta, p.balancePayableDelta], [0, 0]);
}

/* ── 2: category B, commission only ─────────────────────────────────────── */
console.log('\n2  Category B — commission only, money already net');
{
  const p = planRow(
    led({ fare: 3470.00, commission: 0, payable: 3433.40 }),
    inv({ fare: 3470.00, commission: 36.60, payable: 3433.40 }));
  check('classified B', p.category, 'B already net');
  check('new commission', p.newCommission, 36.60);
  check('balance payable is unchanged', p.newBalancePayable, 3433.40);
  check('balance payable delta is exactly zero', p.balancePayableDelta, 0);
  check('the action says so', /commission only/.test(p.proposedAction), true);
}

/* ── 3: rounding excluded ───────────────────────────────────────────────── */
console.log('\n3  Category G — rounding, excluded');
{
  const p = planRow(
    led({ fare: 3880.00, commission: 293.00, payable: 3587.00 }),
    inv({ fare: 3880.00, commission: 292.50, payable: 3587.50 }));
  check('classified G', p.category, 'G rounding');
  check('no commission change', p.commissionDelta, 0);
  check('no balance payable change', p.balancePayableDelta, 0);
  check('it still appears in the preview', p.document, '5511323149');
}

/* ── 4-5: card rows and the seven refunds ───────────────────────────────── */
console.log('\n4-5  FOP = CC — excluded, including the seven refunds');
{
  // A card sale: the invoice settles nothing and prints no commission.
  const p = planRow(
    led({ ticketNo: '5512129174', type: 'TKTT', fare: 20.00, commission: 0, payable: 20.00 }),
    inv({ fare: 20.00, commission: 0, payable: 0 }));
  check('classified as a card row', p.category, 'CC card row');
  check('no correction proposed', [p.commissionDelta, p.balancePayableDelta], [0, 0]);
}
{
  const docs = ['5512129174', '5512129175', '5512129176', '5512129177', '5512129178', '5512129179', '5512129180'];
  // Each already agrees with the invoice at 0.00, so it never even becomes a case.
  const plans = docs.map(d => planRow(
    led({ id: `led-${d}`, ticketNo: d, type: 'RFND', fare: 48890.00, commission: 0, payable: -48890.00 }),
    inv({ type: 'RFND', fare: 48890.00, commission: 0, payable: 0 })));
  check('all seven classified as card rows', plans.every(p => p.category === 'CC card row'), true);
  check('none proposes a commission change', plans.every(p => p.commissionDelta === 0), true);
  check('none proposes a balance change', plans.every(p => p.balancePayableDelta === 0), true);
  check('none manufactures the phantom -48,890.00',
    plans.some(p => Math.abs(p.newCommission) > 0.005), false);
}

/* ── 6: the three missing BSP issues ────────────────────────────────────── */
console.log('\n6  The three missing BSP issues');
{
  const stubs: IssueStub[] = [
    { document: '5511323216',
      invoiceIssue: { date: '2026-01-25', fare: 20940.00, commission: 0, payable: 20940.00 },
      ledgerRefund: { date: '2026-05-05', payable: -20550.00 },
      localVoid: { id: 'void-216', date: '2026-01-25' } },
    { document: '5511323218',
      invoiceIssue: { date: '2026-01-25', fare: 20940.00, commission: 0, payable: 20940.00 },
      ledgerRefund: { date: '2026-05-05', payable: -20550.00 },
      localVoid: { id: 'void-218', date: '2026-01-25' } },
    { document: '5511323220',
      invoiceIssue: { date: '2026-01-25', fare: 20940.00, commission: 0, payable: 20940.00 },
      ledgerRefund: { date: '2026-04-14', payable: -20920.00 },
      localVoid: { id: 'void-220', date: '2026-01-25' } },
  ];
  const plans = planIssueStubs(stubs);
  check('true net, 216', plans[0].trueNet, 390.00);
  check('true net, 218', plans[1].trueNet, 390.00);
  check('true net, 220', plans[2].trueNet, 20.00);
  check('true net across all three', plans.reduce((s, p) => s + p.trueNet, 0), 800.00);
  check('ledger net across all three', plans.reduce((s, p) => s + p.ledgerNet, 0), -62020.00);
  check('understatement', plans.reduce((s, p) => s + p.understatement, 0), 62820.00);
  check('classified apart from any commission work',
    plans.every(p => p.classification === 'MISSING BSP ISSUE + EXISTING LOCAL VOID'), true);
  check('no insert is proposed', plans.every(p => /NO CHANGE/.test(p.proposedAction)), true);
  check('the local VOID is never proposed for deletion',
    plans.every(p => /local VOID stays/.test(p.proposedAction)), true);
}

/* ── 7: projected totals ────────────────────────────────────────────────── */
console.log('\n7  Projected totals');
{
  const rows = [
    planRow(led({ id: 'a1', fare: 16950, commission: 0, payable: 16950 }), inv({ fare: 16950, commission: 272, payable: 16678 })),
    planRow(led({ id: 'b1', fare: 3470, commission: 0, payable: 3433.40 }), inv({ fare: 3470, commission: 36.60, payable: 3433.40 })),
    planRow(led({ id: 'g1', fare: 3880, commission: 293, payable: 3587 }), inv({ fare: 3880, commission: 292.50, payable: 3587.50 })),
  ];
  const totals = summarise(rows);
  check('A totalled alone', totals['A genuine missing'].commissionDelta, 272.00);
  check('B totalled alone', totals['B already net'].commissionDelta, 36.60);
  check('G contributes nothing', totals['G rounding'].commissionDelta, 0);

  const issues = planIssueStubs([{
    document: '5511323216',
    invoiceIssue: { date: '2026-01-25', fare: 20940, commission: 0, payable: 20940 },
    ledgerRefund: { date: '2026-05-05', payable: -20550 },
    localVoid: { id: 'v', date: '2026-01-25' },
  }]);
  const current: Totals = { transactions: 1785, fare: 9406935.46, commission: 61091.74, balancePayable: 6184316.40 };
  const sc = projectScenarios(current, totals, issues);

  check('scenario A adds both commissions', sc.scenarioA.commission, 61091.74 + 272.00 + 36.60);
  check('scenario A leaves balance payable alone', sc.scenarioA.balancePayable, current.balancePayable);
  check('scenario A leaves the count alone', sc.scenarioA.transactions, 1785);
  check('scenario B moves balance payable by category A only',
    sc.scenarioB.balancePayable, current.balancePayable - 272.00);
  check('scenario B keeps scenario A commission', sc.scenarioB.commission, sc.scenarioA.commission);
  check('scenario C adds the issue count', sc.scenarioC.transactions, 1786);
  check('scenario C adds the issue fare', sc.scenarioC.fare, current.fare + 20940);
  check('scenario C adds the issue payable', sc.scenarioC.balancePayable, sc.scenarioB.balancePayable + 20940);
  check('scenario C adds no commission', sc.scenarioC.commission, sc.scenarioB.commission);
}

/* ── 8: no database writes ──────────────────────────────────────────────── */
console.log('\n8  The preview cannot write');
{
  const src = readFileSync('scripts/preview-iata-corrections.ts', 'utf8');
  const plan = readFileSync('src/core/helpers/iataCommissionPlan.ts', 'utf8');
  const forbidden = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate|alter\s+table)\b/i;

  // Read the SQL itself rather than the file's prose — the script's own
  // "SELECT only, no INSERT/UPDATE/DELETE" log line would otherwise trip a
  // plain text scan, and a test that cries wolf gets switched off.
  const statements = [...src.matchAll(/\bc\.query\(\s*`([^`]*)`/g)].map(m => m[1]);
  check('every statement in the preview was found', statements.length > 0, true);
  check('every one of them is a SELECT', statements.every(s => /^\s*select\b/i.test(s.trim())), true);
  check('none of them writes', statements.some(s => forbidden.test(s)), false);
  check('no query is built from anything but a literal',
    (src.match(/\bc\.query\(/g) ?? []).length, statements.length);
  check('no write statement in the planning module', forbidden.test(plan), false);
  check('the planning module never opens a connection', /new Client|pg['"]/.test(plan), false);
  check('the preview writes only its own report file',
    (src.match(/writeFileSync\(/g) ?? []).length, 1);
}

/* ── 9: Phase-4 imports are never corrected ─────────────────────────────── */
console.log('\n9  Phase-4 imported rows are excluded');
{
  const p = planRow(
    led({ id: 'p4', fare: 16950, commission: 0, payable: 16950, phase4: true }),
    inv({ fare: 16950, commission: 272, payable: 16678 }));
  check('still classified honestly', p.category, 'A genuine missing');
  check('but no commission change', p.commissionDelta, 0);
  check('and no balance change', p.balancePayableDelta, 0);
  check('the reason is stated', /Phase 4/.test(p.proposedAction), true);
  const totals = summarise([p]);
  check('it contributes nothing to the totals', totals['A genuine missing'].commissionDelta, 0);
  check('but it is still counted and flagged', totals['A genuine missing'].phase4Rows, 1);
}

/* ── 10: nothing outside IATA ───────────────────────────────────────────── */
console.log('\n10 Non-IATA vendors are unreachable');
{
  const p = planRow(
    led({ fare: 100, commission: 0, payable: 100 }),
    inv({ fare: 100, commission: 5, payable: 95 }));
  check('every planned row is stamped IATA BSP', p.vendor, 'IATA BSP');
  const src = readFileSync('scripts/preview-iata-corrections.ts', 'utf8');
  check('the ledger query is scoped to one source',
    /from tickets where source = \$1/.test(src), true);
  check('and that source is the IATA vendor',
    /const IATA_VENDOR = 'IATA BSP'/.test(src), true);
  // The two snapshot queries read every vendor on purpose — that is how the
  // "nothing else changed" claim is checked — but they only ever SELECT.
  check('the whole-table reads are aggregates only',
    /select source, count\(\*\)/.test(src), true);
}

/* ── categorisation is order-sensitive; pin it ──────────────────────────── */
console.log('\n   category boundaries');
{
  check('a card row is recognised before anything else',
    categorise(led({ fare: 20, commission: 0, payable: 20 }), inv({ fare: 20, commission: 0, payable: 0 })),
    'CC card row');
  check('a half-unit commission difference is rounding, not a gap',
    categorise(led({ fare: 3880, commission: 293, payable: 3587 }), inv({ fare: 3880, commission: 292.50, payable: 3587.50 })),
    'G rounding');
  check('a one-unit-plus gap with a zero ledger commission is not rounding',
    categorise(led({ fare: 16950, commission: 0, payable: 16950 }), inv({ fare: 16950, commission: 272, payable: 16678 })),
    'A genuine missing');
  const v = validateA(led({ fare: 16950, commission: 0, payable: 16950 }), inv({ fare: 16950, commission: 272, payable: 16678 }));
  check('§4 lists five checks', Object.keys(v).length, 5);
  check('a refund validates on signed values',
    Object.values(validateA(
      led({ type: 'RFND', fare: 2600, commission: 0, payable: -2600 }),
      inv({ type: 'RFND', fare: 2600, commission: -50, payable: -2550 }))).every(Boolean), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
