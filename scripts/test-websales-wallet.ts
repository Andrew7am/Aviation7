/**
 * Guards the business rule that WEBSALES-EDIS settles separately from BSP and
 * must NOT be drawn against the IATA wallet.
 *
 * On the sample invoice that channel is 34,536.50 AED. If it ever attached to
 * the IATA vendor, that amount would silently move the balance.
 *
 * Run: npx tsx scripts/test-websales-wallet.ts
 */
import { vendorMatchesSource, calcVendorBalance } from '../src/core/helpers/walletMath';
import type { VendorBalance, BalanceTopUp } from '../src/types';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

console.log('WEBSALES-EDIS must not attach to any existing vendor wallet');
const VENDORS = ['IATA', 'IATA BSP', 'NSA', 'Ibtekar', 'RTS', 'Flynas', 'FlyDubai',
                 'FlyAdeal KSA', 'FlyAdeal DXB', 'AirArabia', 'Gold Medal',
                 'Riyadh Air', 'Turkish Airlines'];
for (const v of VENDORS) {
  check(`${v} does not claim WEBSALES-EDIS`,
    vendorMatchesSource(v, 'WEBSALES-EDIS'), false);
}

console.log('\nBSP rows still attach to the IATA wallet as before');
check('IATA claims "IATA BSP"', vendorMatchesSource('IATA', 'IATA BSP'), true);

console.log('\nBalance is unmoved by web sales sitting in the ledger');
const iata: VendorBalance = {
  id: 'v_iata', vendorName: 'IATA', initialBalance: 100000, currentBalance: 0, userId: 'u',
};
const topUps: BalanceTopUp[] = [];
const bspOnly = [
  { source: 'IATA BSP', amount: 3923.20, status: 'ISSUE' },
  { source: 'IATA BSP', amount: -1760.00, status: 'REFUND' },
];
const withWeb = [
  ...bspOnly,
  { source: 'WEBSALES-EDIS', amount: 4150.80, status: 'ISSUE' },
  { source: 'WEBSALES-EDIS', amount: 10179.10, status: 'ISSUE' },
  { source: 'WEBSALES-EDIS', amount: 19656.60, status: 'ISSUE' },
  { source: 'WEBSALES-EDIS', amount: 580.00, status: 'ISSUE' },
  { source: 'WEBSALES-EDIS', amount: -30.00, status: 'REFUND' },
];
const before = calcVendorBalance(iata, bspOnly, topUps);
const after = calcVendorBalance(iata, withWeb, topUps);
console.log(`  BSP only            : ${before.toFixed(2)}`);
console.log(`  BSP + 34,536.50 web : ${after.toFixed(2)}`);
check('web sales leave the IATA balance untouched', after, before);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
