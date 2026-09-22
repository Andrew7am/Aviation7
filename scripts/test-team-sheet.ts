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
  parseTeamSheet, teamSerial, teamSerials, ticketUnreadable, excelDamaged,
  teamStatus, money, currencyOf,
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

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n27. One cell, several tickets');
{
  // Their export puts a whole booking in one cell when it was issued or
  // refunded as one. Both shapes appear in the same file.
  const stacked = '065-5512129318/P1\n065-5512129319/P2\n065-5512129320/P3';
  check('three from a stacked cell', teamSerials(stacked).map(x => x.serial),
    ['5512129318', '5512129319', '5512129320']);
  check('their airlines too', teamSerials(stacked).map(x => x.airlineCode),
    ['065', '065', '065']);
  check('three from a comma-separated cell',
    teamSerials('065-5512559596,065-5512559597,065-5512559598').map(x => x.serial),
    ['5512559596', '5512559597', '5512559598']);
  check('an ordinary cell still gives one',
    teamSerials('065-5513059078').map(x => x.serial), ['5513059078']);
  check('the same number twice is one',
    teamSerials('065-5513059078, 065-5513059078').map(x => x.serial), ['5513059078']);

  // The fault this replaced: the digits of the whole cell with the last ten
  // kept, which turned the stacked cell into ticket 5121293203 - a number
  // that exists nowhere, reported as missing, sending somebody to look for
  // a ticket that was never issued.
  check('no number is invented from the join',
    teamSerials(stacked).some(x => x.serial === '5121293203'), false);
  check('and a cell of pure noise yields nothing',
    teamSerials('N/A - see email').map(x => x.serial), []);
}

console.log('\n28. Each ticket in a shared cell becomes a row of its own');
{
  const p = parseTeamSheet([
    'Ticket Number,PNR,Status,Net Cost,Total Cost with Currency,Refund Amount',
    '"065-5512129318/P1\n065-5512129319/P2\n065-5512129320/P3",ZTWOXW,Cancelled/Refunded,5730,5730 AED,',
  ].join('\n'));
  check('three rows out of one', p.rows.length, 3);
  check('each knows the group size', p.rows.map(r => r.groupSize), [3, 3, 3]);
  check('and who it shared with', p.rows[0].siblings, ['5512129319', '5512129320']);
  check('they share their line number', p.rows.map(r => r.rowNo), [2, 2, 2]);
  check('and their status', p.rows.every(r => r.status === 'REFUNDED'), true);
  check('and their PNR', p.rows.every(r => r.pnr === 'ZTWOXW'), true);

  // Three tickets on their sheet, three in our books, all refunded.
  const ledger: Ticket[] = ['5512129318', '5512129319', '5512129320'].flatMap(n => [
    tkt({ ticketNo: n, pnr: 'ZTWOXW', amount: 2470, reqNum: 'KSAML1198' }),
    tkt({ ticketNo: n, pnr: 'ZTWOXW', amount: -1910, status: 'REFUND', reqNum: 'KSAML1198' }),
  ]);
  const r = compareTeamSheet(p.rows, ledger);
  check('all three agree', r.counts.OK, 3);
  // Before the split, one invented ticket was reported missing and the
  // three real ones were reported as refunds their sheet did not show.
  check('nothing is called missing', r.counts.NOT_IN_LEDGER, 0);
  check('and no refund is called unrecorded', r.counts.REFUND_NOT_ON_SHEET, 0);
  check('the sheet is clean', r.clean, true);
}

