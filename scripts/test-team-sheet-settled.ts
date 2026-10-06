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
import { compareTeamSheet, reqDiffHint, rowsForRequests, whoActs } from '../src/core/helpers/teamSheetCompare';
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

console.log('\n6. UAEVP711: bought on the airline\'s website, no ticket number');
{
  const s = sheet([
    '--,IBVCUY,Issued,194.98,,16/9/2026 1:00pm,AL Website,UAEVP711',
    '"NICOLETTE LEE NOBLE",VENTNS,Issued,265.98,,14/9/2026 1:00pm,AL Website,UAEVP711',
    '"JOSE BASTOS PADILHA NETO",VENTNS,Issued,265.98,,14/9/2026 1:00pm,AL Website,UAEVP711',
    '065-5513427771,ZZWSI5,Issued,1800.00,,21/9/2026 12:39pm,IATA Portal (UAE),UAEVP711',
  ]).map(r => ({ ...r, currency: r.serial ? 'AED' : 'USD' }));
  const ours = [tkt({ ticketNo: '5513427771', pnr: 'ZZWSI5', date: '2026-09-21', amount: 1800, reqNum: 'UAEVP711' })];
  const r = compareTeamSheet(s, ours);
  const missing = r.findings.filter(f => f.verdict === 'NOT_IN_LEDGER');
  check('all three are missing from our books', missing.map(f => f.serial), ['IBVCUY', 'VENTNS-1', 'VENTNS-2']);
  check('and say they go in as dirhams', /in dirhams at 3\.67/.test(missing[0].note), true);
  check('they hold the request open', r.byRequest[0].onlyTheirs, 3);
  // Once recorded — one of the two VENTNS — only the other is still missing.
  const held = [...ours, tkt({ ticketNo: 'VENTNS-1', pnr: 'VENTNS', date: '2026-09-14', amount: 976.15,
    currency: 'AED', originalCurrency: 'USD', originalAmount: 265.98, fxRate: 3.67, source: 'Airline Website', reqNum: 'UAEVP711' })];
  const after = compareTeamSheet(s, held).findings.filter(f => f.verdict === 'NOT_IN_LEDGER').map(f => f.serial);
  check('recorded ones are not raised again', after, ['IBVCUY', 'VENTNS-2']);
  check('and ours is not "not on their sheet"',
        compareTeamSheet(s, held).findings.filter(f => f.verdict === 'NOT_ON_SHEET').length, 0);
  // A PNR written as two on one side and the other way round on ours.
  const two = sheet(['--,GDYW8U|YHCELI,Issued,129.00,,27/8/2026 1:00pm,AL Website,UAECO593']);
  const mine = [tkt({ ticketNo: '4136627236', pnr: 'YHCELI|GDYW8U', date: '2026-08-27', amount: 473.39, reqNum: 'UAECO593', source: 'Airline Website' })];
  check('two PNRs in either order are the same booking',
        compareTeamSheet(two, mine).findings.filter(f => f.verdict === 'NOT_IN_LEDGER').length, 0);
}

console.log('\n7. A bag on a PNR is not the tickets on that PNR');
{
  const s = sheet([
    'ZWHPO5,ZWHPO5,Issued,660.00,,15/9/2026 10:09am,AL Website,UAEVP711',
    '125-5513427717,ZWHPO5,Issued,11220.00,,15/9/2026 10:36am,IATA Portal (UAE),UAEVP711',
    '125-5513427718,ZWHPO5,Issued,11220.00,,15/9/2026 10:37am,IATA Portal (UAE),UAEVP711',
  ]);
  const ours = ['5513427717', '5513427718'].map(n =>
    tkt({ ticketNo: n, pnr: 'ZWHPO5', date: '2026-09-15', amount: 11220, reqNum: 'UAEVP711' }));
  const r = compareTeamSheet(s, ours);
  check('the 660 bag is missing from our books', r.findings.find(f => f.serial === 'ZWHPO5')?.verdict, 'NOT_IN_LEDGER');
  check('not "the same booking, filed differently"', r.findings.some(f => f.verdict === 'FILED_ELSEWHERE'), false);
}

