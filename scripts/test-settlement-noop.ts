/**
 * Re-uploading an invoice the ledger has already settled must report nothing
 * to do — and an invoice that genuinely brings new figures must still settle.
 *
 * The first half is the bug this locks out: opening the September invoice a
 * second time listed eight tickets under "settled from invoice" with every
 * figure identical to what was held, which reads as eight discrepancies in a
 * file that contained none.
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

const mk = (o: Partial<Ticket>): Ticket => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  ticketNo: '2540225943', pnr: 'ABC123', passengerName: 'SMITH/JOHN', airlineCode: '235',
  route: '', source: 'Turkish Airlines', date: '2026-09-01', amount: 4519.7, totalDoc: 4610,
  commission: 90.3, reqNum: 'KSAML2343', status: 'ISSUE', currency: 'AED',
  isDuplicate: false, userId: 'u', ...o,
} as Ticket);

console.log('\n1. The invoice repeats what the ledger already holds');
{
  const held = [mk({ id: 'held', channel: 'WEBSALES-EDIS' })];
  const invoice = [mk({ source: 'IATA BSP', channel: 'BSP' })];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('nothing is offered as a settlement', r.settlements.length, 0);
  check('it is reported as already held',     r.duplicates.length, 1);
  check('and no row is added',                r.fresh.length, 0);
}

console.log('\n2. The same, where the ledger row never got its channel stamped');
{
  const held = [mk({ id: 'held', source: 'IATA BSP', channel: undefined })];
  const invoice = [mk({ source: 'IATA BSP', channel: 'BSP' })];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('a missing channel alone is not a change', r.settlements.length, 0);
  check('still just a duplicate',                  r.duplicates.length, 1);
}

console.log('\n3. The invoice brings a commission the ledger never had');
{
  const held = [mk({ id: 'held', amount: 4610, commission: 0, channel: undefined })];
  const invoice = [mk({ source: 'IATA BSP', amount: 4519.7, commission: 90.3, channel: 'BSP' })];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('it settles',                     r.settlements.length, 1);
  check('onto the row already there',     r.settlements[0]?.id, 'held');
  check('carrying the commission',        r.settlements[0]?.commission, 90.3);
  check('and the net payable',            r.settlements[0]?.amount, 4519.7);
}

console.log('\n4. The invoice names a day the ledger left blank');
{
  const held = [mk({ id: 'held', date: '', channel: undefined })];
  const invoice = [mk({ source: 'IATA BSP', date: '2026-09-01', channel: 'BSP' })];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('a date the ledger lacks is a real change', r.settlements.length, 1);
  check('and the date lands',                       r.settlements[0]?.date, '2026-09-01');
}

console.log('\n5. A blank on the invoice never counts as a difference');
{
  const held = [mk({ id: 'held', date: '2026-09-01', channel: 'WEBSALES-EDIS' })];
  const invoice = [mk({ source: 'IATA BSP', date: '', channel: 'BSP' })];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('an empty date does not force a settlement', r.settlements.length, 0);
  check('reported as already held',                  r.duplicates.length, 1);
}

console.log('\n6. A refund is settled on its own terms, not the sale\'s');
{
  const held = [
    mk({ id: 'sale',   status: 'ISSUE',  amount: 4610,  commission: 0, channel: undefined }),
    mk({ id: 'refund', status: 'REFUND', amount: -4610, commission: 0, channel: undefined }),
  ];
  const invoice = [
    mk({ source: 'IATA BSP', status: 'ISSUE',  amount: 4519.7,  commission: 90.3,  channel: 'BSP' }),
    mk({ source: 'IATA BSP', status: 'REFUND', amount: -4519.7, commission: -90.3, channel: 'BSP' }),
  ];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('both settle', r.settlements.length, 2);
  check('the sale keeps the positive commission',
        r.settlements.find(s => s.id === 'sale')?.commission, 90.3);
  check('the refund keeps the negative one',
        r.settlements.find(s => s.id === 'refund')?.commission, -90.3);
}

console.log('\n7. A row already held is previewed as the ledger holds it');
{
  // A BSP invoice states none of these; the ledger has had them for weeks.
  const held = [mk({
    id: 'held', reqNum: 'KSAML2392', pnr: 'YTOEFL',
    passengerName: 'RANDA ELFADIL', route: 'JED-IST', channel: 'BSP',
  })];
  const invoice = [mk({
    source: 'IATA BSP', reqNum: '', pnr: '', passengerName: '', route: '', channel: 'BSP',
  })];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('reported as already held', r.duplicates.length, 1);
  const d = r.duplicates[0];
  check('the req number is the one on file, not MISSING', d?.reqNum, 'KSAML2392');
  check('the PNR shows',                                  d?.pnr, 'YTOEFL');
  check('the passenger shows',                            d?.passengerName, 'RANDA ELFADIL');
  check('the route shows',                                d?.route, 'JED-IST');
}

console.log('\n8. What the file does state still wins');
{
  const held = [mk({ id: 'held', reqNum: 'OLD-REQ', channel: 'BSP' })];
  const invoice = [mk({ source: 'IATA BSP', reqNum: 'FROM-FILE', channel: 'BSP' })];
  const r = detectDuplicatesAgainstExisting(invoice, held);
  check('a stated req num is not overwritten by the held one',
        r.duplicates[0]?.reqNum ?? r.updates[0]?.reqNum, 'FROM-FILE');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