console.log('\n29. The money on a shared cell belongs to the booking');
{
  const p = parseTeamSheet([
    'Ticket Number,PNR,Status,Net Cost,Total Cost with Currency,Refund Amount',
    '"065-5512129318,065-5512129319",ZTWOXW,Cancelled/Refunded,5730,5730 AED,3820',
  ].join('\n'));
  const ledger: Ticket[] = ['5512129318', '5512129319'].flatMap(n => [
    tkt({ ticketNo: n, pnr: 'ZTWOXW', amount: 2865 }),
    tkt({ ticketNo: n, pnr: 'ZTWOXW', amount: -1910, status: 'REFUND' }),
  ]);
  const r = compareTeamSheet(p.rows, ledger);
  // 3,820 is the pair's refund, not either ticket's 1,910. Compared against
  // one ticket it would report a difference on both, every time.
  check('a shared figure is not compared per ticket', r.counts.REFUND_DIFFERS, 0);
  check('both agree', r.counts.OK, 2);
  // A figure on a cell naming ONE ticket is still compared.
  const single = parseTeamSheet([
    'Ticket Number,PNR,Status,Refund Amount',
    '065-5512129318,ZTWOXW,Cancelled/Refunded,3820',
  ].join('\n'));
  check('an ordinary row still has its refund checked',
    compareTeamSheet(single.rows, ledger.slice(0, 2)).counts.REFUND_DIFFERS, 1);
}

console.log('\n30. A ticket number their export damaged');
{
  // Excel stores a 13-digit number as a number and rounds it away.
  check('scientific notation is unreadable', ticketUnreadable('6.55512E+11'), true);
  check('and so is the other one',           ticketUnreadable('2.35551E+12'), true);
  // Their ways of writing "not issued yet" are states, not faults.
  check('two dashes are not damage',  ticketUnreadable('--'), false);
  check('three dashes either',        ticketUnreadable('---'), false);
  check('a zero is not damage',       ticketUnreadable('0'), false);
  check('nor a blank',                ticketUnreadable(''), false);
  check('nor a readable number',      ticketUnreadable('065-5513059078'), false);

  const p = parseTeamSheet([
    'Ticket Number,PNR,Status',
    '6.55512E+11,XEBUG7,Issued',
    '---,ZV2XCQ,On Hold',
  ].join('\n'));
  check('the damaged row survives', p.rows.length, 2);
  check('flagged',       p.rows[0].unreadable, true);
  check('the hold is not', p.rows[1].unreadable, false);
  check('and the raw cell is kept to show them', p.rows[0].rawTicket, '6.55512E+11');

  const r = compareTeamSheet(p.rows, [], ['KSAML1198']);
  check('reported',   r.counts.UNREADABLE, 1);
  check('separately from the hold', r.counts.NOT_ISSUED_YET, 1);
  check('the note quotes their cell',
    r.findings.find(f => f.verdict === 'UNREADABLE')!.note.includes('6.55512E+11'), true);
}

