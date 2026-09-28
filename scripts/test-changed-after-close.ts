/**
 * Money that moved after a ticket was closed.
 *
 * Closing means the figure was settled with the client. A change afterwards
 * is one the client has not seen — sometimes right, never something that
 * should happen without anybody noticing. Eleven such edits were in the log
 * and nothing on screen said so.
 *
 * The two events are logged under different identities for the same
 * ticket: a close records the ticket's id (a bulk close a list of them,
 * which the undo feature depends on), an edit records its document number.
 * Every case below is really a test that the two are tied together
 * correctly.
 */
import { changedAfterClose, closes, AuditEvent } from '../src/core/helpers/changedAfterClose';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const T = [
  { id: 'id-a', ticketNo: '4861679579' },
  { id: 'id-b', ticketNo: '065-4861679594' },
  { id: 'id-c', ticketNo: '4862083218', amount: 1844.12 },       // an issue...
  { id: 'id-c-rfd', ticketNo: '4862083218', amount: -1603.67 },  // ...and its refund, same number
];

const close = (ids: string, at: string, bulk = false): AuditEvent => ({
  action: bulk ? 'BULK_UPDATE_CLOSED' : 'UPDATE_CLOSED',
  entity: ids, detail: bulk ? `Closed (${ids.split(',').length} tickets)` : 'Closed',
  performedAt: at,
});
const reopen = (ids: string, at: string): AuditEvent => ({
  action: 'UPDATE_CLOSED', entity: ids, detail: 'Not Closed', performedAt: at,
});
const edit = (ticketNo: string, detail: string, at: string, by = 'someone@x'): AuditEvent => ({
  action: 'EDIT_TICKET', entity: ticketNo, detail, performedAt: at, actorEmail: by,
});

console.log('\n1. Reading a close entry');
{
  check('"Closed" closes', closes('Closed'), true);
  check('"Closed (42 tickets)" closes', closes('Closed (42 tickets)'), true);
  check('"Not Closed" reopens', closes('Not Closed'), false);
  check('"Not Closed (14 tickets)" reopens', closes('Not Closed (14 tickets)'), false);
  // An undo writes "Closed (3 tickets) undo of audit_..." and must still read.
  check('an undo still reads as what it did', closes('Closed (3 tickets) undo of audit_1'), true);
  check('anything else is neither', closes('Edited: route'), null);
}

console.log('\n2. The case in the log: closed on the 10th, the fee added on the 14th');
{
  const r = changedAfterClose([
    close('id-a', '2026-09-10T10:26:00Z'),
    edit('4861679579', 'amount: 1000.5 -> 1011', '2026-09-14T10:42:00Z', 'accounting3@x'),
  ], T);
  check('flagged', r.has('id-a'), true);
  check('with when it was closed', r.get('id-a')?.closedAt, '2026-09-10T10:26:00Z');
  check('what changed', r.get('id-a')?.changes[0].detail, 'amount: 1000.5 -> 1011');
  check('and who', r.get('id-a')?.changes[0].by, 'accounting3@x');
}

console.log('\n3. An edit BEFORE the close is ordinary work');
{
  const r = changedAfterClose([
    edit('4861679579', 'amount: 1000.5 -> 1011', '2026-09-09T10:00:00Z'),
    close('id-a', '2026-09-10T10:26:00Z'),
  ], T);
  check('not flagged', r.has('id-a'), false);
}

console.log('\n4. The two identities are tied together');
{
  /* The close names the ticket by id and the edit by number — and the
     number can be punctuated either way. */
  const r = changedAfterClose([
    close('id-b', '2026-09-10T10:27:00Z'),
    edit('4861679594', 'amount: 596.85 -> 607', '2026-09-14T10:43:00Z'),
  ], T);
  check('an unpunctuated edit finds a prefixed ticket', r.has('id-b'), true);
}

console.log('\n5. A bulk close counts for every ticket in it');
{
  const r = changedAfterClose([
    close('id-a,id-b', '2026-09-10T10:00:00Z', true),
    edit('4861679594', 'amount: 596.85 -> 607', '2026-09-14T10:43:00Z'),
  ], T);
  check('the second of the pair', r.has('id-b'), true);
  check('not the first, which was not edited', r.has('id-a'), false);
}

console.log('\n6. Reopening is the permission to change it');
{
  const r = changedAfterClose([
    close('id-a', '2026-09-10T10:00:00Z'),
    reopen('id-a', '2026-09-12T10:00:00Z'),
    edit('4861679579', 'amount: 1000.5 -> 1011', '2026-09-14T10:42:00Z'),
    close('id-a', '2026-09-15T10:00:00Z'),
  ], T);
  check('an edit while reopened is not flagged', r.has('id-a'), false);

  // ...but one after the re-close is.
  const r2 = changedAfterClose([
    close('id-a', '2026-09-10T10:00:00Z'),
    reopen('id-a', '2026-09-12T10:00:00Z'),
    close('id-a', '2026-09-15T10:00:00Z'),
    edit('4861679579', 'amount: 1011 -> 1020', '2026-09-16T10:00:00Z'),
  ], T);
  check('an edit after the re-close is', r2.has('id-a'), true);
  check('  ...measured from the latest close', r2.get('id-a')?.closedAt, '2026-09-15T10:00:00Z');
}

