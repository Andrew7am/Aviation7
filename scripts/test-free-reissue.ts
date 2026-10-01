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
import Papa from 'papaparse';
import { runParser } from '../src/core/parsers';

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

console.log('\n4. A report that names no replaced ticket: filed by its booking');
{
  // RTS: "016-5513437053 ... ticket, reissue ... 0" on ZO8TOX, HUGHES ALBERT ERIC.
  const sale = t({ ticketNo: '5513408071', amount: 4740, reqNum: 'UAEVP711', pnr: 'ZO8TOX', passengerName: 'HUGHES ALBERT ERIC', source: 'RTS' });
  const [r] = fileUnderOriginal([{ ...free('5513437053'), pnr: 'ZO8TOX', passengerName: 'HUGHES ALBERT ERIC', source: 'RTS' }], [sale], []);
  check('the same PNR and passenger give the request', r.reqNum, 'UAEVP711');
  const other = t({ ticketNo: '5513408072', amount: 900, reqNum: 'UAEVP999', pnr: 'ZO8TOX', passengerName: 'HUGHES ALBERT ERIC' });
  const [two] = fileUnderOriginal([{ ...free('5513437053'), pnr: 'ZO8TOX', passengerName: 'HUGHES ALBERT ERIC' }], [sale, other], []);
  check('two requests on that booking cannot say which', two.reqNum, '');
  const [stranger] = fileUnderOriginal([{ ...free('5513437053'), pnr: 'ZO8TOX', passengerName: 'SOMEBODY ELSE' }], [sale], []);
  check('another passenger on the PNR is not this one', stranger.reqNum, '');
}

console.log('\n5. RTS says which rows are reissues at no charge');
{
  // The real columns: Type "ticket", Action "reissue", Issue type "BSP".
  const head = 'Record Locator,Passenger,PNR creation date,No,Carrier,Type,Action,Issue type,Total,Total currency';
  const grid = Papa.parse<string[]>([head,
    'ZO8TOX,HUGHES ALBERT ERIC MR,9/8/2026,016-5513437053,UA,ticket,reissue,BSP,0,AED',
    'ZO8TOX,HUGHES ALBERT ERIC MR,9/8/2026,016-5513408071,UA,ticket,issue,BSP,4740,AED',
  ].join('\n'), { skipEmptyLines: true }).data;
  const rows = runParser(grid, undefined, 'AED', 'rts', []).rows;
  const by = (n: string) => rows.find(x => x.ticketNo.endsWith(n));
  check('the reissue at 0 is marked', by('5513437053')?.freeReissue, true);
  check('and kept, not voided', by('5513437053')?.status, 'ISSUE');
  check('the sale is not', by('5513408071')?.freeReissue, undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
