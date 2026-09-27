/**
 * What share of issuance was cancelled.
 *
 * IATA caps this over a year, so the annual figure is the one that bites —
 * but a year is found out too late to act on, and the damage accumulates a
 * period at a time, so both are worked out.
 *
 * The denominator is the one thing here that is easy to get wrong and
 * expensive to get wrong. A cancelled document was still ISSUED: it came off
 * the agency's stock before anybody cancelled it. Leaving it out of the
 * bottom of the fraction flatters the ratio exactly when it is growing —
 * 334 voids against 1,567 live documents reads as 21.3% if you divide by
 * live alone, and 17.6% when you divide by what was actually drawn. The
 * second is the true one and the smaller one, which is why the mistake
 * survives: it looks conservative and is not.
 */
import { voidReport, isIssuance, VoidRow } from '../src/core/helpers/voidRatio';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2), ticketNo: '5513373350', pnr: '', passengerName: '',
  airlineCode: '065', route: '', source: 'IATA BSP', date: '2026-08-12', amount: 100,
  totalDoc: 100, commission: 0, reqNum: '', status: 'ISSUE', isDuplicate: false,
  userId: 'u', currency: 'AED', ...o,
});

const vd = (o: Partial<VoidRow>): VoidRow => ({
  ticketNo: '9999999999', date: '2026-08-12', source: 'IATA BSP', ...o,
});

console.log('\n1. The denominator is what was drawn, not what survived');
{
  // Three issued, one cancelled: four documents came off the stock.
  const r = voidReport(
    [vd({ ticketNo: '1' })],
    [tkt({ ticketNo: '2' }), tkt({ ticketNo: '3' }), tkt({ ticketNo: '4' })]);
  check('issued', r.overall.issued, 3);
  check('voided', r.overall.voided, 1);
  check('one in four were drawn and cancelled', r.overall.ratio, 25);
  check('  ...not one in three', r.overall.ratio !== 33.33, true);
}

console.log('\n2. The real figures');
{
  const voids = Array.from({ length: 334 }, (_, i) => vd({ ticketNo: `v${i}` }));
  const live = Array.from({ length: 1567 }, (_, i) => tkt({ ticketNo: `t${i}` }));
  const r = voidReport(voids, live);
  check('1,901 documents drawn', r.overall.issued + r.overall.voided, 1901);
  check('17.57% of them cancelled', r.overall.ratio, 17.57);
  // The mistake, for the record.
  check('dividing by the survivors would say 21.31',
        Math.round((334 / 1567) * 10000) / 100, 21.31);
}

console.log('\n3. A refund is not a void');
{
  /* A refund is a sale that happened and was given back. A void never
     happened. Counting a refund as either would move the ratio on a
     document that was never cancelled. */
  const refund = tkt({ amount: -100, transactionType: 'REFUND' });
  check('a refund is not issuance', isIssuance(refund), false);
  check('a sale is', isIssuance(tkt({})), true);
  check('a wallet top-up is not', isIssuance(tkt({ status: 'FUND', amount: 50000 })), false);

  const r = voidReport([vd({})], [tkt({}), refund]);
  check('so one sale and one void is fifty per cent', r.overall.ratio, 50);
  check('  ...the refund counted on neither side', r.overall.issued, 1);
}

console.log('\n4. By month and by year');
{
  const r = voidReport(
    [vd({ date: '2026-08-02' }), vd({ date: '2026-08-20' }), vd({ date: '2026-09-01' })],
    [tkt({ date: '2026-08-05' }), tkt({ date: '2026-09-05' }), tkt({ date: '2026-09-06' }),
     tkt({ date: '2025-12-01' })]);

  const aug = r.byMonth.find(x => x.key === '2026-08')!;
  check('August: one issued, two voided', [aug.issued, aug.voided], [1, 2]);
  check('  ...two of three drawn', aug.ratio, 66.67);
  const sep = r.byMonth.find(x => x.key === '2026-09')!;
  check('September', [sep.issued, sep.voided, sep.ratio], [2, 1, 33.33]);

  const y26 = r.byYear.find(x => x.key === '2026')!;
  check('2026 as a whole', [y26.issued, y26.voided, y26.ratio], [3, 3, 50]);
  const y25 = r.byYear.find(x => x.key === '2025')!;
  check('2025 had none cancelled', [y25.issued, y25.voided, y25.ratio], [1, 0, 0]);

  check('newest first', r.byMonth.map(x => x.key), ['2026-09', '2026-08', '2025-12']);
}

console.log('\n5. A document cannot be both cancelled and sold');
{
  /* Where it is both, one of the two records is wrong — and this is the
     whole reason the voids are kept instead of dropped. Punctuation must
     not hide it: the ledger writes 065-5513373350 and the invoice 5513373350. */
  const r = voidReport(
    [vd({ ticketNo: '5513373350' })],
    [tkt({ ticketNo: '065-5513373350' }), tkt({ ticketNo: '1111111111' })]);
  check('the clash is found', r.alsoLive, ['5513373350']);
  check('  ...across the punctuation', r.alsoLive.length, 1);

  const clean = voidReport([vd({ ticketNo: '2222222222' })], [tkt({ ticketNo: '1111111111' })]);
  check('and a clean set reports none', clean.alsoLive, []);
}

console.log('\n6. One supplier at a time');
{
  const r = voidReport(
    [vd({ source: 'IATA BSP' }), vd({ source: 'RTS' })],
    [tkt({ source: 'IATA BSP' }), tkt({ source: 'RTS' }), tkt({ source: 'RTS' })],
    'IATA BSP');
  check('only BSP is counted', [r.overall.issued, r.overall.voided], [1, 1]);
  check('so BSP is half', r.overall.ratio, 50);
}

console.log('\n7. Nothing drawn is nought, not a division by zero');
{
  const r = voidReport([], []);
  check('no ratio', r.overall.ratio, 0);
  check('no months', r.byMonth, []);
  check('no clashes', r.alsoLive, []);

  // Voids and no issuance at all: everything drawn was cancelled.
  const all = voidReport([vd({})], []);
  check('all of it cancelled', all.overall.ratio, 100);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
