/**
 * The aviation team's sheet against our ledger.
 *
 * This is the check somebody signs a flight sheet on the strength of, so the
 * two ways it could lie both matter: a finding that is not real wastes a
 * morning, and a finding it fails to raise is money nobody chases. The tests
 * below are written against the shapes their real export actually contains -
 * "--" and "0" in the ticket column, "Cancelled/Refunded" standing for two
 * events, a ticket voided the same day it was issued - rather than against
 * a tidy invented one.
 */
import {
  parseTeamSheet, teamSerial, teamStatus, money, currencyOf,
} from '../src/core/parsers/teamSheet';
import {
  compareTeamSheet, reqKey, sameReq, reqParts, buildRelations, relatedReq,
} from '../src/core/helpers/teamSheetCompare';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2), ticketNo: '5513059078', pnr: 'YSLM73',
  passengerName: 'A PASSENGER', airlineCode: '065', route: 'RUH/CAI', source: 'IATA BSP',
  date: '2026-08-20', amount: 1430, totalDoc: 1430, commission: 0, reqNum: 'KSAML2053',
  vendorReference: '', status: 'ISSUE', currency: 'AED', isDuplicate: false,
  closed: false, userId: 'u', ...o,
});

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n1. Their ticket column, in every shape it really arrives in');
{
  check('plain',            teamSerial('065-5513373360'), { serial: '5513373360', airlineCode: '065' });
  check('space not dash',   teamSerial('065 5513059137'), { serial: '5513059137', airlineCode: '065' });
  check('leading space',    teamSerial(' 065-5513059115'), { serial: '5513059115', airlineCode: '065' });
  check('trailing slash',   teamSerial(' 065-5513059104/'), { serial: '5513059104', airlineCode: '065' });
  check('run together',     teamSerial('0655513059104'), { serial: '5513059104', airlineCode: '065' });
  check('bare serial',      teamSerial('5513059104'), { serial: '5513059104', airlineCode: '' });
  // A row with no ticket is a booking on hold, not a broken row.
  check('two dashes',       teamSerial('--'), { serial: '', airlineCode: '' });
  check('a zero',           teamSerial('0'), { serial: '', airlineCode: '' });
  check('blank',            teamSerial(''), { serial: '', airlineCode: '' });
  check('nothing at all',   teamSerial(undefined), { serial: '', airlineCode: '' });
}

console.log('\n2. Their status words');
{
  check('Issued',             teamStatus('Issued'), 'ISSUED');
  check('Reissue is a sale',  teamStatus('Reissue'), 'ISSUED');
  // One row standing for two events: issued, then refunded.
  check('Cancelled/Refunded', teamStatus('Cancelled/Refunded'), 'REFUNDED');
  check('Void',               teamStatus('Void'), 'VOID');
  // Cancelled with no refund is not the same claim as Cancelled/Refunded.
  check('bare Cancelled',     teamStatus('Cancelled'), 'VOID');
  check('On Hold',            teamStatus('On Hold'), 'ON_HOLD');
  check('blank',              teamStatus(''), 'UNKNOWN');
}

