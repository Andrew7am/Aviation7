/**
 * An import preview says what it is about to overwrite.
 *
 * The count of updates is the one number on that screen that describes a
 * destructive act, and it was the only one you could not open. These check
 * that every update carries the fields it will change, that a gap being
 * filled reads differently from a value being replaced, and that a field the
 * incoming row leaves blank is never counted as a change - an import fills
 * gaps, and a report with no column for something must not read as an
 * instruction to erase it.
 */
import { detectDuplicatesAgainstExisting } from '../src/core/ImportEngine';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2),
  ticketNo: '5513427738', pnr: '', passengerName: '', airlineCode: '157',
  route: '', source: 'IATA BSP', date: '2026-09-17', amount: 3220,
  totalDoc: 3220, commission: 0, reqNum: '', status: 'ISSUE',
  currency: 'AED', isDuplicate: false, userId: 'u', ...o,
});

const run = (incoming: Ticket[], existing: Ticket[]) =>
  detectDuplicatesAgainstExisting(incoming, existing);

console.log('\n1. A gap being filled');
{
  const held = tkt({ reqNum: '' });
  const r = run([tkt({ ticketNo: held.ticketNo, reqNum: 'KSAML2325' })], [held]);
  check('it is an update, not a new row', [r.updates.length, r.fresh.length], [1, 0]);
  check('one field changes',              r.updates[0].changes?.length, 1);
  check('and it is the req number',       r.updates[0].changes?.[0].field, 'Req num');
  check('from nothing',                   r.updates[0].changes?.[0].from, '');
  check('to the incoming value',          r.updates[0].changes?.[0].to, 'KSAML2325');
}

console.log('\n2. A value being replaced');
{
  // The replacement path needs the row to differ on the duplicate key, which
  // carries the PNR. An otherwise identical row is covered in section 2b.
  const held = tkt({ reqNum: 'UAEVP711', pnr: 'XNGWTQ' });
  const r = run([tkt({ ticketNo: held.ticketNo, reqNum: 'KSAML2325', pnr: 'ZZWM3X' })], [held]);
  check('it updates',            r.updates.length, 1);
  const req = r.updates[0].changes?.find(c => c.field === 'Req num');
  check('the old value is kept', req?.from, 'UAEVP711');
  check('beside the new one',    req?.to, 'KSAML2325');
}

console.log('\n2b. An identical row with a different req is NOT an update');
{
  // Worth pinning rather than assuming. When every other field matches, a req
  // number that disagrees is more likely a mistake in the incoming report than
  // a correction to the ledger, so the engine holds the row as a duplicate and
  // keeps what it already had. Nothing is overwritten, and nothing is lost.
  const held = tkt({ reqNum: 'UAEVP711' });
  const r = run([tkt({ ticketNo: held.ticketNo, reqNum: 'KSAML2325' })], [held]);
  check('it is held, not applied', [r.updates.length, r.duplicates.length], [0, 1]);
  check('marked as a duplicate',   r.duplicates[0].isDuplicate, true);
  // Nothing is applied, so there is nothing to describe: a change list on a
  // row that will not be written would say an overwrite is coming when none
  // is. The ledger keeps UAEVP711 because the save path never sees this row.
  check('carrying no change list', r.duplicates[0].changes, undefined);
}

console.log('\n3. A blank incoming field is not a change');
{
  // Turkish's export carries route and passenger but no req column. Writing
  // req unconditionally once erased fifteen numbers typed in by hand.
  const held = tkt({ reqNum: 'UAEVP711', route: '', passengerName: '' });
  const r = run([tkt({
    ticketNo: held.ticketNo, reqNum: '', route: 'DXB/IST', passengerName: 'AHMED RASHED',
  })], [held]);
  check('it updates',                      r.updates.length, 1);
  const fields = r.updates[0].changes?.map(c => c.field).sort();
  check('only the fields it actually has', fields, ['Passenger', 'Route']);
  check('the req number is untouched',     fields?.includes('Req num'), false);
}

console.log('\n4. An identical value is not a change');
{
  const held = tkt({ reqNum: 'UAEVP711', pnr: 'XNGWTQ' });
  const r = run([tkt({ ticketNo: held.ticketNo, reqNum: 'UAEVP711', pnr: 'XNGWTQ' })], [held]);
  check('nothing to update, so it is a duplicate',
        [r.updates.length, r.duplicates.length], [0, 1]);
}

console.log('\n5. Several fields at once');
{
  const held = tkt({ reqNum: '', pnr: '', route: '', passengerName: '' });
  const r = run([tkt({
    ticketNo: held.ticketNo, reqNum: 'KSAML2053', pnr: 'ZZWM3X',
    route: 'DXB/JED', passengerName: 'SALEEM KHADER',
  })], [held]);
  check('every one is listed', r.updates[0].changes?.length, 4);
  check('each says where it came from',
        r.updates[0].changes?.every(c => c.from === ''), true);
}

console.log('\n6. A fresh row carries no change list');
{
  const r = run([tkt({ ticketNo: '9999999999', reqNum: 'KSAML2325' })], []);
  check('it is new',              [r.fresh.length, r.updates.length], [1, 0]);
  check('with nothing to report', r.fresh[0].changes, undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