console.log('\n8. The price');
{
  const s = sheet([
    '065-5513427772,ZZWSI5,Issued,1800.00,,21/9/2026 12:41pm,IATA Portal (UAE),UAEVP711',
    '065-5513408003,ABCDEF,Issued,1990.00,,10/9/2026 1:00pm,RTS,UAEVP711',
    '065 5513059108,ZOIU62,Reissue,420.00,,25/8/2026 4:30pm,IATA Portal (UAE),KSAML1198',
  ]).map(r => ({ ...r, currency: 'AED' }));
  const ours = [
    tkt({ ticketNo: '5513427772', pnr: 'ZZWSI5', date: '2026-09-21', amount: 1080, reqNum: 'UAEVP711' }),
    tkt({ ticketNo: '5513408003', pnr: 'ABCDEF', date: '2026-09-10', amount: 1980, reqNum: 'UAEVP711', source: 'RTS' }),
    tkt({ ticketNo: '5513059108', pnr: 'ZOIU62', date: '2026-08-25', amount: 20 }),
    tkt({ ticketNo: '1949933369', pnr: 'ZOIU62', date: '2026-08-25', amount: 400, status: 'EMDS' }),
  ];
  const r = compareTeamSheet(s, ours);
  const pd = r.findings.filter(f => f.verdict === 'PRICE_DIFFERS');
  check('1,800 on theirs against 1,080 in ours is a different price', pd.map(f => f.serial), ['5513427772']);
  check('saying by how much', /720\.00 more on theirs/.test(pd[0]?.note ?? ''), true);
  check('the ten dirhams their sheet adds on RTS is not', r.findings.find(f => f.serial === '5513408003')?.verdict, 'OK');
  check('a reissue with its EMD folded in is not', r.findings.find(f => f.serial === '5513059108')?.verdict, 'OK');
  check('and the request does not agree', r.byRequest.find(x => x.reqNum === 'UAEVP711')?.priceDiffers, 1);
  // A dollar ticket, compared in its dollars.
  const usd = sheet(['2792120971148,GSXEUH,Issued,1323.40,,13/9/2026 10:57am,AL Website,UAEVP711'])
    .map(r => ({ ...r, currency: 'USD' }));
  const conv = [tkt({ ticketNo: '2120971148', pnr: 'GSXEUH', date: '2026-09-13', amount: 4856.88, totalDoc: 4856.88,
    currency: 'AED', originalCurrency: 'USD', originalAmount: 1323.4, fxRate: 3.67, source: 'Airline Website', reqNum: 'UAEVP711' })];
  check('1,323.40 USD against 4,856.88 AED bought as 1,323.40 USD agrees',
        compareTeamSheet(usd, conv).findings[0]?.verdict, 'OK');
  // Riyals against dirhams: never compared.
  const sar = sheet(['065-5513427771,ZZWSI5,Issued,1800.00,,21/9/2026 12:39pm,IATA Portal (UAE),UAEVP711'])
    .map(r => ({ ...r, currency: 'SAR' }));
  check('a riyal price against a dirham one is not compared',
        compareTeamSheet(sar, [tkt({ ticketNo: '5513427771', pnr: 'ZZWSI5', date: '2026-09-21', amount: 1080, reqNum: 'UAEVP711' })])
          .findings[0]?.verdict, 'OK');
}

console.log('\n9. A refund filed under its refund application\'s number');
{
  // BSP: "065 RFND 0079546093 ... +RTDN: 2199622033". Their sheet refunds 2199622033.
  const s = sheet(['065-2199622033,XTNP8T,Cancelled/Refunded,400.00,1760.00,19/6/2026 3:34pm,AL Website,KSAML1145']);
  const ours = [
    tkt({ ticketNo: '2199622033', pnr: 'XTNP8T', date: '2026-06-19', amount: 400, reqNum: 'KSAML1145' }),
    tkt({ ticketNo: '0079546093', pnr: '', date: '2026-08-12', amount: -1760, totalDoc: 1760, status: 'REFUND',
          relatedTicket: '2199622033', reqNum: 'KSAML1145' }),
  ];
  const r = compareTeamSheet(s, ours);
  check('the application is not "not on their sheet"', r.findings.some(f => f.verdict === 'NOT_ON_SHEET'), false);
  check('and the ticket\'s refund is not "not in our ledger"', r.findings.some(f => f.verdict === 'REFUND_NOT_IN_LEDGER'), false);
  check('the request agrees', r.byRequest[0].agrees, true);
}