console.log('\n31. A damaged number identified by its PNR');
{
  const p = parseTeamSheet([
    'Ticket Number,PNR,Status',
    '6.55512E+11,XEBUG7,Issued',
  ].join('\n'));
  // Exactly one ticket of ours carries that PNR and nothing else on their
  // sheet accounts for it, so the row is that ticket.
  const one = compareTeamSheet(p.rows,
    [tkt({ ticketNo: '5512369246', pnr: 'XEBUG7', reqNum: 'KSAML1198' })], ['KSAML1198']);
  check('the ticket is named',
    one.findings.find(f => f.verdict === 'UNREADABLE')?.serial, '5512369246');
  check('the note says how',
    one.findings.find(f => f.verdict === 'UNREADABLE')!.note.includes('PNR XEBUG7 identifies it'),
    true);
  // And it must not ALSO be reported as missing from their sheet - that
  // would be counting one fault twice.
  check('not reported missing as well', one.counts.NOT_ON_SHEET, 0);
  check('their side is credited with it', one.byRequest[0].theirTickets, 1);

  // Ambiguity is not guessed at. A PNR covering three tickets cannot say
  // which one a damaged row is.
  const many = compareTeamSheet(p.rows, [
    tkt({ ticketNo: '5512369246', pnr: 'XEBUG7', reqNum: 'KSAML1198' }),
    tkt({ ticketNo: '5512369247', pnr: 'XEBUG7', reqNum: 'KSAML1198' }),
  ], ['KSAML1198']);
  check('nothing is claimed',
    many.findings.find(f => f.verdict === 'UNREADABLE')?.serial, '');
  check('and both are still reported as unaccounted for', many.counts.NOT_ON_SHEET, 2);

  // Nor when their sheet already accounts for that PNR's ticket elsewhere.
  const taken = compareTeamSheet(parseTeamSheet([
    'Ticket Number,PNR,Status',
    '6.55512E+11,XEBUG7,Issued',
    '065-5512369246,XEBUG7,Issued',
  ].join('\n')).rows,
    [tkt({ ticketNo: '5512369246', pnr: 'XEBUG7', reqNum: 'KSAML1198' })], ['KSAML1198']);
  check('the damaged row claims nothing',
    taken.findings.find(f => f.verdict === 'UNREADABLE')?.serial, '');
  check('the readable row matched it', taken.counts.OK, 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n32. The separators their cells really use');
{
  // A tab is what a paste out of a spreadsheet leaves behind, and it was
  // the one separator not being split on - which ran 180-5512938098 and
  // 618-5512878156 together into 551-2938098618, a ticket that exists
  // nowhere. The same fault as 5121293203, by a different route.
  const tabbed = '176-5512938024\t180-5512878154 , 180-5512938098\t618-5512878156';
  const got = teamSerials(tabbed).map(d => `${d.airlineCode}-${d.serial}`);
  check('tabs split',  got,
    ['176-5512938024', '180-5512878154', '180-5512938098', '618-5512878156']);
  check('no number invented across a tab',
    got.some(x => x.includes('2938098618')), false);
  check('a double slash splits',
    teamSerials('176-5512878152 // 180-5512878155').map(d => d.serial),
    ['5512878152', '5512878155']);
  check('two spaces split',
    teamSerials('180-5512938022        618-5512938112').map(d => d.serial),
    ['5512938022', '5512938112']);

  // A number typed with spaces inside it is still one number - but only
  // when reading the piece as written yielded nothing, so joining can
  // never run two documents into a third.
  check('spaces inside one number', teamSerials('084 2318 700 632').map(d => d.serial),
    ['2318700632']);
  check('and its airline', teamSerials('084 2318 700 632')[0].airlineCode, '084');
}

console.log('\n33. Consecutive tickets written as a range');
{
  // Both systems write them this way, and until now the second ticket of
  // every pair existed nowhere.
  check('two', teamSerials('176-5512938024-25').map(d => d.serial),
    ['5512938024', '5512938025']);
  check('a three-digit tail', teamSerials('1763000541793-794').map(d => d.serial),
    ['3000541793', '3000541794']);
  check('the airline carries to both',
    teamSerials('176-5512938024-25').map(d => d.airlineCode), ['176', '176']);
  check('a longer run fills in',
    teamSerials('065-5512129318-20').map(d => d.serial),
    ['5512129318', '5512129319', '5512129320']);

  // Bounded, because an unbounded range is another way to invent tickets.
  check('a backwards range is not a range',
    teamSerials('065-5512129320-18').map(d => d.serial), ['5512129320']);
  check('a wild jump is not a range',
    teamSerials('065-5512129318-99').map(d => d.serial), ['5512129318']);
  check('a tail as long as the serial is not a range',
    teamSerials('5512129318-5512129319').map(d => d.serial),
    ['5512129318', '5512129319']);
}

console.log('\n34. A carrier reference is a document too');
{
  // The low-cost carriers issue no IATA ticket; the booking reference IS
  // the document, and our ledger stores 188 of them as the ticket number.
  // Calling them unreadable refused to match tickets sitting in both lists
  // under the same reference.
  check('letters and digits', teamSerials('RX12237H6T9J5').map(d => d.serial), ['RX12237H6T9J5']);
  check('flydubai', teamSerials('8K6NYC').map(d => d.serial), ['8K6NYC']);
  check('six letters, no digit — FlyAdeal', teamSerials('EDINGX').map(d => d.serial), ['EDINGX']);
  check('two in one cell', teamSerials('RBA5VB // B7YYHM').map(d => d.serial),
    ['RBA5VB', 'B7YYHM']);
  check('lower case is lifted', teamSerials('rx12237h6t9j5').map(d => d.serial), ['RX12237H6T9J5']);

  // And the things in that column that are not documents at all.
  for (const junk of ['F3', 'fz', 'EMD', '2000', '10000', '22222', '02', '1',
                      'Issued', 'NICOLETTE LEE NOBLE', '--3pax +1inf',
                      '1.ALORENI/FOZIAH ABDULLAH', 'AIR ARABIA'])
    check(`"${junk}" is not a document`, teamSerials(junk).length, 0);
  // A word of exactly six letters would pass the all-letter shape, so it
  // has to be uppercase in their file as every real reference is.
  check('a capitalised word is not a reference', teamSerials('Issued').length, 0);
  check('but an uppercase six is', teamSerials('ZJOHIT').map(d => d.serial), ['ZJOHIT']);

  check('Excel wreckage is still not a reference', teamSerials('6.55512E+11').length, 0);
  check('and is still called damage', excelDamaged('6.55512E+11'), true);
  check('a reference with an E is not damage', excelDamaged('6E3M6D'), false);
  check('and is read as the reference it is',
    teamSerials('6E3M6D').map(d => d.serial), ['6E3M6D']);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n35. The same reference in two different columns');
{
  // A carrier that issues no IATA ticket gives one reference that is both
  // the booking and the document, and the two systems chose different
  // columns for it: our Riyadh Air rows keep RX12237ZB622D in the PNR with
  // a numeric document beside it, their sheet keeps it in the ticket
  // column. Matching ticket against ticket, those never meet.
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    'RX12237ZB622D,RX12237ZB622D,Issued,UAEVP575',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '2100060907', pnr: 'RX12237ZB622D', reqNum: 'UAEVP575', amount: 6670 }),
    tkt({ ticketNo: '4200006305', pnr: 'RX12237ZB622D', reqNum: 'UAEVP575', amount: 450 }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('not called missing',        r.counts.NOT_IN_LEDGER, 0);
  check('reported as a filing difference', r.counts.FILED_ELSEWHERE, 1);
  check('and it carries our rows',
    r.findings.find(f => f.verdict === 'FILED_ELSEWHERE')?.ours.length, 2);
  check('the request comes from ours',
    r.findings.find(f => f.verdict === 'FILED_ELSEWHERE')?.reqNum, 'UAEVP575');
  check('and ours are not reported missing either', r.counts.NOT_ON_SHEET, 0);
  check('the sheet can still be closed', r.clean, true);

  // The other way round: our reference sitting in their PNR column.
  const flip = compareTeamSheet(
    parseTeamSheet('Ticket Number,PNR,Status\n065-5513059078,EDINGX,Issued').rows,
    [tkt({ ticketNo: '5513059078', pnr: 'EDINGX' }),
     tkt({ ticketNo: 'EDINGX', pnr: 'EDINGX', source: 'FlyAdeal DXB', amount: 867.89 })]);
  check('our reference in their PNR column is not missing', flip.counts.NOT_ON_SHEET, 0);
}

console.log('\n36. A serial is never matched against a PNR');
{
  // A ten-digit document in a PNR column is somebody's mistake, not a
  // filing convention. Pairing on it would invent a match.
  const sheet = parseTeamSheet(
    'Ticket Number,PNR,Status\n065-5513059078,YSLM73,Issued').rows;
  const r = compareTeamSheet(sheet,
    [tkt({ ticketNo: '9999999999', pnr: '5513059078', reqNum: 'KSAML2053' })], ['KSAML2053']);
  check('no cross-column match on a serial', r.counts.FILED_ELSEWHERE, 0);
  check('theirs is still reported missing', r.counts.NOT_IN_LEDGER, 1);
  check('and ours still reported unlisted', r.counts.NOT_ON_SHEET, 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log('\n37. A refund has two right answers, before and after our commission');
{
  // We keep both: totalDoc is what the airline refunded, amount is what
  // reached us once our commission came back off it. Their sheet records
  // sometimes one and sometimes the other, so agreement with either is
  // agreement. Real figures from 065-5513427734.
  const sheet = (refund: number) => parseTeamSheet([
    'Ticket Number,PNR,Status,Refund Amount',
    `065-5513427734,XNGWTQ,Cancelled/Refunded,${refund}`,
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513427734', pnr: 'XNGWTQ', amount: 846, totalDoc: 940, commission: 94 }),
    tkt({ ticketNo: '5513427734', pnr: 'XNGWTQ', amount: -316, totalDoc: 410,
          commission: -94, status: 'REFUND' }),
  ];

  check('their figure is our net',   compareTeamSheet(sheet(316), ledger).counts.REFUND_DIFFERS, 0);
  // The one this was getting wrong: their 410 IS our 410, before commission.
  check('their figure is our gross', compareTeamSheet(sheet(410), ledger).counts.REFUND_DIFFERS, 0);
  check('the gross one agrees',      compareTeamSheet(sheet(410), ledger).counts.OK, 1);
  // Neither, and by more than rounding.
  check('neither of the two',        compareTeamSheet(sheet(900), ledger).counts.REFUND_DIFFERS, 1);

  const f = compareTeamSheet(sheet(900), ledger).findings
    .find(x => x.verdict === 'REFUND_DIFFERS')!;
  check('the note gives both of ours',
    f.note.includes('316.00 after commission') && f.note.includes('410.00 before'), true);
  check('and the nearest gap', f.note.includes('490.00'), true);

  // A ticket with no commission has one answer, and it still works.
  const plain: Ticket[] = [
    tkt({ ticketNo: '5513427734', pnr: 'XNGWTQ', amount: 940, totalDoc: 940 }),
    tkt({ ticketNo: '5513427734', pnr: 'XNGWTQ', amount: -410, totalDoc: 410, status: 'REFUND' }),
  ];
  check('no commission, agrees',   compareTeamSheet(sheet(410), plain).counts.REFUND_DIFFERS, 0);
  check('no commission, disagrees', compareTeamSheet(sheet(900), plain).counts.REFUND_DIFFERS, 1);
  check('and the note gives one figure, not two',
    compareTeamSheet(sheet(900), plain).findings
      .find(x => x.verdict === 'REFUND_DIFFERS')!.note.includes('after commission'), false);
}

console.log('\n37b. Rounding between two systems is not a disagreement');
{
  // What this keeps out: fils. What it keeps in: the four real gaps on the
  // export, the smallest of which is 120.
  const sheet = (refund: number) => parseTeamSheet([
    'Ticket Number,PNR,Status,Refund Amount',
    `065-5513058939,YLGKIH,Cancelled/Refunded,${refund}`,
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513058939', pnr: 'YLGKIH', amount: 2630, totalDoc: 2630 }),
    tkt({ ticketNo: '5513058939', pnr: 'YLGKIH', amount: -2050, totalDoc: 2050, status: 'REFUND' }),
  ];
  check('twenty-two fils',   compareTeamSheet(sheet(2050.22), ledger).counts.REFUND_DIFFERS, 0);
  check('nine dirhams',      compareTeamSheet(sheet(2059), ledger).counts.REFUND_DIFFERS, 0);
  check('forty-nine',        compareTeamSheet(sheet(2099), ledger).counts.REFUND_DIFFERS, 0);
  check('fifty is the line', compareTeamSheet(sheet(2100), ledger).counts.REFUND_DIFFERS, 1);
  // The real one: their sheet says 600 came back, ours says 2,050.
  check('and the real one', compareTeamSheet(sheet(600), ledger).counts.REFUND_DIFFERS, 1);
  check('by 1,450',
    compareTeamSheet(sheet(600), ledger).findings
      .find(x => x.verdict === 'REFUND_DIFFERS')!.note.includes('1,450.00'), true);
}

console.log('\n38. A refund their sheet states twice cannot be compared');
{
  // Their normal shape is two rows, one Issued and one Cancelled/Refunded,
  // with only the second carrying a figure. Sometimes both carry one, and
  // adding those together is how 815 became 1,630 and was reported as a
  // disagreement with our books by exactly the amount they had repeated.
  const twice = parseTeamSheet([
    'Ticket Number,PNR,Status,Refund Amount',
    '065-5512369322,ZG2MIC,Cancelled/Refunded,815',
    '065-5512369322,ZG2MIC,Cancelled/Refunded,815',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5512369322', pnr: 'ZG2MIC', amount: 835 }),
    tkt({ ticketNo: '5512369322', pnr: 'ZG2MIC', amount: -815, status: 'REFUND' }),
  ];
  const r = compareTeamSheet(twice, ledger);
  check('not reported as a difference', r.counts.REFUND_DIFFERS, 0);
  check('reported as their duplication', r.counts.TWICE_ON_THEIR_SHEET, 1);
  const f = r.findings.find(x => x.verdict === 'TWICE_ON_THEIR_SHEET')!;
  check('the note names both rows', f.note.includes('row 2') && f.note.includes('row 3'), true);
  check('and what we hold',          f.note.includes('815.00'), true);

  // Their ordinary two rows — issue then refund, one figure — still compare.
  const normal = parseTeamSheet([
    'Ticket Number,PNR,Status,Refund Amount',
    '065-5512369322,ZG2MIC,Issued,',
    '065-5512369322,ZG2MIC,Cancelled/Refunded,815',
  ].join('\n')).rows;
  const ok = compareTeamSheet(normal, ledger);
  check('one figure across two rows is normal', ok.counts.TWICE_ON_THEIR_SHEET, 0);
  check('and it agrees', ok.counts.OK, 1);

  // Two different figures is the same contradiction, not a partial refund
  // we can add up: one of the two rows is wrong.
  const conflicting = parseTeamSheet([
    'Ticket Number,PNR,Status,Refund Amount',
    '065-5512369322,ZG2MIC,Cancelled/Refunded,10410',
    '065-5512369322,ZG2MIC,Cancelled/Refunded,740',
  ].join('\n')).rows;
  check('two different figures too',
    compareTeamSheet(conflicting, ledger).counts.TWICE_ON_THEIR_SHEET, 1);
}

console.log('\n39. Their export carries the request in two columns');
{
  // A booking is raised against a MICE request or a Trip one, and their
  // export has a column for each. Every row fills exactly one and never
  // both. Reading only the first column found dropped the request on 706
  // of 1,903 rows, and every one of them would have been reported as
  // filed differently from our books.
  const HEAD = 'Ticket Number,PNR,Status,'
    + 'REQ No (Auto) (MICE) (from Aviation Quotations),'
    + 'REQ No (Auto) (Trip) (from Aviation Quotations)';
  const two = parseTeamSheet([
    HEAD,
    '065-5513059078,YSLM73,Issued,KSAML2053,',
    '065-5513059077,YQX75R,Issued,,UAEVP420',
  ].join('\n'));
  check('the MICE column is read', two.rows[0].reqNum, 'KSAML2053');
  check('and the Trip column too', two.rows[1].reqNum, 'UAEVP420');

  // Their account column contains the words "Aviation Requests" and must
  // never be taken for one of them.
  const withAccount = parseTeamSheet([
    'Ticket Number,PNR,Status,'
      + 'MICE Account (from Aviation Requests) (from Aviation Quotations),'
      + 'REQ No (Auto) (Trip) (from Aviation Quotations)',
    '065-5513059078,YSLM73,Issued,AbbVie,UAEVP420',
  ].join('\n'));
  check('the account is not a request', withAccount.rows[0].reqNum, 'UAEVP420');
  check('and it is still read as the account', withAccount.rows[0].account, 'AbbVie');

  // One column still works, which is every other export.
  const single = parseTeamSheet(
    'Ticket Number,PNR,Status,Req Num\n065-5513059078,YSLM73,Issued,KSAML2053');
  check('a single column is unaffected', single.rows[0].reqNum, 'KSAML2053');
  check('and none at all is still blank',
    parseTeamSheet('Ticket Number,PNR,Status\n065-5513059078,YSLM73,Issued').rows[0].reqNum, '');
}

console.log('\n40. MLMI and FM are one department written two ways');
{
  // The agency's own rule: if the number matches it is the same file,
  // whichever of the two is written. Eight of the ninety-four "filed
  // differently" findings were nothing but this spelling.
  check('the same request', sameReq('UAEMLMI2221', 'UAEFM2221'), true);
  check('and again',        sameReq('UAEMLMI2071', 'UAEFM2071'), true);
  check('either way round', sameReq('UAEFM2071', 'UAEMLMI2071'), true);
  check('KSA too',          sameReq('KSAMLMI1446', 'KSAFM1446'), true);
  // The number still has to match. Folding the letters must not fold the
  // requests themselves together.
  check('a different number is a different request',
    sameReq('KSAMLMI1446', 'KSAFM1470'), false);
  check('and a different office still differs',
    sameReq('UAEMLMI2221', 'KSAFM2221'), false);
  check('ML is not MLMI',   sameReq('UAEML2221', 'UAEFM2221'), false);

  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num',
    '065-5513059078,YSLM73,Issued,UAEFM2221',
  ].join('\n')).rows;
  check('so it is not reported as misfiled',
    compareTeamSheet(sheet, [tkt({ ticketNo: '5513059078', pnr: 'YSLM73',
      reqNum: 'UAEMLMI2221' })]).counts.REQ_DIFFERS, 0);
}

console.log('\n41. Nothing of ours predates their system');
{
  // Their first ticket is dated 9 February 2026. Our rows from before that
  // cannot be on a sheet that did not exist, and 230 of them were being
  // reported as missing from one.
  const sheet = parseTeamSheet([
    'Ticket Number,PNR,Status,Req Num,Issued Date & Time',
    '065-5513059078,YSLM73,Issued,KSAML2053,09/02/2026 10:00am',
  ].join('\n')).rows;
  const ledger: Ticket[] = [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', date: '2026-02-09' }),
    // Under the same request, and issued before their sheet begins.
    tkt({ ticketNo: '5599999901', pnr: 'AAAAAA', date: '2025-11-30' }),
    // And one from after, which is a real gap.
    tkt({ ticketNo: '5599999902', pnr: 'BBBBBB', date: '2026-06-01' }),
  ];
  const r = compareTeamSheet(sheet, ledger);
  check('the floor is read from their file', r.sheetFrom, '2026-02-09');
  check('the older row is not reported',     r.counts.NOT_ON_SHEET, 1);
  check('and it is the newer one',
    r.findings.find(f => f.verdict === 'NOT_ON_SHEET')?.serial, '5599999902');
  // Counted, never silently dropped.
  check('the older row is counted',          r.beforeTheirSystem, 1);
  // A row dated the same day as their first ticket is inside, not outside.
  const sameDay = compareTeamSheet(sheet, [
    tkt({ ticketNo: '5513059078', pnr: 'YSLM73', date: '2026-02-09' }),
    tkt({ ticketNo: '5599999903', pnr: 'CCCCCC', date: '2026-02-09' }),
  ]);
  check('the first day itself is in scope', sameDay.counts.NOT_ON_SHEET, 1);
  check('and nothing is counted as older',  sameDay.beforeTheirSystem, 0);

  // A sheet with no dates at all sets no floor, and everything is compared.
  const undated = compareTeamSheet(
    parseTeamSheet('Ticket Number,PNR,Status,Req Num\n065-5513059078,YSLM73,Issued,KSAML2053').rows,
    ledger);
  check('no dates, no floor',        undated.sheetFrom, '');
  check('so the old row is reported', undated.counts.NOT_ON_SHEET, 2);
  check('and none counted as older',  undated.beforeTheirSystem, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
