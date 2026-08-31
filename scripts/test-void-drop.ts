/**
 * Voided documents are discarded on import, never stored.
 *
 * VOID covers the vendors' cancellation vocabulary and every one of them
 * settles at zero, so the row carries no money and no obligation. What must
 * NOT be swept up with them is a zero-amount row that is not a cancellation —
 * a free ticket, or a fare the report failed to state — because that is a real
 * document with a real problem, and it has to stay visible.
 */
import { normalizeStatus, isVoidRow, statusToAmount } from '../src/core/helpers/normalizeStatus';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

console.log('\n1. Every cancellation word the vendors use is a void');
for (const s of ['VOID', 'CANN', 'CANX', 'CANCEL', 'CANCELLED', 'RFNX']) {
  eq(`${s} is dropped`, isVoidRow({ status: s }), true);
}
console.log('  (and each settles at zero)');
for (const s of ['VOID', 'CANN', 'CANX', 'CANCEL', 'CANCELLED', 'RFNX']) {
  eq(`  ${s} -> 0`, statusToAmount(5000, normalizeStatus(s)), 0);
}

console.log('\n2. Case and spacing do not let one through');
eq('lower case "void"',   isVoidRow({ status: 'void' }), true);
eq('padded " CANX "',     isVoidRow({ status: ' CANX ' }), true);
eq('mixed "CanN"',        isVoidRow({ status: 'CanN' }), true);

console.log('\n3. Real documents are NOT dropped');
for (const s of ['ISSUE', 'TKTT', 'REFUND', 'RFND', 'FUND', 'ADM', 'ACM', 'EMDS', 'EMDA']) {
  eq(`${s} is kept`, isVoidRow({ status: s }), false);
}

console.log('\n4. A zero amount is not by itself a reason to drop');
eq('a zero-fare ISSUE is kept', isVoidRow({ status: 'ISSUE' }), false);
eq('  ...even though it stores as 0', statusToAmount(0, normalizeStatus('ISSUE')), 0);
eq('an unknown status is kept', isVoidRow({ status: 'SOMETHING' }), false);
eq('a missing status is kept', isVoidRow({}), false);

console.log('\n5. The filter as the import applies it');
{
  const rows = [
    { ticketNo: 'A', status: 'ISSUE',  amount: 1000 },
    { ticketNo: 'B', status: 'CANX',   amount: 0 },
    { ticketNo: 'C', status: 'REFUND', amount: -500 },
    { ticketNo: 'D', status: 'VOID',   amount: 0 },
    { ticketNo: 'E', status: 'RFNX',   amount: 0 },
    { ticketNo: 'F', status: 'ISSUE',  amount: 0 },
    { ticketNo: 'G', status: 'FUND',   amount: 2000 },
  ];
  const dropped = rows.filter(r => r.status !== 'FUND' && isVoidRow(r)).map(r => r.ticketNo);
  const kept    = rows.filter(r => r.status !== 'FUND' && !isVoidRow(r)).map(r => r.ticketNo);
  eq('dropped', dropped, ['B', 'D', 'E']);
  eq('kept',    kept,    ['A', 'C', 'F']);
  eq('top-ups are handled separately, not dropped',
     rows.filter(r => r.status === 'FUND').map(r => r.ticketNo), ['G']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
