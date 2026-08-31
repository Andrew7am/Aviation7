/**
 * Folding a saved import into the list already on screen.
 *
 * The point is speed — an upload appears immediately instead of waiting on a
 * per-row realtime burst, a debounce, and a full re-download of the table. So
 * the merge has to land the same values the save path wrote, or the list would
 * be briefly wrong until the refetch corrected it.
 */
import { mergeImported } from '../src/core/ImportEngine';
import type { Ticket } from '../src/types';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

const mk = (o: Partial<Ticket>): Ticket => ({
  id: 'x', ticketNo: '2540225922', source: 'Turkish Airlines', airlineCode: '235',
  date: '2026-08-23', amount: 2940, commission: 0, totalDoc: 2940,
  reqNum: '', status: 'ISSUE', currency: 'AED', pnr: 'SF4JXT', userId: 'u', ...o,
});

const existing = [
  mk({ id: 'a', ticketNo: '1111111111', reqNum: 'REQ-A' }),
  mk({ id: 'b', ticketNo: '2222222222', reqNum: '' }),
];

console.log('\n1. Fresh rows appear straight away');
{
  const fresh = [mk({ id: 'c', ticketNo: '3333333333' }), mk({ id: 'd', ticketNo: '4444444444' })];
  const out = mergeImported(existing, fresh);
  eq('both are added', out.length, 4);
  eq('the new ids are there', out.map(t => t.id).sort(), ['a', 'b', 'c', 'd']);
  eq('the originals are untouched', out.find(t => t.id === 'a')?.reqNum, 'REQ-A');
}

console.log('\n2. The list is not duplicated when a row is already present');
{
  const again = [mk({ id: 'a', ticketNo: '1111111111', reqNum: 'REQ-A2' })];
  const out = mergeImported(existing, again);
  eq('still two rows', out.length, 2);
  eq('the row is replaced, not appended', out.find(t => t.id === 'a')?.reqNum, 'REQ-A2');
}

console.log('\n3. `updates` touch ONLY the req number and serial');
{
  // saveImport patches req_num and serial and nothing else — the merge must
  // not quietly apply the rest of the incoming row.
  const upd = [mk({ id: 'b', reqNum: 'REQ-B', serial: 77, amount: 999999, source: 'WRONG' })];
  const out = mergeImported(existing, [], upd);
  const b = out.find(t => t.id === 'b')!;
  eq('req number applied', b.reqNum, 'REQ-B');
  eq('serial applied', b.serial, 77);
  eq('amount NOT touched', b.amount, 2940);
  eq('vendor NOT touched', b.source, 'Turkish Airlines');
}

console.log('\n4. Settlements carry the invoice money onto the existing row');
{
  const settle = [mk({
    id: 'a', amount: 2881, commission: 59, totalDoc: 2940,
    date: '2026-08-24', status: 'ISSUE', channel: 'WEBSALES-EDIS', reqNum: 'REQ-A',
  })];
  const out = mergeImported(existing, [], [], settle);
  const a = out.find(t => t.id === 'a')!;
  eq('no extra row is created', out.length, 2);
  eq('payable applied', a.amount, 2881);
  eq('commission applied', a.commission, 59);
  eq('date applied', a.date, '2026-08-24');
  eq('the real channel is kept, not forced to BSP', a.channel, 'WEBSALES-EDIS');
  eq('vendor still the issuing portal', a.source, 'Turkish Airlines');
  eq('passenger detail kept', a.pnr, 'SF4JXT');
}
{
  const settle = [mk({ id: 'a', amount: 100, commission: 5, totalDoc: 105, date: '2026-08-24', reqNum: 'REQ-A' })];
  const a = mergeImported(existing, [], [], settle).find(t => t.id === 'a')!;
  eq('channel defaults to BSP when the invoice states none', a.channel, 'BSP');
}

console.log('\n5. A group naming a row that is not there changes nothing');
{
  const out = mergeImported(existing, [], [mk({ id: 'ghost', reqNum: 'X' })], [mk({ id: 'ghost2' })]);
  eq('no phantom rows appear', out.length, 2);
  eq('ids unchanged', out.map(t => t.id).sort(), ['a', 'b']);
}

console.log('\n6. All three groups together');
{
  const fresh  = [mk({ id: 'c', ticketNo: '3333333333' })];
  const upd    = [mk({ id: 'b', reqNum: 'REQ-B' })];
  const settle = [mk({ id: 'a', amount: 2881, commission: 59, totalDoc: 2940, date: '2026-08-24', reqNum: 'REQ-A' })];
  const out = mergeImported(existing, fresh, upd, settle);
  eq('one row added, two patched', out.length, 3);
  eq('  settled row', out.find(t => t.id === 'a')?.amount, 2881);
  eq('  updated row', out.find(t => t.id === 'b')?.reqNum, 'REQ-B');
  eq('  fresh row', out.find(t => t.id === 'c')?.ticketNo, '3333333333');
}

console.log('\n7. An update FILLS gaps and never blanks what is held');
{
  // The report that prompted this rule carries route and passenger name but
  // leaves req num empty. Writing every field unconditionally erased fifteen
  // req numbers the agency had typed in by hand.
  const held = [mk({ id: 'h', reqNum: 'KSAML2064', pnr: 'SF4JXT', route: 'JED-IST-JED', passengerName: 'HELD NAME' })];
  const incoming = mk({ id: 'h', reqNum: '', pnr: '', route: '', passengerName: '' });
  const out = mergeImported(held, [], [incoming]);
  const h = out.find(t => t.id === 'h')!;
  eq('req number survives an empty one', h.reqNum, 'KSAML2064');
  eq('route survives', h.route, 'JED-IST-JED');
  eq('passenger survives', h.passengerName, 'HELD NAME');
  eq('PNR survives', h.pnr, 'SF4JXT');
}
{
  const bare = [mk({ id: 'b2', reqNum: '', route: '', passengerName: '' })];
  const rich = mk({ id: 'b2', reqNum: 'REQ-NEW', route: 'MED-IST-MED', passengerName: 'NEW NAME' });
  const b = mergeImported(bare, [], [rich]).find(t => t.id === 'b2')!;
  eq('an empty field is filled', b.route, 'MED-IST-MED');
  eq('  ...passenger too', b.passengerName, 'NEW NAME');
  eq('  ...and req num', b.reqNum, 'REQ-NEW');
}

console.log('\n8. The input list is not mutated');
{
  const before = JSON.stringify(existing);
  mergeImported(existing, [mk({ id: 'z' })], [mk({ id: 'a', reqNum: 'ZZZ' })]);
  eq('caller state untouched', JSON.stringify(existing), before);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