console.log('\n10. Why a ticket of ours is not on their sheet');
{
  const s = sheet(['065-5512760080,ZEO9MB,Reissue,20.00,,15/6/2026 1:00pm,IATA Portal (UAE),KSAML1145']);
  const ours = [
    tkt({ ticketNo: '5512760080', pnr: 'ZEO9MB', date: '2026-06-15', amount: 20, reqNum: 'KSAML1145' }),
    tkt({ ticketNo: '5512759973', pnr: 'ZEO9MB', date: '2026-06-01', amount: 2540, reqNum: 'KSAML1145' }),
    tkt({ ticketNo: '5512759999', pnr: 'ZEO9MB', date: '2026-06-01', amount: 2540, reqNum: 'KSAML1145' }),
  ];
  const r = compareTeamSheet(s, ours, [], { from: '2026-01-01' },
    { chains: [{ ticketNo: '5512760080', replacedTicket: '5512759973' }] });
  const note = (n: string) => r.findings.find(f => f.serial === n)?.note ?? '';
  check('the original of a reissue they carry says so', /same exchange chain as 5512760080/.test(note('5512759973')), true);
  check('another passenger on their PNR says so', /PNR ZEO9MB is on their sheet, but not this ticket/.test(note('5512759999')), true);
}

console.log('\n10b. A ticket missing with its refund raises both');
{
  // U92Z3D, their two rows: issued 1,460.00 and refunded 700.00, nothing in our books.
  const s = sheet([
    'U92Z3D,U92Z3D,Cancelled/Refunded,,700.00,2/10/2026 6:40pm,AL Website,UAECO788',
    'U92Z3D,U92Z3D,Issued,1460.00,,2/10/2026 2:42pm,AL Website,UAECO788',
  ]);
  const r = compareTeamSheet(s, []);
  check('the sale and the refund', r.findings.filter(f => f.serial === 'U92Z3D').map(f => f.verdict).sort(),
        ['NOT_IN_LEDGER', 'REFUND_NOT_IN_LEDGER']);
  check('the refund carries 700', r.findings.find(f => f.verdict === 'REFUND_NOT_IN_LEDGER')?.sheet?.refund, 700);
}

console.log('\n10c. Every row reaches a result');
{
  // KSAML1198 as in section 1: every row accounted for.
  check('a sheet the check fully reads leaves nothing over', compareTeamSheet(theirs, ours).unaccounted, []);
  // A refund on a misfiled ticket: 4815135258, theirs DXB vs ours UAECO352, refunded 1,935.00 on theirs.
  const s = sheet([
    '4815135258,ABCDEF,Issued,2555.00,,4/7/2026 1:00pm,RTS,UAECO352',
    '4815135258,ABCDEF,Cancelled/Refunded,,1935.00,10/7/2026 1:00pm,RTS,UAECO352',
  ]);
  const r = compareTeamSheet(s, [tkt({ ticketNo: '4815135258', pnr: 'ABCDEF', date: '2026-07-04', amount: 2555, reqNum: 'DXB', source: 'Gold Medal' })]);
  check('the misfiling is reported', r.findings.some(f => f.verdict === 'REQ_DIFFERS'), true);
  check('and the refund still is', r.findings.some(f => f.verdict === 'REFUND_NOT_IN_LEDGER'), true);
  check('so nothing is left over', r.unaccounted, []);
  // An EMD in their EMD column that we do not hold.
  const H = 'Ticket Number,PNR,Status,Net Cost,Issued Date & Time,EMD Number,REQ No (Auto) (Trip) (from Aviation Quotations)';
  const e = parseTeamSheet([H, '065-5513058997,Y7ZS3D,Reissue,1280.00,5/8/2026 11:57pm,"065-1930576275",UAEVP608'].join('\n')).rows;
  const r2 = compareTeamSheet(e, [tkt({ ticketNo: '5513058997', pnr: 'Y7ZS3D', date: '2026-08-05', amount: 20, reqNum: 'UAEVP608' })]);
  check('an EMD they name and we do not hold is said', r2.unaccounted.map(u => u.ref), ['1930576275']);
  const r3 = compareTeamSheet(e, [tkt({ ticketNo: '5513058997', pnr: 'Y7ZS3D', date: '2026-08-05', amount: 20, reqNum: 'UAEVP608' })], [], {}, { voided: ['1930576275'] });
  check('unless it is a void', r3.unaccounted, []);
}