console.log('\n3. Amounts and currencies out of their cells');
{
  check('thousands separator', money('2,530.00'), 2530);
  check('decimal comma',       money('588,00'), 588);
  check('with a currency',     money('1371 SAR'), 1371);
  check('blank is not zero',   money(''), null);
  check('currency named',      currencyOf('1371 SAR'), 'SAR');
  check('currency named AED',  currencyOf('300 AED'), 'AED');
  check('no currency',         currencyOf('2530.00'), '');
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n4. Their file, read as a whole');
const CSV = [
  'Ticket Number,PNR,Status,Time Limit (If On Hold),Department,'
    + 'MICE Account (from Aviation Requests) (from Aviation Quotations),Net Cost,TAX,'
    + 'Total Cost with Currency,Rate with MU (Manual Entry),Issued Date & Time,'
    + 'Refund Recieved?,Refund Amount,Ticket Type',
  ' 065-5513059078,YSLM73,Issued,,MICE Local,AbbVie,1430.00,,1430 AED,,20/8/2026 12:31pm,,,TKT',
  '065-5513059077,YQX75R,Cancelled/Refunded,,MICE Local,AbbVie,1530.00,,1530 AED,,20/8/2026 10:08am,checked,1190.00,TKT',
  '065-5513059099,ZZWM3X,Void,,MICE Local,AbbVie,2070.00,,2070 AED,,23/8/2026 1:16pm,,,TKT',
  '--,X25CZR,On Hold,24/8/2026 10:09pm,MICE Local,AbbVie,2070.00,,2070 AED,,22/8/2026 10:09pm,,,TKT',
].join('\n');
{
  const p = parseTeamSheet(CSV);
  check('no complaint',        p.problem, '');
  check('four rows',           p.rows.length, 4);
  check('the serial',          p.rows[0].serial, '5513059078');
  check('the airline',         p.rows[0].airlineCode, '065');
  check('the PNR',             p.rows[0].pnr, 'YSLM73');
  check('their cost',          p.rows[0].cost, 1430);
  check('the currency',        p.rows[0].currency, 'AED');
  // 20/8/2026 read the other way round would be 8 August.
  check('day comes first',     p.rows[0].issued, '2026-08-20');
  check('the refund',          p.rows[1].refund, 1190);
  check('refund received',     p.rows[1].refundReceived, true);
  check('not received',        p.rows[0].refundReceived, false);
  check('the row number',      p.rows[1].rowNo, 3);
  check('the account',         p.rows[0].account, 'AbbVie');

  // "Refund Recieved?" and "Refund Amount" both start with the same word.
  check('the two refund columns are told apart',
    [p.rows[1].refund, p.rows[1].refundReceived], [1190, true]);
  // Their account column is called "(from Aviation Requests)". Read loosely
  // it would be taken for the request number and every row would claim one.
  check('the account is not mistaken for a request', p.rows[0].reqNum, '');
}

console.log('\n5. A file that cannot be used says so');
{
  check('no ticket column',
    parseTeamSheet('PNR,Status\nABC123,Issued').problem, 'No ticket number column in that file.');
  check('header only',
    parseTeamSheet('Ticket Number,PNR\n').problem, 'That file has no rows under its header.');
  check('nothing at all', parseTeamSheet('').rows.length, 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n6. The comparison, on the four things that can differ');
{
  const sheet = parseTeamSheet(CSV).rows;
  const ledger: Ticket[] = [
    // Matches their first row exactly.
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', amount: 1430 }),
    // They refunded it and so did we.
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: 1530 }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: -1190, status: 'REFUND' }),
    // Under the same request, and nowhere on their sheet.
    tkt({ ticketNo: '5513059999', pnr: 'ZZZZZZ', amount: 900 }),
  ];
  const r = compareTeamSheet(sheet, ledger);

  check('the request is found from the matches', r.requests, ['KSAML2053']);
  check('agreeing tickets',    r.counts.OK, 2);
  check('their void is not a gap', r.counts.VOID_NOT_BILLED, 1);
  check('their hold is not a gap',  r.counts.NOT_ISSUED_YET, 1);
  check('ours they never list',     r.counts.NOT_ON_SHEET, 1);
  check('which one',
    r.findings.find(f => f.verdict === 'NOT_ON_SHEET')?.serial, '5513059999');
  check('not a clean sheet', r.clean, false);
  check('their rows counted', r.theirRows, 4);
  check('their tickets counted', r.theirTickets, 3);
  check('matched', r.matched, 2);
}

console.log('\n7. The finding that is money: a refund on their side only');
{
  const sheet = parseTeamSheet(CSV).rows;
  // Same as above, minus our refund row.
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: 1530 }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('raised',   r.counts.REFUND_NOT_IN_LEDGER, 1);
  const f = r.findings.find(x => x.verdict === 'REFUND_NOT_IN_LEDGER')!;
  check('on the right ticket', f.serial, '5513059077');
  check('and it names the amount', f.note.includes('1,190.00'), true);
}

