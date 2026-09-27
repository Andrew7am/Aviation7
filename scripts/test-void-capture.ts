/**
 * Keeping a cancellation the import is about to discard.
 *
 * Every parser already knows its vendor's cancellation words and the import
 * already separates those rows out — it just threw them away. What it keeps
 * of them now has one job: be countable exactly once, however many times the
 * same file is imported.
 *
 * The de-duplication key is (document, supplier, period), so the period is
 * the whole game. BSP states one in its file name. Nobody else does, and a
 * blank there would make every re-import a fresh set of cancellations — in
 * Postgres two NULLs are never equal, so the unique constraint stands aside
 * and says nothing. That is how a void ratio doubles.
 */
import { voidFromTicket, voidsFromImport, periodFor } from '../src/core/helpers/voidFromImport';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const tkt = (o: Partial<Ticket> = {}): Ticket => ({
  id: 'x', ticketNo: '5513373350', pnr: 'XNZBUG', passengerName: 'ALNOMAN HATEM',
  airlineCode: '065', route: '', source: 'RTS', date: '2026-08-12', amount: 0,
  totalDoc: 0, commission: 0, reqNum: '', status: 'VOID', isDuplicate: false,
  userId: 'u', currency: 'AED', ...o,
});

console.log('\n1. What is kept of a cancelled document');
{
  const v = voidFromTicket(tkt(), 'RTS August.csv');
  check('the document', v.ticketNo, '5513373350');
  check('its airline', v.airlineCode, '065');
  check('the supplier', v.source, 'RTS');
  check('the passenger', v.passengerName, 'ALNOMAN HATEM');
  check('the PNR', v.pnr, 'XNZBUG');
  check('the date', v.date, '2026-08-12');
  check('and what the source called it', v.rawStatus, 'VOID');
  check('the file it came from', v.reportName, 'RTS August.csv');
}

console.log('\n2. The period is what stops it being counted twice');
{
  // BSP writes it into the file name and it is the period BSP bills on.
  check('BSP states its own',
        periodFor(tkt({ source: 'IATA BSP' }), 'AEaz86219136_260804_Agent_Billing.zip'),
        '260804');
  // Nobody else does, so the document's own month stands in — stable across
  // re-imports of the same file, and what the ratio is grouped by anyway.
  check('everyone else gets the month', periodFor(tkt(), 'RTS August.csv'), '2026-08');
  // A row with no date at all still needs one: two undated cancellations
  // from the same report are the same import.
  check('an undated row falls back to the report',
        periodFor(tkt({ date: '' }), 'RTS August.csv'), 'RTS August.csv');
  check('  ...and is never empty',
        periodFor(tkt({ date: '' }), 'RTS August.csv').length > 0, true);

  // The one that matters: importing the same file twice.
  const file = 'RTS August.csv';
  const once = voidsFromImport([tkt()], file);
  const twice = voidsFromImport([tkt()], file);
  check('the same file gives the same key both times',
        once[0].period, twice[0].period);
}

console.log('\n3. The same cancellation twice inside one file');
{
  /* A supplier's export lists one cancellation on more than one line often
     enough — a conjunction, a reissue cancelled in two coupons. The database
     would refuse the second; better to agree with it here. */
  const v = voidsFromImport([tkt(), tkt(), tkt({ ticketNo: '9999999999' })], 'x.csv');
  check('three rows, two documents', v.length, 2);
  check('and both are there', v.map(x => x.ticketNo).sort(),
        ['5513373350', '9999999999']);

  // Different suppliers CAN cancel the same number — they are different
  // documents in different stock.
  const two = voidsFromImport([tkt(), tkt({ source: 'IATA BSP' })], 'x.csv');
  check('the same number under two suppliers is two records', two.length, 2);

  // The same document in two periods is two cancellations reported twice,
  // and the register keeps both rather than choosing.
  const periods = voidsFromImport(
    [tkt({ date: '2026-08-12' }), tkt({ date: '2026-09-12' })], '');
  check('two months, two records', periods.length, 2);
}

console.log('\n4. A row that cannot be filed is not filed');
{
  check('no document number', voidsFromImport([tkt({ ticketNo: '' })], 'x'), []);
  check('no supplier', voidsFromImport([tkt({ source: '' })], 'x'), []);
  check('whitespace is not a supplier', voidsFromImport([tkt({ source: '  ' })], 'x'), []);
  check('nothing at all', voidsFromImport([], 'x'), []);
}

console.log('\n5. The face value, where the source still has one');
{
  /* Context, never a balance. Some parsers zero a void before it gets here
     — BSP's does — and an invented figure would be worse than none. */
  check('a zeroed void carries none', voidFromTicket(tkt()).faceValue, null);
  check('one that kept its gross carries it',
        voidFromTicket(tkt({ totalDoc: 3610 })).faceValue, 3610);
  check('a negative is taken at its size',
        voidFromTicket(tkt({ totalDoc: 0, amount: -1200 })).faceValue, 1200);
}

console.log('\n6. A date that is not a date is not kept as one');
{
  // 1970-01-01 is a valid-looking date that says nothing — the same test
  // the ledger uses refuses it, so it cannot be counted into that year.
  check('the epoch is refused', voidFromTicket(tkt({ date: '1970-01-01' })).date, '');
  check('  ...and cannot reach a period',
        periodFor(tkt({ date: '1970-01-01' }), 'x.csv'), 'x.csv');
  check('a blank stays blank', voidFromTicket(tkt({ date: '' })).date, '');
  check('free text is refused', voidFromTicket(tkt({ date: 'Aug 2026' })).date, '');
  check('  ...so the column never holds something undateable',
        voidFromTicket(tkt({ date: '12/08/2026' })).date, '');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
