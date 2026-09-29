/**
 * A request whose only differences are states of the world is a request
 * that agrees.
 *
 *   npx tsx scripts/test-team-sheet-settled.ts
 *
 * KSAML1198, as the screen showed it: 67 on their sheet, 64 in our books,
 * "0 of 1 agree" — five "only theirs" and two "only ours". The five were
 * voids their sheet itself marks Void. The two were EMDs their sheet folds
 * into the reissue they paid for: 5513059108 at 420.00 on theirs is our
 * 20.00 reissue plus a 400.00 EMD, same PNR, same day. Nothing on that
 * request is wrong, and the screen said otherwise. Asserted on those rows.
 */
import { parseTeamSheet } from '../src/core/parsers/teamSheet';
import { compareTeamSheet } from '../src/core/helpers/teamSheetCompare';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const HEAD = 'Ticket Number,PNR,Status,Net Cost,Refund Amount,Issued Date & Time,Portal,REQ No (Auto) (MICE)';
const sheet = (rows: string[]) => parseTeamSheet([HEAD, ...rows].join('\n')).rows;
const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2), ticketNo: '', pnr: '', passengerName: '', airlineCode: '065',
  route: '', source: 'IATA BSP', date: '2026-08-25', amount: 0, totalDoc: 0, commission: 0,
  reqNum: 'KSAML1198', vendorReference: '', status: 'ISSUE', currency: 'AED', isDuplicate: false,
  closed: false, userId: 'u', ...o,
});

const theirs = sheet([
  '065-5513058985,ZOIU62,Issued,2330.00,,29/7/2026 1:42pm,IATA Portal (UAE),KSAML1198',
  '065 5513059108,ZOIU62,Reissue,420.00,,25/8/2026 4:30pm,IATA Portal (UAE),KSAML1198',
  '065-5513059033,ZH59PO,Issued,2420.00,,10/8/2026 8:40pm,IATA Portal (UAE),KSAML1198',
  // their real row: issued and refunded, written once, at the issue cost
  '065 5513373310,ZH59PO,Cancelled/Refunded,1530.00,2960.00,2/9/2026 10:24am,IATA Portal (UAE),KSAML1198',
  '065-5513059031,ZH59PO,Void,5390.00,,10/8/2026 12:09am,IATA Portal (UAE),KSAML1198',
  '065-5513059012,XOPKQW,Void,2790.00,,6/8/2026 1:00pm,IATA Portal (UAE),KSAML1198',
]);
const ours = [
  tkt({ ticketNo: '5513058985', pnr: 'ZOIU62', date: '2026-07-29', amount: 2330 }),
  tkt({ ticketNo: '5513059108', pnr: 'ZOIU62', date: '2026-08-25', amount: 20 }),
  tkt({ ticketNo: '1949933369', pnr: 'ZOIU62', date: '2026-08-25', amount: 400, status: 'EMDS' }),
  tkt({ ticketNo: '5513059033', pnr: 'ZH59PO', date: '2026-08-10', amount: 2420 }),
  tkt({ ticketNo: '5513373310', pnr: 'ZH59PO', date: '2026-09-02', amount: 1130 }),
  tkt({ ticketNo: '1949933371', pnr: 'ZH59PO', date: '2026-09-02', amount: 400, status: 'EMDS' }),
  tkt({ ticketNo: '5513373310', pnr: 'ZH59PO', date: '2026-09-09', amount: -2960, totalDoc: 2960, status: 'REFUND' }),
];

console.log('\n1. KSAML1198 agrees');
{
  const r = compareTeamSheet(theirs, ours);
  const line = r.byRequest.find(x => x.reqNum === 'KSAML1198')!;
  check('nothing only theirs — both extras are voids they mark void', line.onlyTheirs, 0);
  check('nothing only ours — both EMDs are inside their reissue rows', line.onlyOurs, 0);
  check('the request agrees', line.agrees, true);
  check('no EMD reported missing from their sheet',
        r.findings.filter(f => f.verdict === 'NOT_ON_SHEET').map(f => f.serial), []);
  check('the voids are still listed, as voids',
        r.findings.filter(f => f.verdict === 'VOID_NOT_BILLED').map(f => f.serial).sort(),
        ['5513059012', '5513059031']);
}

console.log('\n2. An EMD is only folded in when the arithmetic says so');
{
  // Their reissue at 420 still, but our EMD is 300: 20 + 300 is not 420.
  const off = ours.map(t => t.ticketNo === '1949933369' ? { ...t, amount: 300 } : t);
  const r = compareTeamSheet(theirs, off);
  check('a 300 EMD against a 420 row is reported',
        r.findings.filter(f => f.verdict === 'NOT_ON_SHEET').map(f => f.serial), ['1949933369']);
  // Same amounts, a different day: not the same event.
  const later = ours.map(t => t.ticketNo === '1949933369' ? { ...t, date: '2026-08-26' } : t);
  check('an EMD a day later is reported',
        compareTeamSheet(theirs, later).findings.filter(f => f.verdict === 'NOT_ON_SHEET').map(f => f.serial),
        ['1949933369']);
  // Same day, another booking.
  const other = ours.map(t => t.ticketNo === '1949933369' ? { ...t, pnr: 'QQQQQQ' } : t);
  check('an EMD on another PNR is reported',
        compareTeamSheet(theirs, other).findings.filter(f => f.verdict === 'NOT_ON_SHEET').map(f => f.serial),
        ['1949933369']);
}

console.log('\n3. A void only we know about');
{
  // Their sheet still shows it issued; the supplier cancelled it.
  const live = sheet([
    '065-5513059070,ABCDEF,Issued,1810.00,,26/8/2026 1:00pm,IATA Portal (UAE),KSAML1198',
    '065-5513058985,ZOIU62,Issued,2330.00,,29/7/2026 1:42pm,IATA Portal (UAE),KSAML1198',
  ]);
  const base = [tkt({ ticketNo: '5513058985', pnr: 'ZOIU62', date: '2026-07-29', amount: 2330 })];
  const without = compareTeamSheet(live, base);
  check('without the Voids register it is missing from our books',
        without.findings.find(f => f.serial === '5513059070')?.verdict, 'NOT_IN_LEDGER');
  check('and holds the request open', without.byRequest[0].agrees, false);
  const withV = compareTeamSheet(live, base, [], {}, { voided: ['065-5513059070'] });
  check('with it, it is a void', withV.findings.find(f => f.serial === '5513059070')?.verdict, 'VOID_NOT_BILLED');
  check('which says their sheet needs updating',
        /still shows it\s+as issued/.test(withV.findings.find(f => f.serial === '5513059070')?.note ?? ''), true);
  check('and the request agrees', withV.byRequest[0].agrees, true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