console.log('\n10d. A cell priced as one, and the EMDs on its rows');
{
  // Their real cell: "079-5513303522 - 016-5513303523" at 17,140 (RTS: 5,700 + 11,420).
  // Ours: 5513303523 at 11,420, and 5513303522 at 320 - its seat's price.
  const s = sheet(['079-5513303522  -  016-5513303523,XZZFFO,Issued,17140.00,,18/8/2026 11:20pm,IATA Portal (UAE),UAECO593'])
    .map(r => ({ ...r, currency: 'AED' }));
  const short = [
    tkt({ ticketNo: '5513303523', pnr: 'XZZFFO', date: '2026-08-20', amount: 11420, reqNum: 'UAECO593', source: 'RTS' }),
    tkt({ ticketNo: '5513303522', pnr: 'XZZFFO', date: '2026-08-26', amount: 320, reqNum: 'UAECO593', source: 'RTS' }),
  ];
  const r = compareTeamSheet(s, short);
  const f = r.findings.find(x => x.verdict === 'PRICE_DIFFERS');
  check('the cell is 5,400 short', /5,400\.00 short in our books/.test(f?.note ?? ''), true);
  const right = [short[0], { ...short[1], amount: 5700, totalDoc: 5700 }];
  check('right, it agrees', compareTeamSheet(s, right).findings.some(x => x.verdict === 'PRICE_DIFFERS'), false);
  // A cell written at each ticket's price: 640.00 for two tickets at 640.00.
  const each = sheet(['633-5512559512 // 633-5512559513,ABC123,Issued,640.00,,5/5/2026 1:00pm,IATA Portal (UAE),UAEVP322'])
    .map(r => ({ ...r, currency: 'AED' }));
  const two = ['5512559512', '5512559513'].map(n => tkt({ ticketNo: n, pnr: 'ABC123', date: '2026-05-05', amount: 640, reqNum: 'UAEVP322' }));
  check('a cell priced per ticket is not a difference', compareTeamSheet(each, two).findings.some(x => x.verdict === 'PRICE_DIFFERS'), false);
  // An EMD on a voided row went with it.
  const H = 'Ticket Number,PNR,Status,Net Cost,Issued Date & Time,EMD Number,REQ No (Auto) (Trip) (from Aviation Quotations)';
  const v = parseTeamSheet([H, '176-4861509015,ZM6KT3,Void,436.00,31/8/2026 1:00pm,176-1950146234,UAECO119'].join('\n')).rows;
  check('an EMD on a void row is not missing', compareTeamSheet(v, [], [], {}, { voided: ['4861509015'] }).unaccounted, []);
}

