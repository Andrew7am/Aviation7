/**
 * Import preview verdicts.
 *
 * The rule under test: a refund is never measured against the issue it
 * reverses. Those two are supposed to differ, so reporting a fare difference
 * on every refund said nothing and buried the differences that mattered.
 */
import { classifyAgainstExisting } from '../src/core/ImportEngine';
import type { Ticket } from '../src/types';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

const mk = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2),
  ticketNo: '5512369276', source: 'IATA BSP', airlineCode: '235',
  date: '2026-03-31', amount: 3350, commission: 0, totalDoc: 3350,
  reqNum: 'KSAML1271', status: 'ISSUE', currency: 'SAR', pnr: 'ZR763T',
  userId: 'u', ...o,
});

/** The sale already in the ledger. */
const issue = mk({ id: 'issue-1' });

console.log('\n1. A refund uploaded against an existing issue');
{
  const refund = mk({ id: 'r1', status: 'REFUND', amount: -3320, totalDoc: 3320, date: '2026-04-14' });
  const [row] = classifyAgainstExisting([refund], [issue]);
  eq('is NOT reported as a fare difference', row.cls === 'FARE_DIFF', false);
  eq('is NOT reported as a payable difference', row.cls === 'PAYABLE_DIFF', false);
  eq('is simply new', row.cls, 'NEW');
  eq('and is not paired with the issue', row.existing, undefined);
}

console.log('\n2. Re-uploading a refund the ledger already holds');
{
  const saved  = mk({ id: 'saved-r', status: 'REFUND', amount: -3320, totalDoc: 3320, date: '2026-04-14' });
  const again  = mk({ id: 'again-r', status: 'REFUND', amount: -3320, totalDoc: 3320, date: '2026-04-14' });
  const [row] = classifyAgainstExisting([again], [issue, saved]);
  eq('matches the saved refund, not the issue', row.existing?.id, 'saved-r');
  eq('and reads as an exact match', row.cls, 'EXACT_MATCH');
}

console.log('\n3. A refund that genuinely disagrees with the stored refund');
{
  const saved = mk({ id: 'saved-r', status: 'REFUND', amount: -3320, totalDoc: 3320 });
  const worse = mk({ id: 'new-r',  status: 'REFUND', amount: -3000, totalDoc: 3000 });
  const [row] = classifyAgainstExisting([worse], [issue, saved]);
  eq('the real difference is still reported', row.cls, 'FARE_DIFF');
  eq('  ...measured against the refund', row.existing?.id, 'saved-r');
}

console.log('\n4. An issue is never measured against a refund either');
{
  const savedRefund = mk({ id: 'saved-r', status: 'REFUND', amount: -3320, totalDoc: 3320 });
  const newIssue    = mk({ id: 'i2' });
  const [row] = classifyAgainstExisting([newIssue], [savedRefund]);
  eq('a sale with only a refund on file is new', row.cls, 'NEW');
  eq('  ...and unpaired', row.existing, undefined);
}

console.log('\n5. Real findings on an issue still surface');
{
  const withComm = mk({ id: 'inv', commission: 34.4, amount: 3315.6 });
  const [row] = classifyAgainstExisting([withComm], [issue]);
  eq('commission the ledger lacks is reported', row.cls, 'COMMISSION_MISSING');
  eq('  ...against the issue', row.existing?.id, 'issue-1');
}
{
  const dearer = mk({ id: 'd', totalDoc: 4000, amount: 4000 });
  const [row] = classifyAgainstExisting([dearer], [issue]);
  eq('a genuine fare difference is reported', row.cls, 'FARE_DIFF');
}

console.log('\n6. A document the ledger has never seen');
{
  const other = mk({ id: 'o', ticketNo: '9999999999' });
  const [row] = classifyAgainstExisting([other], [issue]);
  eq('is new', row.cls, 'NEW');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
