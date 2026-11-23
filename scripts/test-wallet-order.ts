/** Vendor Credit's order, and a payment's date.  npx tsx scripts/test-wallet-order.ts */
import { orderWallets, moveItem, isPaymentDay } from '../src/core/helpers/walletOrder';
import { applyAppSettings, configuredWalletOrder } from '../src/core/config/appSettings';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const w = ['a', 'b', 'c', 'd'].map(id => ({ id }));
const ids = (x: { id: string }[]) => x.map(y => y.id).join('');

check('no order saved: as read', ids(orderWallets(w, [])), 'abcd');
check('the order saved', ids(orderWallets(w, ['d', 'b', 'a', 'c'])), 'dbac');
check('a wallet opened since goes last', ids(orderWallets(w, ['d', 'b'])), 'dbac');
check('a wallet deleted since is passed over', ids(orderWallets(w, ['x', 'c', 'y', 'a'])), 'cabd');
const before = ids(w); orderWallets(w, ['d']);
check('the wallets themselves are not moved', ids(w), before);
check('up', moveItem([1, 2, 3], 2, 1), [1, 3, 2]);
check('down', moveItem([1, 2, 3], 0, 1), [2, 1, 3]);
check('to the top', moveItem([1, 2, 3], 2, 0), [3, 1, 2]);
check('past the end does nothing', moveItem([1, 2, 3], 2, 3), [1, 2, 3]);
check('a day before', isPaymentDay('2026-11-20', '2026-11-23'), true);
check('today', isPaymentDay('2026-11-23', '2026-11-23'), true);
check('tomorrow', isPaymentDay('2026-11-24', '2026-11-23'), false);
check('no date', isPaymentDay('', '2026-11-23'), false);
check('a day that does not exist', isPaymentDay('2026-02-30', '2026-11-23'), false);
applyAppSettings([{ key: 'wallet_order', value: ['b', 'a', 7] }]);
check('the order is read from the settings', configuredWalletOrder(), ['b', 'a']);
applyAppSettings([{ key: 'vendors', value: [] }]);
check('saving the Settings screen keeps it', configuredWalletOrder(), ['b', 'a']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