console.log('\n10e. A row naming two bookings');
{
  // Their row: 065-6906136385, PNR "8KIDTX, BD4C2H", Saudia,Flyadeal via "Ibtkar RUH,F3", 1,233.27 SAR.
  const H = 'Ticket Number,PNR,Status,Net Cost,Total Cost with Currency,Issued Date & Time,Airline,Portal,REQ No (Auto) (MICE) (from Aviation Quotations)';
  const s = parseTeamSheet([H, '065-6906136385,"8KIDTX, BD4C2H",Issued,1233.27,1233.267 SAR,3/6/2026 1:29pm,"Saudia,Flyadeal","Ibtkar RUH,F3",KSAML1857'].join('\n')).rows;
  const ours = [
    tkt({ ticketNo: '6906136385', pnr: '8KIDTX', date: '2026-06-03', amount: 509, currency: 'SAR', source: 'Ibtekar', reqNum: 'KSAML1857' }),
    tkt({ ticketNo: 'BD4C2H', pnr: 'BD4C2H', date: '2026-06-03', amount: 428.04, currency: 'AED', source: 'FlyAdeal DXB', reqNum: 'KSAML1857' }),
  ];
  const r = compareTeamSheet(s, ours);
  check('not a price difference on the one ticket', r.findings.some(f => f.verdict === 'PRICE_DIFFERS'), false);
  check('and the second booking is on their sheet', r.findings.some(f => f.verdict === 'NOT_ON_SHEET'), false);
  // Two locators for one booking - one carrier - is not two bookings.
  const one = parseTeamSheet([H, '016-7265561496,IXGMPZ|Y29G7O,Issued,65.99,65.99 AED,27/8/2026 2:23pm,Delta Air Lines,AL Website,UAECO593'].join('\n')).rows;
  const r2 = compareTeamSheet(one, [
    tkt({ ticketNo: '7265561496', pnr: 'IXGMPZ|Y29G7O', date: '2026-08-27', amount: 65.99, reqNum: 'UAECO593', source: 'Airline Website' }),
    tkt({ ticketNo: '5513303525', pnr: 'Y29G7O', date: '2026-08-27', amount: 10010, reqNum: 'UAECO593', source: 'RTS' }),
  ]);
  check('two locators of one booking pull nothing in', r2.findings.find(f => f.serial === '5513303525')?.verdict, 'NOT_ON_SHEET');
}

console.log('\n11. Why two requests differ');
check('one digit apart', reqDiffHint('UAEVP711', 'UAEVP771'), 'One digit apart - most likely a typo on one of the two sides.');
check('another prefix', /same number under another prefix/.test(reqDiffHint('UAEC125', 'UAECO125')), true);
check('a label, not a request', /label rather than/.test(reqDiffHint('COMPANY EXPENSE', 'UAECO623')), true);
check('two plain requests say nothing', reqDiffHint('UAEVP504', 'UAEVP522'), '');

console.log('\n13. One request, out of the whole sheet or its own export');
{
  const whole = [{ reqNum: 'UAEVP420', n: 1 }, { reqNum: 'UAEVP771', n: 2 }, { reqNum: '', n: 3 }, { reqNum: 'UAEVP420-UAEVP421', n: 4 }];
  check('the whole sheet is cut to its rows', rowsForRequests(whole, ['UAEVP420']).map(r => r.n), [1, 4]);
  const own = [{ reqNum: 'UAEVP420', n: 1 }, { reqNum: '', n: 2 }];
  check('its own export is taken whole, unnamed rows too', rowsForRequests(own, ['UAEVP420']).map(r => r.n), [1, 2]);
  check('nothing typed: every row', rowsForRequests(whole, []).length, 4);
}

console.log('\n14. Who has to act on a finding');
{
  const held = [{ id: 'x' }] as any;
  check('a ticket missing from our books is ours to settle', whoActs({ verdict: 'NOT_IN_LEDGER', ours: [] }), 'US');
  check('a request that differs is ours to decide', whoActs({ verdict: 'REQ_DIFFERS', ours: held }), 'US');
  check('"EMD" in their ticket column, and we hold it: theirs to tidy', whoActs({ verdict: 'UNREADABLE', ours: held }), 'THEM');
  check('the same, and we hold nothing: ours to look into', whoActs({ verdict: 'UNREADABLE', ours: [] }), 'US');
  check('a refund we hold they have not marked: theirs', whoActs({ verdict: 'REFUND_NOT_ON_SHEET', ours: held }), 'THEM');
  check('voided and never billed: nobody', whoActs({ verdict: 'VOID_NOT_BILLED', ours: [] }), 'INFO');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
