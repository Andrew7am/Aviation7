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

console.log('\n4. Their "EMD Number" column');
{
  // Their real rows: the luggage bought on two tickets, EMDs written beside them.
  const H = 'Ticket Number,PNR,Status,Net Cost,Issued Date & Time,EMD Number,REQ No (Auto) (Trip) (from Aviation Quotations)';
  const s = parseTeamSheet([H,
    '065-5513058997,Y7ZS3D,Reissue,1280.00,5/8/2026 11:57pm,"065-1930576275 , 065-1930576277",UAEVP608',
    '065-5513058998,Y7ZS3D,Reissue,1280.00,5/8/2026 11:59pm,"065-1930576276 ,  065-1930576278",UAEVP608',
  ].join('\n')).rows;
  check('the EMDs are read off the row', s[0].emds, ['1930576275', '1930576277']);
  check('with the odd spacing too', s[1].emds, ['1930576276', '1930576278']);
  check('an EMD cell is not a ticket of their own', s.map(r => r.serial), ['5513058997', '5513058998']);
  const o = [
    tkt({ ticketNo: '5513058997', pnr: 'Y7ZS3D', date: '2026-08-01', amount: 20, reqNum: 'UAEVP608' }),
    tkt({ ticketNo: '5513058998', pnr: 'Y7ZS3D', date: '2026-08-01', amount: 20, reqNum: 'UAEVP608' }),
    ...['1930576275', '1930576276', '1930576277', '1930576278'].map(n =>
      tkt({ ticketNo: n, pnr: 'Y7ZS3D', date: '2026-08-05', amount: 640, status: 'EMDS', reqNum: 'UAEVP608' })),
  ];
  const r = compareTeamSheet(s, o);
  check('none of the four is missing from their sheet',
        r.findings.filter(f => f.verdict === 'NOT_ON_SHEET').map(f => f.serial), []);
  check('and the request agrees', r.byRequest.find(x => x.reqNum === 'UAEVP608')?.agrees, true);
  const without = parseTeamSheet([H.replace(',EMD Number', ''),
    '065-5513058997,Y7ZS3D,Reissue,1280.00,5/8/2026 11:57pm,UAEVP608',
    '065-5513058998,Y7ZS3D,Reissue,1280.00,5/8/2026 11:59pm,UAEVP608'].join('\n')).rows;
  check('a sheet without the column still reports them',
        compareTeamSheet(without, o).findings.filter(f => f.verdict === 'NOT_ON_SHEET').length, 4);
}

console.log('\n5. A row with no ticket number, identified by its PNR');
{
  const s = sheet([
    '---,ZDY2WX,Cancelled/Refunded,3712.94,,9/3/2026 1:00pm,IATA Portal (UAE),KSAML1276',
    '065-5512129300,ABCDEF,Issued,1000.00,,9/3/2026 1:00pm,IATA Portal (UAE),KSAML1276',
  ]);
  const one = [
    tkt({ ticketNo: '5512129276', pnr: 'ZDY2WX', date: '2026-03-09', amount: 3585.2, reqNum: 'KSAML1276' }),
    tkt({ ticketNo: '5512129300', pnr: 'ABCDEF', date: '2026-03-09', amount: 1000, reqNum: 'KSAML1276' }),
  ];
  const r = compareTeamSheet(s, one);
  check('the one ticket on that PNR is not reported missing',
        r.findings.filter(f => f.verdict === 'NOT_ON_SHEET').map(f => f.serial), []);
  const nt = r.findings.find(f => f.verdict === 'NO_TICKET_NUMBER');
  check('the blank row names it', nt?.serial, '5512129276');
  check('and still asks them to fill the number in', /needs the number filled in/.test(nt?.note ?? ''), true);
  // Two of ours on that PNR: the blank row cannot say which.
  const two = [...one, tkt({ ticketNo: '5512129277', pnr: 'ZDY2WX', date: '2026-03-09', amount: 3585.2, reqNum: 'KSAML1276' })];
  check('two candidates — neither is claimed',
        compareTeamSheet(s, two).findings.filter(f => f.verdict === 'NOT_ON_SHEET').map(f => f.serial).sort(),
        ['5512129276', '5512129277']);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
