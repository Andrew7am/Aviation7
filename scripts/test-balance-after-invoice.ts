/**
 * The agency's week, end to end, as arithmetic.
 *
 * "I have 100,000 on the balance. I upload the TJQ, it is 20,000, so the
 * balance reads 80,000. Then the IATA invoice comes and whatever number it
 * says is the one we go by, because it has the refunds and the ADMs on it."
 *
 * That is the rule this checks. The sales report is the running view; the
 * invoice is the account. When they disagree the invoice wins, and the balance
 * follows the invoice — not the sum of both, which would charge every ticket
 * twice.
 *
 * Run: npx tsx scripts/test-balance-after-invoice.ts
 */
import { detectDuplicatesAgainstExisting, mergeImported } from '../src/core/ImportEngine';
import { calcVendorBalance } from '../src/core/helpers/walletMath';
import type { Ticket, VendorBalance } from '../src/types';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const OPENED = '2026-09-01';
const wallet: VendorBalance = {
  id: 'w', vendorName: 'IATA', initialBalance: 100000, currentBalance: 100000,
  userId: 'u', openingDate: OPENED,
};

const doc = (o: Partial<Ticket>): Ticket => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  ticketNo: '5513059100', source: 'IATA BSP', date: '2026-09-03',
  amount: 0, commission: 0, totalDoc: 0, reqNum: 'REQ', status: 'ISSUE',
  userId: 'u', ...o,
});

console.log('\n--- Monday to Thursday: the sales report ---');
// Four tickets, 20,000 between them, exactly as the TJQ reports them: no
// commission, and a date taken from the report's own range.
const salesReport: Ticket[] = [
  doc({ id: 's1', ticketNo: '5513059101', amount: 6000, totalDoc: 6000, serial: 7001, pnr: 'AAA111' }),
  doc({ id: 's2', ticketNo: '5513059102', amount: 5000, totalDoc: 5000, serial: 7002, pnr: 'BBB222' }),
  doc({ id: 's3', ticketNo: '5513059103', amount: 5000, totalDoc: 5000, serial: 7003, pnr: 'CCC333' }),
  doc({ id: 's4', ticketNo: '5513059104', amount: 4000, totalDoc: 4000, serial: 7004, pnr: 'DDD444' }),
];
let ledger = mergeImported([], salesReport, [], []);
const afterSales = calcVendorBalance(wallet, ledger, []);
console.log(`  four tickets totalling ${money(20000)}`);
check('balance reads 80,000 after the sales report', afterSales, 80000);

console.log('\n--- Friday: the BSP invoice ---');
// The invoice restates all four — one of them for less than the report said,
// and every one of them now carrying commission. It also brings two documents
// the report never showed: a refund raised as an RA, and a debit memo.
const invoice: Ticket[] = [
  doc({ ticketNo: '5513059101', amount: 6000, totalDoc: 6000, commission: 300, channel: 'BSP' }),
  doc({ ticketNo: '5513059102', amount: 5000, totalDoc: 5000, commission: 250, channel: 'BSP' }),
  doc({ ticketNo: '5513059103', amount: 4500, totalDoc: 5000, commission: 225, channel: 'BSP' }),
  doc({ ticketNo: '5513059104', amount: 4000, totalDoc: 4000, commission: 200, channel: 'BSP' }),
  doc({ ticketNo: '5513059105', amount: -3000, totalDoc: 3000, status: 'REFUND', channel: 'BSP' }),
  doc({ ticketNo: '6000099001', amount: 750, totalDoc: 750, status: 'ADM', channel: 'BSP' }),
];

const r = detectDuplicatesAgainstExisting(invoice, ledger);
console.log(`  settles ${r.settlements.length}, adds ${r.fresh.length}, duplicates ${r.duplicates.length}`);
check('the four reported tickets are settled, not duplicated', r.settlements.length, 4);
check('the refund and the memo are added', r.fresh.length, 2);
check('nothing is thrown away as a duplicate', r.duplicates.length, 0);

ledger = mergeImported(ledger, r.fresh, r.updates, r.settlements);
check('the ledger holds six documents, not ten', ledger.length, 6);

// 6000 + 5000 + 4500 + 4000 = 19,500 of tickets, less a 3,000 refund,
// plus a 750 debit memo = 17,250 drawn on the balance.
const afterInvoice = calcVendorBalance(wallet, ledger, []);
console.log(`  invoice: 19,500 issued − 3,000 refunded + 750 memo = ${money(17250)}`);
check('the balance follows the invoice', afterInvoice, 100000 - 17250);
check('it is NOT the report and the invoice added together',
  afterInvoice !== 100000 - 20000 - 17250, true);

console.log('\n--- what the settled rows kept and what they took ---');
const settled = ledger.find(t => t.ticketNo === '5513059103')!;
check('the corrected amount came from the invoice', settled.amount, 4500);
check('the commission came from the invoice', settled.commission, 225);
check('the serial the report gave is still there', settled.serial, 7003);
check('the PNR the report gave is still there', settled.pnr, 'CCC333');
check('the settlement channel is recorded', settled.channel, 'BSP');

console.log('\n--- topping up after all that ---');
const topUps = [{ id: 'tu', vendorId: 'w', vendorName: 'IATA', amount: 50000,
                  note: 'transfer', date: '2026-09-06', userId: 'u' }];
check('a top-up raises the balance by exactly what was paid in',
  calcVendorBalance(wallet, ledger, topUps), 100000 - 17250 + 50000);

console.log('\n--- re-uploading either file changes nothing ---');
const again = detectDuplicatesAgainstExisting(invoice, ledger);
check('the same invoice settles nothing a second time', again.settlements.length, 0);
check('and adds nothing', again.fresh.length, 0);
check('the balance is unmoved',
  calcVendorBalance(wallet, mergeImported(ledger, again.fresh, again.updates, again.settlements), []),
  100000 - 17250);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
