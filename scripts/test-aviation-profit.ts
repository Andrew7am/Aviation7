/**
 * The aviation team's profit: the cost they quoted operations less what the
 * supplier charged us, from 9 Nov 2026.
 *
 *   npx tsx scripts/test-aviation-profit.ts
 */
import { aviationProfit, profitBy, type ProfitSheetRow } from '../src/core/helpers/aviationProfit';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const row = (o: Partial<ProfitSheetRow>): ProfitSheetRow => ({ record_id: 'r1', serials: ['5513727400'], pnr: 'ABC123', status: 'Issued',
  req_num: 'KSAML2900', net_cost: 1100, currency: 'AED', issued_at: '2026-11-09T08:00:00Z', team_member: 'Kerolos Rrad',
  portal: 'IATA Portal (UAE)', airline: 'Emirates', ticket_cell: '176-5513727400', emd: '', ...o });
const tk = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36).slice(2), ticketNo: '5513727400', source: 'IATA BSP', status: 'ISSUE',
  amount: 1000, currency: 'AED', date: '2026-11-09', pnr: 'ABC123', reportName: 'IATA BSP', reqNum: 'KSAML2900', ...o } as Ticket);
const run = (rows: ProfitSheetRow[], ledger: Ticket[], voided: string[] = []) =>
  aviationProfit(rows, ledger, undefined, '', voided).map(l => [l.state, l.quoted, l.cost, l.profit]);

console.log('\n1. Quoted 1,100, bought at 1,000');
check('100 is the team\'s', run([row({})], [tk({})]), [['COUNTED', 1100, 1000, 100]]);
check('not before 9 Nov: their cost was the real one then', run([row({ issued_at: '2026-11-08T20:00:00Z' })], [tk({})]), []);
check('9 Nov from Riyadh midnight', run([row({ issued_at: '2026-11-08T21:30:00Z' })], [tk({})]).length, 1);
check('quoted below cost is a loss', run([row({ net_cost: 950 })], [tk({})]), [['COUNTED', 950, 1000, -50]]);

console.log('\n2. Not counted until the supplier has billed it');
check('not in our books yet', run([row({})], []), [['NOT_IN_BOOKS', 1100, null, null]]);
check('in our books from their sheet only: their figure, so it waits', run([row({})], [tk({ reportName: 'Team sheet — reviewed' })]), [['AWAITING_SUPPLIER', 1100, null, null]]);
check('...and counts once the supplier confirms it', run([row({})], [tk({ reportName: 'Team sheet — reviewed', confirmedBy: 'IATA BSP' })]), [['COUNTED', 1100, 1000, 100]]);
check('voided with the supplier: nothing to count', run([row({})], [], ['5513727400']), []);

console.log('\n3. Rows and documents');
check('an Issued and a Reissue row on one ticket are one booking',
  run([row({}), row({ record_id: 'r2', status: 'Reissue', net_cost: 300 })], [tk({}), tk({ amount: 250 })]), [['COUNTED', 1400, 1250, 150]]);
check('one row, four tickets, priced each (UAEVP771)',
  run([row({ serials: ['5513727369', '5513727370', '5513727371', '5513727372'], net_cost: 900 })],
    ['5513727369', '5513727370', '5513727371', '5513727372'].map(n => tk({ ticketNo: n, amount: 860 }))), [['COUNTED', 3600, 3440, 160]]);
check('one row, two tickets, priced as the cell', run([row({ serials: ['5513727369', '5513727370'], net_cost: 1800 })],
  ['5513727369', '5513727370'].map(n => tk({ ticketNo: n, amount: 860 }))), [['COUNTED', 1800, 1720, 80]]);
check('our cost in riyals, their quote in dirhams: converted at the peg',
  run([row({ net_cost: 1100 })], [tk({ amount: 1000, currency: 'SAR' })]).map(x => x[0]), ['COUNTED']);
const fz = (o: Partial<ProfitSheetRow>) => row({ serials: [], pnr: 'Y4TG8S', portal: 'flydubai', airline: 'Flydubai', ticket_cell: '0', ...o });
check('a flydubai booking for two on two rows is one sale of ours (Y4TG8S)',
  run([fz({ net_cost: 2000 }), fz({ record_id: 'r2', net_cost: 2000 })], [tk({ ticketNo: 'Y4TG8S', pnr: 'Y4TG8S', source: 'FlyDubai', amount: 3920, reportName: 'FlyDubai' })]),
  [['COUNTED', 4000, 3920, 80]]);
check('...and a sale of that booking two months earlier is not this one',
  run([fz({ net_cost: 700 })], [tk({ ticketNo: 'Y4TG8S', pnr: 'Y4TG8S', source: 'FlyDubai', amount: 635, date: '2026-09-05', reportName: 'FlyDubai' })]).map(x => x[0]), ['NOT_IN_BOOKS']);

console.log('\n4. Added up');
const lines = aviationProfit([row({}), row({ record_id: 'r2', serials: ['5513727401'], team_member: 'Salma Adel', net_cost: 500, currency: 'SAR' })],
  [tk({}), tk({ ticketNo: '5513727401', amount: 450, currency: 'SAR' })]);
const by = profitBy(lines, l => l.member);
check('by member, each in its own currency', by.map(t => [t.key, t.profit]), [['Kerolos Rrad', { AED: 100 }], ['Salma Adel', { SAR: 50 }]]);
check('...and in riyals for the total', profitBy(lines, () => 'all')[0].inSar, 152.11);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
