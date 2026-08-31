/**
 * The weekly workflow: issue on a portal, upload it, then upload the BSP
 * billing for the same week. Both files carry the SAME document.
 *
 * Since ticket numbers were normalised onto the bare serial, the portal row
 * and the BSP invoice line finally agree on the ticket number — which is the
 * point, but it also means the import path must now tell "the same document
 * settled through a second channel" apart from "this row is a duplicate".
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
  ticketNo: '2540225922', source: 'Turkish Airlines', date: '2026-08-23',
  amount: 2940, commission: 0, totalDoc: 2940, reqNum: 'KSAML2064',
  status: 'ISSUE', currency: 'AED', pnr: 'SF4JXT', userId: 'u', ...o,
});

/** What the Turkish portal upload put in the ledger earlier in the week. */
const portalRow = mk({ id: 'portal-1' });

console.log('\n1. BSP billing arrives for a ticket already uploaded from the portal');
{
  // The invoice line: same document, but it is the settlement record — it
  // carries commission and the payable, and it belongs to the IATA vendor.
  const bspRow = mk({ id: 'bsp-1', source: 'IATA BSP', amount: 2881, commission: 59 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([bspRow]), [portalRow]);
  eq('the BSP row is kept as its own record', r.fresh.length, 1);
  eq('  ...not silently dropped as a duplicate', r.duplicates.length, 0);
  eq('  ...and does NOT overwrite the portal row', r.updates.length, 0);
  if (r.updates.length) console.log('        would overwrite id:', r.updates[0].id);
}

console.log('\n2. The same BSP file uploaded twice is still a duplicate');
{
  const bspRow = mk({ id: 'bsp-1', source: 'IATA BSP', amount: 2881, commission: 59 });
  const saved  = mk({ id: 'bsp-saved', source: 'IATA BSP', amount: 2881, commission: 59 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([bspRow]), [portalRow, saved]);
  eq('re-importing the same invoice adds nothing', r.fresh.length, 0);
  eq('  ...it is reported as a duplicate', r.duplicates.length, 1);
}

console.log('\n3. The same PORTAL file uploaded twice is still a duplicate');
{
  const again = mk({ id: 'portal-again' });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([again]), [portalRow]);
  eq('re-importing the same portal report adds nothing', r.fresh.length, 0);
  eq('  ...it is reported as a duplicate', r.duplicates.length, 1);
}

console.log('\n4. A missing req number still gets filled in from a later upload');
{
  const noReq  = mk({ id: 'portal-noreq', reqNum: '' });
  const withReq = mk({ id: 'portal-2', reqNum: 'KSAML2064' });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([withReq]), [noReq]);
  eq('the row is updated, not duplicated', r.updates.length, 1);
  eq('  ...onto the existing row', r.updates[0]?.id, 'portal-noreq');
}

console.log('\n5. Two vendors, two genuinely different documents');
{
  const other = mk({ id: 'x', ticketNo: '2540225999', source: 'IATA BSP' });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([other]), [portalRow]);
  eq('an unrelated ticket is fresh', r.fresh.length, 1);
}

console.log('\n6. A refund on a document that exists as an issue');
{
  const refund = mk({ id: 'r1', source: 'IATA BSP', status: 'REFUND', amount: -2881 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([refund]), [portalRow]);
  eq('a refund is never a duplicate of its own issue', r.fresh.length, 1);
}

console.log('\n7. NSA and IATA holding the same document');
{
  const nsaRow = mk({ id: 'nsa-1', source: 'NSA', ticketNo: '5513059068', pnr: 'ZB3KO9' });
  const bspRow = mk({ id: 'bsp-2', source: 'IATA BSP', ticketNo: '5513059068', pnr: 'ZB3KO9', amount: 2881, commission: 59 });
  const r = detectDuplicatesAgainstExisting(detectDuplicates([bspRow]), [nsaRow]);
  eq('the BSP settlement row survives alongside the NSA row', r.fresh.length, 1);
  eq('  ...and does not overwrite it', r.updates.length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