console.log('\n8. And the same thing the other way round');
{
  const sheet = parseTeamSheet(CSV).rows;
  const ledger: Ticket[] = [
    // They say Issued; we hold a refund against it.
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', amount: 1430 }),
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', amount: -1430, status: 'REFUND' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: 1530 }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: -1190, status: 'REFUND' }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('raised', r.counts.REFUND_NOT_ON_SHEET, 1);
  check('on the right ticket',
    r.findings.find(f => f.verdict === 'REFUND_NOT_ON_SHEET')?.serial, '5513059078');
}

console.log('\n9. Both refunded, for different money');
{
  const sheet = parseTeamSheet(CSV).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: 1530 }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: -964, status: 'REFUND' }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('raised', r.counts.REFUND_DIFFERS, 1);
  check('the difference is named',
    r.findings.find(f => f.verdict === 'REFUND_DIFFERS')?.note.includes('226.00'), true);
  // A blank refund cell is not a claim that the refund was zero.
  const blank = parseTeamSheet(CSV.replace(',checked,1190.00,TKT', ',checked,,TKT')).rows;
  check('a blank refund cell raises nothing',
    compareTeamSheet(blank, ledger).counts.REFUND_DIFFERS, 0);
}

console.log('\n10. A ticket on their sheet that reached nobody');
{
  const sheet = parseTeamSheet(CSV).rows;
  const r = compareTeamSheet(sheet, []);
  // With no ledger at all there is no request, so the boundary is empty and
  // only their side can be reported. That is the honest answer: we cannot
  // say what is missing from their sheet without knowing what to compare.
  check('their unbilled tickets', r.counts.NOT_IN_LEDGER, 2);
  check('their void still reads as a void', r.counts.VOID_NOT_BILLED, 1);
  check('nothing claimed about our side', r.counts.NOT_ON_SHEET, 0);
  check('no request could be found', r.requests, []);
}

console.log('\n11. Things the comparison must NOT do');
{
  const sheet = parseTeamSheet(CSV).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', amount: 1430 }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: 1530 }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: -1190, status: 'REFUND' }),
    // A wallet payment under the same request. It is not a ticket and must
    // never be reported as one their sheet forgot.
    tkt({ ticketNo: 'FUND_2026_08', status: 'FUND', amount: -50000, pnr: '' }),
    // Another request entirely: outside the boundary, so silent.
    tkt({ ticketNo: '5599999999', reqNum: 'UAEVP711', amount: 700 }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('a top-up is not a missing ticket',
    r.findings.some(f => f.serial.startsWith('FUND')), false);
  check('another request is left alone',
    r.findings.some(f => f.serial === '5599999999'), false);
  // Their cost is 1,430 against our 1,430 here, but the point is that even a
  // wild difference is not a finding - their column carries their markup.
  const marked = compareTeamSheet(
    parseTeamSheet(CSV.replace('1430.00,,1430 AED', '9999.00,,9999 SAR')).rows, ledger);
  check('a different cost is not a finding', marked.counts.OK, 2);
}

console.log('\n12. A sheet where everything agrees says so');
{
  const clean = [
    'Ticket Number,PNR,Status,Net Cost,Total Cost with Currency,Refund Amount',
    '065-5513059078,YSLM73,Issued,1430.00,1430 AED,',
  ].join('\n');
  const r = compareTeamSheet(parseTeamSheet(clean).rows,
    [tkt({ ticketNo: '5513059078', pnr: 'YSLM73' })]);
  check('clean', r.clean, true);
  check('one match', r.counts.OK, 1);

  // A void and a row on hold are states of the world, not disagreements, so
  // a sheet carrying only those is still a sheet that can be closed.
  const withVoid = compareTeamSheet(parseTeamSheet(CSV).rows, [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: 1530 }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', amount: -1190, status: 'REFUND' }),
  ]);
  check('a void and a hold do not block a sheet', withVoid.clean, true);
}

