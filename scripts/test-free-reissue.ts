/**
 * A reissue at no charge, filed where its original is.
 *
 *   npx tsx scripts/test-free-reissue.ts
 *
 * BSP prints it with no fare, no passenger and no PNR. On import it takes
 * the request, PNR, passenger and closed state of the ticket it replaces -
 * from the books, or from earlier in the same file - walking back through a
 * chain of reissues. Asserted on real ones.
 */
import { fileUnderOriginal } from '../src/core/helpers/freeReissue';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const t = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36).slice(2), ticketNo: '', pnr: '', passengerName: '',
  airlineCode: '157', route: '', source: 'IATA BSP', date: '2026-04-09', amount: 0, totalDoc: 0, commission: 0, reqNum: '',
  vendorReference: '', status: 'ISSUE', currency: 'AED', isDuplicate: false, closed: false, userId: 'u', ...o } as Ticket);
const free = (ticketNo: string) => t({ ticketNo, transactionType: 'REISSUE' });

console.log('\n1. Filed under the ticket it replaces');
{
  const original = t({ ticketNo: '5512369256', amount: 2060, reqNum: 'KSAML1441', pnr: 'YI9HET', passengerName: 'DOKMAK', closed: true });
  const [r] = fileUnderOriginal([free('5512369347')], [original], [{ ticketNo: '5512369347', replacedTicket: '5512369256' }]);
  check('its request', r.reqNum, 'KSAML1441');
  check('its PNR and passenger', [r.pnr, r.passengerName], ['YI9HET', 'DOKMAK']);
  check('closed when the original is', r.closed, true);
  check('still at 0', r.amount, 0);
}

console.log('\n2. Back through a chain of reissues');
{
  // 1930576249 -> 5512760098 -> 5512760094 -> 5512760083, the one we hold.
  const original = t({ ticketNo: '5512760083', amount: 3588, reqNum: 'UAECO475', pnr: 'YMGQYB' });
  const links = [
    { ticketNo: '5512760094', replacedTicket: '5512760083' },
    { ticketNo: '5512760098', replacedTicket: '5512760094' },
    { ticketNo: '1930576249', replacedTicket: '5512760098' },
  ];
  const out = fileUnderOriginal([free('5512760094'), free('5512760098'), free('1930576249')], [original], links);
  check('every one under UAECO475', out.map(r => r.reqNum), ['UAECO475', 'UAECO475', 'UAECO475']);
}

console.log('\n3. Left alone when it should be');
{
  const out = fileUnderOriginal(
    [free('5513058971'), t({ ticketNo: '5512369346', amount: 3540, transactionType: 'ISSUE' })],
    [], [{ ticketNo: '5513058971', replacedTicket: '2241130431' }]);
  check('an original we do not hold leaves it as it is', out[0].reqNum, '');
  check('an ordinary sale is untouched', out[1].reqNum, '');
  const typed = fileUnderOriginal([{ ...free('5512369347'), reqNum: 'KSAML9999' }],
    [t({ ticketNo: '5512369256', amount: 2060, reqNum: 'KSAML1441' })], [{ ticketNo: '5512369347', replacedTicket: '5512369256' }]);
  check('a request already on the row is kept', typed[0].reqNum, 'KSAML9999');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
