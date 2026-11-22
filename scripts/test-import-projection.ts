/**
 * The balance an import will leave, shown before Confirm.
 *
 *   npx tsx scripts/test-import-projection.ts
 */
import { projectWallets } from '../src/core/helpers/importProjection';
import { calcVendorBalance } from '../src/core/helpers/walletMath';
import type { Ticket, VendorBalance, BalanceTopUp } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const t = (o: Partial<Ticket>): Ticket => ({ id: o.ticketNo || Math.random().toString(36), ticketNo: '', source: 'Ibtekar', date: '2026-11-20',
  amount: 0, commission: 0, totalDoc: 0, reqNum: '', pnr: '', passengerName: '', airlineCode: '', status: 'ISSUE', reportName: '', userId: '', ...o } as Ticket);

const ibtekar: VendorBalance = { id: 'w1', vendorName: 'Ibtekar', initialBalance: 0, currentBalance: 0, userId: '' };
const nsa: VendorBalance = { id: 'w2', vendorName: 'NSA', initialBalance: 1000, currentBalance: 0, userId: '' };
const ledger = [t({ ticketNo: 'A', amount: 500 }), t({ ticketNo: 'B', amount: 300 }), t({ ticketNo: 'N', source: 'NSA', amount: 200 })];
const topUps: BalanceTopUp[] = [{ id: 'u', vendorId: 'w1', vendorName: 'Ibtekar', amount: 2000, note: '', date: '2026-11-01', userId: '' }];

console.log('\nA. Before is the wallet as it reads now');
const none = projectWallets([ibtekar, nsa], ledger, topUps, { fresh: [], settlements: [], topUps: [] });
check('an import that touches nothing lists no wallet', none, []);

console.log('\nB. New tickets draw on their wallet');
const p = projectWallets([ibtekar, nsa], ledger, topUps, { fresh: [t({ ticketNo: 'C', amount: 400 }), t({ ticketNo: 'R', amount: -100, status: 'REFUND' })], settlements: [], topUps: [] });
check('only Ibtekar is listed', p.map(x => x.vendorName), ['Ibtekar']);
check('before = opening + top-ups - tickets', p[0].before, calcVendorBalance(ibtekar, ledger, topUps));
check('after: 1,200 less 400 plus the 100 refund', [p[0].before, p[0].after, p[0].change, p[0].rows], [1200, 900, -300, 2]);

console.log('\nC. Settlements, corrections, voided sales and top-ups');
const q = projectWallets([ibtekar, nsa], ledger, topUps, {
  fresh: [], settlements: [t({ ticketNo: 'A', id: 'A', amount: 450 })], topUps: [t({ ticketNo: 'F', source: 'Ibtekar', amount: 1000, status: 'FUND' })],
  corrections: [{ id: 'B', amount: 310, totalDoc: 310, commission: 0 }], voidedSales: [t({ ticketNo: 'N', id: 'N', source: 'NSA', amount: 200 })],
});
const ib = q.find(x => x.vendorName === 'Ibtekar')!, ns = q.find(x => x.vendorName === 'NSA')!;
check('Ibtekar: A settles 50 lower, B corrected 10 higher, a 1,000 top-up', [ib.before, ib.after, ib.change], [1200, 2240, 1040]);
check('NSA: its voided sale comes back to the wallet', [ns.before, ns.after, ns.change], [800, 1000, 200]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