console.log('\n13. A sheet that names its own request widens the boundary');
{
  // Their export sometimes carries the request. Then our rows under it can
  // be checked even when not one of their tickets has reached the ledger.
  const withReq = [
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,KSAML2053',
  ].join('\n');
  const p = parseTeamSheet(withReq);
  check('the request is read', p.rows[0].reqNum, 'KSAML2053');
  const r = compareTeamSheet(p.rows, [tkt({ ticketNo: '5513059911', pnr: 'QQQQQQ' })]);
  check('boundary taken from their sheet', r.requests, ['KSAML2053']);
  check('our unlisted ticket is found', r.counts.NOT_ON_SHEET, 1);
  check('and theirs is reported unbilled', r.counts.NOT_IN_LEDGER, 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n14. The request is the point: same ticket, different file');
{
  // Both sides hold both tickets. Nothing is missing, every count agrees,
  // and one of them is in the wrong request - which is the only way two
  // request totals can be wrong while everything looks right.
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,KSAML2053',
    '065-5513059077,YQX75R,Issued,KSAML2064',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', reqNum: 'KSAML2053' }),
  ];
  const r = compareTeamSheet(sheet, ledger);

  check('the misfiling is found',  r.counts.REQ_DIFFERS, 1);
  check('the agreeing one is left alone', r.counts.OK, 1);
  const f = r.findings.find(x => x.verdict === 'REQ_DIFFERS')!;
  check('on the right ticket',     f.serial, '5513059077');
  check('our request is carried',  f.reqNum, 'KSAML2053');
  check('and theirs beside it',    f.theirReq, 'KSAML2064');
  check('the note names both',
    f.note.includes('KSAML2053') && f.note.includes('KSAML2064'), true);
  // It is reported first. A missing ticket is at least visible as a gap;
  // this one is invisible everywhere else.
  check('reported before anything else', r.findings[0].verdict, 'REQ_DIFFERS');
  check('and it is not a clean sheet', r.clean, false);
}

console.log('\n15. Spelling is not filing');
{
  check('case only',      sameReq('KSAML2053', 'ksaml2053'), true);
  check('a space',        sameReq('KSAML 2053', 'KSAML2053'), true);
  check('a dash',         sameReq('KSAML-2053', 'KSAML2053'), true);
  check('padding',        sameReq('  KSAML2053  ', 'KSAML2053'), true);
  check('a real difference', sameReq('KSAML2053', 'KSAML2064'), false);
  // A request that genuinely covers two is not either of its halves.
  check('a combined request stays itself',
    sameReq('KSAML1145-UAEFM2193', 'KSAML1145'), false);
  check('the key strips only punctuation', reqKey('ksa ml-2053.'), 'KSAML2053');
  check('blank', reqKey(''), '');

  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,ksaml 2053',
  ].join('\n')).rows;
  const r = compareTeamSheet(sheet,
    [tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' })]);
  check('so a differently typed request is not a mismatch', r.counts.REQ_DIFFERS, 0);
  check('it agrees', r.counts.OK, 1);
}

console.log('\n16. Their sheet has a request and our row has none');
{
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,KSAML2053',
  ].join('\n')).rows;
  const r = compareTeamSheet(sheet,
    [tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: '' })]);
  check('raised as a filing difference', r.counts.REQ_DIFFERS, 1);
  check('and it says our row has none',
    r.findings[0].note.includes('no request at all'), true);
  // Worth having: their sheet can fill the gap our books left.
  check('their request is on the finding', r.findings[0].theirReq, 'KSAML2053');
}

