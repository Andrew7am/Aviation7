/**
 * Top-up arithmetic — money paid in must raise the balance, for EVERY vendor.
 *
 * Ibtekar used to be special-cased to an inverted sign, so a top-up moved its
 * balance down while the top-up dialog promised the opposite. These tests pin
 * the rule that made that possible: there is one formula, and no vendor gets
 * its own.
 */
import { calcVendorBalance, vendorMatchesSource } from '../src/core/helpers/walletMath';
import type { VendorBalance, BalanceTopUp } from '../src/types';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

const vendor = (name: string, initial = 0): VendorBalance =>
  ({ id: `v-${name}`, vendorName: name, initialBalance: initial, currentBalance: 0, userId: 'u' });

const topUp = (v: VendorBalance, amount: number): BalanceTopUp =>
  ({ id: `t${Math.random()}`, vendorId: v.id, vendorName: v.vendorName, amount, note: '', date: '2026-01-01', userId: 'u' });

/** Every vendor that has ever had a wallet in this ledger. */
const VENDORS = ['NSA', 'Ibtekar', 'Flynas', 'FlyAdeal KSA', 'FlyAdeal DXB',
                 'FlyDubai', 'AirArabia', 'RTS', 'Gold Medal', 'Riyadh Air',
                 'Turkish Airlines', 'IATA'];

console.log('\n1. A top-up raises the balance — for every vendor');
for (const name of VENDORS) {
  const v = vendor(name, 1000);
  const before = calcVendorBalance(v, [], []);
  const after  = calcVendorBalance(v, [], [topUp(v, 200)]);
  eq(`${name}: +200 top-up moves 1000 -> 1200`, [before, after], [1000, 1200]);
}

console.log('\n2. Issuing a ticket lowers the balance — for every vendor');
for (const name of VENDORS) {
  const v = vendor(name, 1000);
  const t = [{ source: name, amount: 300, status: 'ISSUE' }];
  eq(`${name}: a 300 ticket leaves 700`, calcVendorBalance(v, t, []), 700);
}

console.log('\n3. Ibtekar specifically — the reported bug');
{
  const ib = vendor('Ibtekar', 0);
  const tickets = [{ source: 'Ibtekar', amount: 248896.52, status: 'ISSUE' }];
  const existing = [topUp(ib, 245000)];
  const before = calcVendorBalance(ib, tickets, existing);
  const after  = calcVendorBalance(ib, tickets, [...existing, topUp(ib, 200)]);
  eq('balance before the top-up', Number(before.toFixed(2)), -3896.52);
  eq('a 200 top-up RAISES it by exactly 200', Number((after - before).toFixed(2)), 200);
  eq('and it does not flip sign', Number(after.toFixed(2)), -3696.52);
}
{
  // The user's report: 200 held, top up 200, expect 400 — not -200.
  const ib = vendor('Ibtekar', 0);
  const held = [topUp(ib, 200)];
  eq('200 held, +200 topped up = 400',
     calcVendorBalance(ib, [], [...held, topUp(ib, 200)]), 400);
}

console.log('\n4. Refunds credit the wallet back');
for (const name of ['NSA', 'Ibtekar']) {
  const v = vendor(name, 1000);
  const t = [{ source: name, amount: 300, status: 'ISSUE' }, { source: name, amount: -300, status: 'REFUND' }];
  eq(`${name}: an issue and its refund cancel out`, calcVendorBalance(v, t, []), 1000);
}

console.log('\n5. FUND rows are not double-counted as issuance');
{
  const v = vendor('NSA', 1000);
  const t = [{ source: 'NSA', amount: 500, status: 'FUND' }];
  eq('a FUND ticket does not move the balance', calcVendorBalance(v, t, []), 1000);
}

console.log('\n6. Top-ups belonging to another vendor are ignored');
{
  const a = vendor('NSA', 1000), b = vendor('Ibtekar', 1000);
  eq('NSA is unaffected by an Ibtekar top-up', calcVendorBalance(a, [], [topUp(b, 5000)]), 1000);
}

console.log('\n7. Vendor/source matching still holds');
eq('NSA matches its own rows', vendorMatchesSource('NSA', 'NSA'), true);
eq('Ibtekar does not claim NSA rows', vendorMatchesSource('Ibtekar', 'NSA'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
