/**
 * What clicking the source cell puts on the clipboard.
 *
 * Four fields, deliberately. This carried eleven at first on the reasoning
 * that more is safer, and it is not: the person copying is sending a ticket
 * to somebody, and the amount, the invoice reference and the closure state
 * are our bookkeeping rather than the ticket's identity. Pasting them into a
 * message to a supplier tells them things they have no business reading.
 *
 * So the test is as much about what is ABSENT as what is present.
 */
import { ticketLine, ticketLines, copyableTickets } from '../src/core/helpers/ticketClipboard';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const tkt = (o: Partial<Ticket> = {}): Ticket => ({
  id: 'x', ticketNo: '5066646722', pnr: 'XSQH59',
  passengerName: 'RJAA HASSAN M ALNAMAY', airlineCode: '065',
  route: 'RUH/LHR/RUH', source: 'NSA', date: '2025-11-30', amount: 22261.5,
  totalDoc: 22261.5, commission: 0, reqNum: 'REQ11662', vendorReference: 'INV999',
  status: 'ISSUE', currency: 'SAR', isDuplicate: false, closed: true, userId: 'u', ...o,
});

console.log('\n1. Four fields, in the order they are read');
{
  const cells = ticketLine(tkt()).split('\t');
  check('exactly four',   cells.length, 4);
  check('airline first',  cells[0], '065');
  check('then the number',cells[1], '5066646722');
  check('then the name',  cells[2], 'RJAA HASSAN M ALNAMAY');
  check('then the PNR',   cells[3], 'XSQH59');
}

console.log('\n2. Our bookkeeping stays out of it');
{
  const line = ticketLine(tkt());
  for (const [what, value] of [
    ['the amount', '22261.5'], ['the invoice reference', 'INV999'],
    ['the req number', 'REQ11662'], ['the source', 'NSA'],
    ['the date', '2025-11-30'], ['the route', 'RUH/LHR/RUH'],
    ['the currency', 'SAR'], ['the status', 'ISSUE'],
  ] as [string, string][])
    check(`${what} is not sent`, line.includes(value), false);
}

console.log('\n3. Tab separated, so it pastes as columns or as a line');
{
  check('three tabs', (ticketLine(tkt()).match(/\t/g) || []).length, 3);
  check('no newline', ticketLine(tkt()).includes('\n'), false);
}

console.log('\n4. A missing field leaves its column empty, not shifted');
{
  // A shifted column is worse than a blank one: the PNR would arrive in the
  // passenger's place and read as a name.
  const cells = ticketLine(tkt({ passengerName: '', airlineCode: '' })).split('\t');
  check('still four columns', cells.length, 4);
  check('airline blank',      cells[0], '');
  check('number in place',    cells[1], '5066646722');
  check('name blank',         cells[2], '');
  check('PNR still last',     cells[3], 'XSQH59');
}

console.log('\n5. A whole filter at once: one ticket to a line');
{
  const rows = [
    tkt({ id: 'a', ticketNo: '0000000001', passengerName: 'ONE', pnr: 'AAA111' }),
    tkt({ id: 'b', ticketNo: '0000000002', passengerName: 'TWO', pnr: 'BBB222' }),
    tkt({ id: 'c', ticketNo: '0000000003', passengerName: 'THREE', pnr: 'CCC333' }),
  ];
  const out = ticketLines(rows);
  const lines = out.split('\n');
  check('a line each',        lines.length, 3);
  check('the order is kept',  lines.map(l => l.split('\t')[1]),
                              ['0000000001', '0000000002', '0000000003']);
  check('four fields on each',[...new Set(lines.map(l => l.split('\t').length))], [4]);
  check('no trailing newline', out.endsWith('\n'), false);
  // The same silence as a single ticket: a vendor's whole list must not carry
  // the amounts out of the building either.
  check('still no amounts',   out.includes('22261.5'), false);
  check('still no req num',   out.includes('REQ11662'), false);
  check('still no invoice',   out.includes('INV999'), false);
}

console.log('\n6. A top-up is not a ticket');
{
  // A wallet payment has no number, no passenger and no PNR. Left in, it
  // copies as an empty line - a blank row in somebody's sheet that reads as
  // a ticket whose details went missing.
  const rows = [
    tkt({ id: 'a', ticketNo: '0000000001', passengerName: 'ONE', pnr: 'AAA111' }),
    tkt({ id: 'f', ticketNo: '', passengerName: '', pnr: '', airlineCode: '',
          status: 'FUND', amount: -50000 }),
    tkt({ id: 'b', ticketNo: '0000000002', passengerName: 'TWO', pnr: 'BBB222' }),
  ];
  check('dropped from the list', copyableTickets(rows).map(t => t.id), ['a', 'b']);
  check('two lines, not three',  ticketLines(rows).split('\n').length, 2);
  check('no empty line',         ticketLines(rows).includes('\n\t\t\t'), false);
  check('lower case fund too',
    copyableTickets([tkt({ status: 'fund' })]).length, 0);
  check('a refund is a ticket and stays',
    copyableTickets([tkt({ status: 'RFND', amount: -2810 })]).length, 1);
}

console.log('\n7. Nothing selected copies nothing');
{
  check('an empty list is an empty string', ticketLines([]), '');
  check('one row has no newline at all', ticketLines([tkt()]).includes('\n'), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