console.log('\n17. Request by request — the row a sheet is closed on');
{
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,KSAML2053',
    '065-5513059077,YQX75R,Issued,KSAML2053',
    '065-5513059099,ZZWM3X,Issued,KSAML2053',   // theirs only
    '065-5513059100,ZZCL45,Issued,KSAML2064',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', reqNum: 'KSAML2053' }),
    tkt({ ticketNo: '5513059555', pnr: 'QQQQQQ', reqNum: 'KSAML2053' }),  // ours only
    tkt({ ticketNo: '5513059100', pnr: 'ZZCL45', reqNum: 'KSAML2064' }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('both requests listed', r.byRequest.map(x => x.reqNum), ['KSAML2053', 'KSAML2064']);

  const a = r.byRequest[0];
  check('their count',   a.theirTickets, 3);
  check('our count',     a.ourTickets, 3);
  check('only theirs',   a.onlyTheirs, 1);
  check('only ours',     a.onlyOurs, 1);
  check('does not agree', a.agrees, false);

  const b = r.byRequest[1];
  check('the clean request agrees', b.agrees, true);
  check('with one each way', [b.theirTickets, b.ourTickets, b.onlyTheirs, b.onlyOurs],
    [1, 1, 0, 0]);

  // The counts are equal on a misfiling, which is exactly why the misfiled
  // column has to exist: without it that request reads as balanced.
  const mis = compareTeamSheet(parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,KSAML2064',
  ].join('\n')).rows, [tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' })]);
  check('a misfiling is counted on BOTH requests',
    mis.byRequest.map(x => [x.reqNum, x.misfiled]),
    [['KSAML2053', 1], ['KSAML2064', 1]]);
  check('and neither request agrees', mis.byRequest.every(x => x.agrees), false);
}

console.log('\n18. A sheet with no request column says so, and still does its half');
{
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status',
    '065-5513059078,YSLM73,Issued',
  ].join('\n')).rows;
  const r = compareTeamSheet(sheet, [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' }),
    tkt({ ticketNo: '5513059555', pnr: 'QQQQQQ', reqNum: 'KSAML2053' }),
  ]);
  check('the screen is told', r.sheetHasReq, false);
  // No request on their side means no filing to disagree with. Claiming a
  // mismatch there would be inventing one.
  check('no filing difference is invented', r.counts.REQ_DIFFERS, 0);
  // The half that can still be answered, is.
  check('what we hold and they do not is still found', r.counts.NOT_ON_SHEET, 1);
  check('their side is counted against what we file it under',
    r.byRequest.map(x => [x.theirTickets, x.ourTickets, x.onlyOurs]), [[1, 2, 1]]);

  const withReq = compareTeamSheet(parseTeamSheet([
    'Ticket Number,PNR,Status,Request',
    '065-5513059078,YSLM73,Issued,KSAML2053',
  ].join('\n')).rows, []);
  check('and a sheet that has one says that', withReq.sheetHasReq, true);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n19. A req field can name more than one request');
{
  // Every joining style the ledger actually contains.
  check('a dash',        reqParts('KSAML43-SA1157'), ['KSAML43', 'SA1157']);
  check('spaces around it', reqParts('KSAFM2175 - KSAML1533'), ['KSAFM2175', 'KSAML1533']);
  check('a pipe',        reqParts('SA765|REQ10567'), ['SA765', 'REQ10567']);
  check('a label between', reqParts('REQ10949|FIT|REQ11432'), ['REQ10949', 'REQ11432']);
  check('nothing between', reqParts('UAECO201UAECO250'), ['UAECO201', 'UAECO250']);
  // The long prefix must survive: KSAMLMI1446, not SAMLMI1446.
  check('a long office prefix', reqParts('KSAMLMI1446-SA1196'), ['KSAMLMI1446', 'SA1196']);
  check('an ordinary one',  reqParts('KSAML2053'), ['KSAML2053']);
  check('lower case',       reqParts('ksaml2053'), ['KSAML2053']);

  // A label is one thing, however many dashes it has. Splitting ADM-NOT AN
  // ADM into two requests would invent one that does not exist.
  check('a label with a dash', reqParts('ADM-NOT AN ADM'), ['ADMNOTANADM']);
  check('a plain label',       reqParts('COMPANY EXPENSE'), ['COMPANYEXPENSE']);
  check('nothing',             reqParts(''), []);
}

