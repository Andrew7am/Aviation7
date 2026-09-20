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
import { compareTeamSheet } from '../src/core/helpers/teamSheetCompare';
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
