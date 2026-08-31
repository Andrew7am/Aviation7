/**
 * The weekly workflow: issue on a portal, upload it daily to watch what is
 * running, then upload the BSP billing at the end of the week. Both files
 * carry the SAME documents.
 *
 * That is ONE sale, so it must end up as ONE row. Keeping both would double
 * the money — 25 documents in this ledger were showing 454,371.30 against
 * 229,860.00 of real sales. The invoice supersedes the portal row: it alone
 * states the commission and the balance actually payable.
 */
import { detectDuplicates, detectDuplicatesAgainstExisting } from '../src/core/ImportEngine';
import type { Ticket } from '../src/types';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

const mk = (o: Partial<Ticket>): Ticket => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  ticketNo: '2540225922', source: 'Turkish Airlines', airlineCode: '235',
  date: '2026-08-23', amount: 2940, commission: 0, totalDoc: 2940,
  reqNum: 'KSAML2064', status: 'ISSUE', currency: 'AED', pnr: 'SF4JXT',
  userId: 'u', ...o,
});

/** What the Turkish portal upload put in the ledger earlier in the week. */
const portalRow = mk({ id: 'portal-1' });

console.log('\n1. BSP billing arrives for a ticket already uploaded from the portal');
{
  const bspRow = mk({ id: 'bsp-1', source: 'IATA BSP', amount: 2881, commission: 59 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([bspRow]), [portalRow]);
  eq('it does NOT become a second row', r.fresh.length, 0);
  eq('it settles the existing row instead', r.settlements.length, 1);

  const m = r.settlements[0];
  eq('  ...onto that same row', m?.id, 'portal-1');
  eq('  ...vendor stays the issuing portal', m?.source, 'Turkish Airlines');
  eq('  ...money becomes the invoice figure', m?.amount, 2881);
  eq('  ...commission is captured', m?.commission, 59);
  eq('  ...channel records the BSP settlement', m?.channel, 'BSP');
  eq('  ...the portal req number is kept', m?.reqNum, 'KSAML2064');
  eq('  ...passenger detail is kept', m?.pnr, 'SF4JXT');
}

console.log('\n2. The sale is counted once, not twice');
{
  const bspRow = mk({ id: 'bsp-1', source: 'IATA BSP', amount: 2881, commission: 59 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([bspRow]), [portalRow]);
  eq('one row per document', 1 + r.fresh.length, 1);
  eq('counted value is the payable', r.settlements[0]?.amount, 2881);
  eq('  (both rows kept would have counted this)', portalRow.amount + bspRow.amount, 5821);
}

console.log('\n3. The same BSP file uploaded twice');
{
  const bspRow = mk({ id: 'bsp-1', source: 'IATA BSP', amount: 2881, commission: 59 });
  const saved  = mk({ id: 'bsp-saved', source: 'IATA BSP', amount: 2881, commission: 59 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([bspRow]), [saved]);
  eq('re-importing the same invoice adds nothing', r.fresh.length, 0);
  eq('  ...it is a duplicate', r.duplicates.length, 1);
  eq('  ...and settles nothing again', r.settlements.length, 0);
}

console.log('\n4. The same PORTAL file uploaded twice');
{
  const again = mk({ id: 'portal-again' });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([again]), [portalRow]);
  eq('re-importing the same portal report adds nothing', r.fresh.length, 0);
  eq('  ...it is a duplicate', r.duplicates.length, 1);
}

console.log('\n5. A missing req number still gets filled in');
{
  const noReq   = mk({ id: 'portal-noreq', reqNum: '' });
  const withReq = mk({ id: 'portal-2', reqNum: 'KSAML2064' });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([withReq]), [noReq]);
  eq('the row is updated, not duplicated', r.updates.length, 1);
  eq('  ...onto the existing row', r.updates[0]?.id, 'portal-noreq');
}

console.log('\n6. A genuinely different document');
{
  const other = mk({ id: 'x', ticketNo: '2540225999', source: 'IATA BSP' });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([other]), [portalRow]);
  eq('an unrelated ticket is fresh', r.fresh.length, 1);
  eq('  ...and settles nothing', r.settlements.length, 0);
}

console.log('\n7. NSA and IATA holding the same document');
{
  const nsaRow = mk({ id: 'nsa-1', source: 'NSA', ticketNo: '5513059068', airlineCode: '065', pnr: 'ZB3KO9' });
  const bspRow = mk({ id: 'bsp-2', source: 'IATA BSP', ticketNo: '5513059068', airlineCode: '065', pnr: 'ZB3KO9', amount: 2881, commission: 59 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([bspRow]), [nsaRow]);
  eq('the invoice settles the NSA row', r.settlements.length, 1);
  eq('  ...vendor stays NSA', r.settlements[0]?.source, 'NSA');
  eq('  ...no second row appears', r.fresh.length, 0);
}

console.log('\n8. Portal report arriving AFTER the invoice settled it');
{
  const settled = mk({ id: 'settled-1', source: 'IATA BSP', amount: 2881, commission: 59, channel: 'BSP' });
  const late    = mk({ id: 'late-1', amount: 2940 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([late]), [settled]);
  eq('the portal row is not added', r.fresh.length, 0);
  eq('  ...and does not overwrite the settled money', r.settlements.length, 0);
}

console.log('\n9. A refund is its own document, never merged into the issue');
{
  const refundInvoice = mk({ id: 'rf-1', source: 'IATA BSP', status: 'REFUND', amount: -2881 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([refundInvoice]), [portalRow]);
  eq('the refund does not settle the issue row', r.settlements.length, 0);
  eq('  ...it is its own new row', r.fresh.length, 1);
}

console.log('\n10. Two airlines sharing a serial are different documents');
{
  const otherAirline = mk({ id: 'oa-1', source: 'IATA BSP', airlineCode: '065' });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([otherAirline]), [portalRow]);
  eq('they do not merge', r.settlements.length, 0);
  eq('  ...the other airline is its own row', r.fresh.length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