console.log('\n20. Cash tickets: two requests that belong together');
{
  // The ledger says these two are one piece of work, the only way it can:
  // one row filed under both.
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', reqNum: 'KSAML43-SA1157' }),
    tkt({ ticketNo: '5513059077', reqNum: 'KSAML43' }),
    tkt({ ticketNo: '5513059076', reqNum: 'SA1157' }),
    tkt({ ticketNo: '5513059075', reqNum: 'KSAML2053' }),
  ];
  const rel = buildRelations(ledger);
  check('linked',        relatedReq('KSAML43', 'SA1157', rel), 'RELATED');
  check('both ways',     relatedReq('SA1157', 'KSAML43', rel), 'RELATED');
  check('itself',        relatedReq('KSAML43', 'KSAML43', rel), 'SAME');
  check('one field naming both counts as the same',
    relatedReq('KSAML43-SA1157', 'SA1157', rel), 'SAME');
  check('an unrelated request', relatedReq('KSAML43', 'KSAML2053', rel), 'DIFFERENT');
  check('a request nobody linked', relatedReq('KSAML2053', 'UAEVP711', rel), 'DIFFERENT');

  // A written with B, B written with C: all three are one piece of work,
  // because that is what the two rows say between them.
  const chain = buildRelations([
    { reqNum: 'A1-B2' }, { reqNum: 'B2-C3' },
  ]);
  check('relations carry through', relatedReq('A1', 'C3', chain), 'RELATED');
}

console.log('\n21. So a cash split is not reported as a misfiling');
{
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    // The row that records the two as one piece of work, on both sides.
    '065-5513059078,AAAAAA,Issued,KSAML43-SA1157',
    // And the cash ticket, which they raised under the other number.
    '065-5513059077,YQX75R,Issued,SA1157',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'AAAAAA', reqNum: 'KSAML43-SA1157' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', reqNum: 'KSAML43' }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('not called a mistake', r.counts.REQ_DIFFERS, 0);
  check('reported as related',  r.counts.REQ_RELATED, 1);
  check('the note says why',
    r.findings.find(f => f.verdict === 'REQ_RELATED')!.note.includes('one piece of work'), true);
  // The whole point: this does not stop a sheet being closed.
  check('and the sheet can still be closed', r.clean, true);

  // Without that link in the ledger it IS a misfiling, and is reported so.
  const unlinked = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059077,YQX75R,Issued,SA1157',
  ].join('\n')).rows;
  const noLink = compareTeamSheet(unlinked,
    [tkt({ ticketNo: '5513059077', pnr: 'YQX75R', reqNum: 'KSAML43' })]);
  check('unlinked requests are still caught', noLink.counts.REQ_DIFFERS, 1);
  check('and that does stop the sheet', noLink.clean, false);
}

console.log('\n22. A combined request counts under both its halves');
{
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,AAAAAA,Issued,KSAML43',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'AAAAAA', reqNum: 'KSAML43-SA1157' }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  // Keyed on the whole string, both requests would look empty.
  check('both requests are in scope', r.requests, ['KSAML43', 'SA1157']);
  check('and both hold the ticket',
    r.byRequest.map(x => [x.reqNum, x.ourTickets]), [['KSAML43', 1], ['SA1157', 1]]);
  check('their naming one half is agreement, not a mismatch', r.counts.OK, 1);
  check('each names the other',
    r.byRequest.map(x => x.related), [['SA1157'], ['KSAML43']]);
  check('nothing to settle', r.clean, true);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n23. Typing the request their sheet does not carry');
{
  // Their real export has no request column. One typed request is a claim
  // about the whole sheet, and every check should then run exactly as it
  // would on an export that said it.
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status',
    '065-5513059078,YSLM73,Issued',
    '065-5513059077,YQX75R,Issued',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', reqNum: 'KSAML2064' }),
  ];

  const without = compareTeamSheet(sheet, ledger);
  check('without it the filing check cannot run', without.reqSource, 'none');
  check('and nothing is claimed about filing', without.counts.REQ_DIFFERS, 0);

  const withIt = compareTeamSheet(sheet, ledger, ['KSAML2053']);
  check('typed is recorded as typed',  withIt.reqSource, 'typed');
  check('and never as their file',     withIt.sheetHasReq, false);
  check('what was typed is carried',   withIt.declared, ['KSAML2053']);
  // The one filed elsewhere is now findable, which is the whole point.
  check('the misfiling surfaces',      withIt.counts.REQ_DIFFERS, 1);
  check('on the right ticket',
    withIt.findings.find(f => f.verdict === 'REQ_DIFFERS')?.serial, '5513059077');
  check('the other agrees',            withIt.counts.OK, 1);
  check('and it shows as their request',
    withIt.findings.find(f => f.verdict === 'REQ_DIFFERS')?.theirReq, 'KSAML2053');
}