console.log('\n7. Only money');
{
  /* A passenger name or a route filled in after closing changes nothing
     the client was charged. Flagging it would bury the eleven that matter
     under hundreds that do not. */
  const r = changedAfterClose([
    close('id-a', '2026-09-10T10:00:00Z'),
    edit('4861679579', 'route: (empty) -> JED-RUH', '2026-09-14T10:00:00Z'),
    edit('4861679579', 'passengerName: (empty) -> X', '2026-09-14T10:01:00Z'),
    edit('4861679579', 'closed: false -> true', '2026-09-14T10:02:00Z'),
  ], T);
  check('route, name and closed are not flagged', r.has('id-a'), false);

  for (const d of ['amount: 1 -> 2', 'commission: 0 -> 5', 'total_doc: 1 -> 2'])
    check(`"${d.split(':')[0]}" is`, changedAfterClose(
      [close('id-a', '2026-09-10T00:00:00Z'), edit('4861679579', d, '2026-09-11T00:00:00Z')], T)
      .has('id-a'), true);
}

console.log('\n8. Several changes are kept, in order');
{
  const r = changedAfterClose([
    edit('4861679579', 'amount: 1011 -> 1020', '2026-09-16T10:00:00Z'),  // out of order on purpose
    close('id-a', '2026-09-10T10:00:00Z'),
    edit('4861679579', 'amount: 1000.5 -> 1011', '2026-09-14T10:00:00Z'),
  ], T);
  check('two changes', r.get('id-a')?.changes.length, 2);
  check('oldest first', r.get('id-a')?.changes.map(c => c.detail),
        ['amount: 1000.5 -> 1011', 'amount: 1011 -> 1020']);
}

console.log('\n9. One number, two rows');
{
  /* An issue and the refund against it share a document number. An edit
     logged by that number is checked against both — each against its own
     close. */
  const r = changedAfterClose([
    close('id-c', '2026-09-20T00:00:00Z'),
    edit('4862083218', 'amount: 1833.67 -> 1844.12', '2026-09-28T07:09:00Z', 'system'),
  ], T);
  check('the closed issue is flagged', r.has('id-c'), true);
  check('the refund, never closed, is not', r.has('id-c-rfd'), false);
}

console.log('\n10. What cannot be resolved is left alone');
{
  // A close for a ticket since deleted, and an edit to a number nobody holds.
  const r = changedAfterClose([
    close('id-gone', '2026-09-10T00:00:00Z'),
    edit('9999999999', 'amount: 1 -> 2', '2026-09-11T00:00:00Z'),
  ], T);
  check('nothing flagged', r.size, 0);
  check('and nothing to say with no log at all', changedAfterClose([], T).size, 0);
}

console.log('\n11. One edit, logged twice, is one edit');
{
  /* The database trigger writes "amount: 1000.5 -> 1011" and the app writes
     "Edited: amount=1011" for the same change, a second apart. Counted as
     two, every edited ticket reads as changed twice. */
  const r = changedAfterClose([
    close('id-a', '2026-09-10T10:26:00Z'),
    edit('4861679579', 'Edited: amount=1011', '2026-09-14T10:42:00Z'),
    edit('4861679579', 'amount: 1000.5 -> 1011', '2026-09-14T10:42:01Z'),
  ], T);
  check('one change', r.get('id-a')?.changes.length, 1);
  check('  ...and it is the line that says what it was',
        r.get('id-a')?.changes[0].detail, 'amount: 1000.5 -> 1011');

  const r2 = changedAfterClose([
    close('id-a', '2026-09-10T10:26:00Z'),
    edit('4861679579', 'amount: 1000.5 -> 1011', '2026-09-14T10:42:00Z'),
    edit('4861679579', 'Edited: amount=1011', '2026-09-14T10:42:01Z'),
  ], T);
  check('either order', r2.get('id-a')?.changes.map(c => c.detail), ['amount: 1000.5 -> 1011']);

  const r3 = changedAfterClose([
    close('id-a', '2026-09-10T10:26:00Z'),
    edit('4861679579', 'amount: 1000.5 -> 1011', '2026-09-14T10:42:00Z'),
    edit('4861679579', 'amount: 1011 -> 1020', '2026-09-14T10:50:00Z'),
  ], T);
  check('two edits minutes apart stay two', r3.get('id-a')?.changes.length, 2);
}

console.log('\n12. The sign says which of two rows an edit was for');
{
  /* An issue and its refund share a number, and both were closed together.
     The edit left a positive figure, so it was the issue's. Flagging the
     refund too would report a change to a row nobody touched. */
  const r = changedAfterClose([
    close('id-c,id-c-rfd', '2026-09-24T14:19:00Z', true),
    edit('4862083218', 'amount: 1833.67 -> 1844.12', '2026-09-28T07:09:00Z', 'system'),
  ], T);
  check('the issue is flagged', r.has('id-c'), true);
  check('the refund is not', r.has('id-c-rfd'), false);

  const r2 = changedAfterClose([
    close('id-c,id-c-rfd', '2026-09-24T14:19:00Z', true),
    edit('4862083218', 'amount: -1603.67 -> -1600', '2026-09-28T07:09:00Z'),
  ], T);
  check("a negative edit is the refund's", [r2.has('id-c'), r2.has('id-c-rfd')], [false, true]);

  // An edit naming no figure cannot be placed, so both are checked.
  const r3 = changedAfterClose([
    close('id-c,id-c-rfd', '2026-09-24T14:19:00Z', true),
    edit('4862083218', 'commission: 0 -> 5', '2026-09-28T07:09:00Z'),
  ], T);
  check('no figure named, both checked', [r3.has('id-c'), r3.has('id-c-rfd')], [true, true]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
