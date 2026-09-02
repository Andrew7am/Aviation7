/**
 * A balance opened today is not charged for tickets settled months ago.
 *
 * Adding an IATA opening balance of 817,284.78 immediately met 1,884 tickets
 * worth 6.29 million that had been paid for long before it existed, and
 * reported the account 5.4 million in the red. These pin the rule that fixed
 * it, including the case where no date is set — which every wallet opened
 * alongside the data relies on.
 *
 * Run: npx tsx scripts/test-wallet-opening-date.ts
 */
import { calcVendorBalance, drawsOnWallet, undatedSkipped } from '../src/core/helpers/walletMath';
import type { VendorBalance } from '../src/types';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

const wallet = (openingDate?: string): VendorBalance => ({
  id: 'w', vendorName: 'IATA', initialBalance: 1000, currentBalance: 1000,
  userId: 'u', openingDate,
});
const t = (date: string, amount = 100) => ({ source: 'IATA BSP', amount, status: 'ISSUE', date });

console.log('\n1. Which tickets a dated wallet is charged for');
{
  const w = { openingDate: '2026-09-02' };
  check('the day before is not charged', drawsOnWallet(w, '2026-09-01'), false);
  check('the opening day itself IS charged', drawsOnWallet(w, '2026-09-02'), true);
  check('the day after is charged', drawsOnWallet(w, '2026-09-03'), true);
  check('a ticket with no date is not charged', drawsOnWallet(w, ''), false);
  check('a timestamp is read as its date', drawsOnWallet(w, '2026-09-05T11:00:00Z'), true);
}

console.log('\n2. A wallet with no opening date is charged for everything');
{
  const w = { openingDate: undefined };
  check('an old ticket is charged', drawsOnWallet(w, '2020-01-01'), true);
  check('an undated ticket is charged', drawsOnWallet(w, ''), true);
  check('an empty string date on the wallet means the same', drawsOnWallet({ openingDate: '' }, ''), true);
}

console.log('\n3. The balance itself');
{
  const tickets = [t('2026-08-01', 5000), t('2026-09-02', 300), t('2026-09-10', 200)];
  check('dated wallet charges only what came after',
    calcVendorBalance(wallet('2026-09-02'), tickets, []), 1000 - 500);
  check('undated wallet charges the lot',
    calcVendorBalance(wallet(), tickets, []), 1000 - 5500);
}

console.log('\n4. Top-ups still raise the balance either way');
{
  const topUps = [{ id: 'tu', vendorId: 'w', vendorName: 'IATA', amount: 400, note: '', date: '2026-09-03', userId: 'u' }];
  check('with an opening date',
    calcVendorBalance(wallet('2026-09-02'), [t('2026-09-05', 100)], topUps), 1000 + 400 - 100);
  check('without one',
    calcVendorBalance(wallet(), [t('2026-09-05', 100)], topUps), 1000 + 400 - 100);
}

console.log('\n5. Refunds still raise the balance, on both sides of the date');
{
  check('a refund after the opening day gives credit back',
    calcVendorBalance(wallet('2026-09-02'), [t('2026-09-05', -250)], []), 1250);
  check('a refund before it does not touch the balance',
    calcVendorBalance(wallet('2026-09-02'), [t('2026-08-05', -250)], []), 1000);
}

console.log('\n6. Skipped undated tickets are reported, not hidden');
{
  const tickets = [t('', 500), t('', 300), t('2026-09-05', 100)];
  check('counted', undatedSkipped(wallet('2026-09-02'), tickets), { count: 2, amount: 800 });
  check('nothing to report when the wallet has no date',
    undatedSkipped(wallet(), tickets), { count: 0, amount: 0 });
}

console.log('\n7. Tickets from another vendor are never charged to this wallet');
{
  const foreign = [{ source: 'NSA', amount: 9999, status: 'ISSUE', date: '2026-09-05' }];
  check('NSA does not touch the IATA wallet',
    calcVendorBalance(wallet('2026-09-02'), foreign, []), 1000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