console.log('\n24. What is typed fills gaps and never overrides their file');
{
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,KSAML2064',   // their file says so
    '065-5513059077,YQX75R,Issued,',            // their file is silent
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2064' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', reqNum: 'KSAML2053' }),
  ];
  const r = compareTeamSheet(sheet, ledger, ['KSAML2053']);
  // The stated row keeps what their file said, so it still agrees with ours.
  check('their own request wins', r.counts.REQ_DIFFERS, 0);
  check('and the blank row took the typed one', r.counts.OK, 2);
  // Their file did state a request somewhere, so that is what the screen
  // should say it is reading.
  check('the source is their sheet', r.reqSource, 'sheet');
}

console.log('\n25. Several requests typed for one sheet');
{
  // Nothing says which row belongs to which, so the only honest question
  // left is whether a ticket is filed under one of them at all.
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status',
    '065-5513059078,YSLM73,Issued',
    '065-5513059077,YQX75R,Issued',
    '065-5513059076,ZZCL45,Issued',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' }),
    tkt({ ticketNo: '5513059077', pnr: 'YQX75R', reqNum: 'KSAML2064' }),
    tkt({ ticketNo: '5513059076', pnr: 'ZZCL45', reqNum: 'UAEVP711' }),
  ];
  const r = compareTeamSheet(sheet, ledger, ['KSAML2053', 'KSAML2064']);
  check('both declared are in scope',
    r.requests.includes('KSAML2053') && r.requests.includes('KSAML2064'), true);
  // Two are inside the declared set, so nothing is said about which of the
  // two each belongs to. The third is in neither.
  check('only the outsider is questioned', r.counts.REQ_DIFFERS, 1);
  check('and it is the right one',
    r.findings.find(f => f.verdict === 'REQ_DIFFERS')?.serial, '5513059076');
  check('the note says why',
    r.findings.find(f => f.verdict === 'REQ_DIFFERS')?.note.includes('not among them'), true);
  check('the declared set is carried', r.declared, ['KSAML2053', 'KSAML2064']);

  // A request related to a declared one still counts as inside it.
  const rel = compareTeamSheet(sheet, [
    ...ledger.slice(0, 2),
    tkt({ ticketNo: '5513059076', pnr: 'ZZCL45', reqNum: 'SA1157' }),
    tkt({ ticketNo: '5599999999', pnr: 'AAAAAA', reqNum: 'KSAML2053-SA1157' }),
  ], ['KSAML2053', 'KSAML2064']);
  check('a related request is not an outsider', rel.counts.REQ_DIFFERS, 0);
}

console.log('\n26. A typed request is cleaned the same way a read one is');
{
  const sheet = parseTeamSheet('Ticket Number,PNR,Status\n065-5513059078,YSLM73,Issued').rows;
  const ledger = [tkt({ ticketNo: '5513059078', pnr: 'YSLM73', reqNum: 'KSAML2053' })];
  check('spacing and case', compareTeamSheet(sheet, ledger, ['ksaml 2053']).counts.OK, 1);
  check('padding',          compareTeamSheet(sheet, ledger, ['  KSAML2053 ']).counts.OK, 1);
  // An empty box is not a declaration.
  check('blank is ignored', compareTeamSheet(sheet, ledger, ['', '  ']).reqSource, 'none');
  check('and so is nothing at all', compareTeamSheet(sheet, ledger, []).reqSource, 'none');
  // A declared request with no tickets at all is still worth showing: it is
  // the request somebody expected this sheet to fill.
  const empty = compareTeamSheet([], [], ['KSAML9999']);
  check('a declared request is in scope even when empty', empty.requests, ['KSAML9999']);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
