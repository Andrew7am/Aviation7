/**
 * What the Team Sheet Check remembers between runs.
 *
 *   npx tsx scripts/test-sheet-memory.ts
 *
 * A difference explained once stays explained while its figures stay what
 * they were, and comes back when they change. And the next sheet is read
 * against the last: what is new, what changed, what went.
 */
import { parseTeamSheet } from '../src/core/parsers/teamSheet';
import { compareTeamSheet } from '../src/core/helpers/teamSheetCompare';
import { explanationKey, fingerprint, snapRows, sheetDiff } from '../src/core/helpers/sheetMemory';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const HEAD = 'Ticket Number,PNR,Status,Net Cost,Total Cost with Currency,Refund Amount,Issued Date & Time,Portal,REQ No (Auto) (Trip) (from Aviation Quotations)';
const sheet = (rows: string[]) => parseTeamSheet([HEAD, ...rows].join('\n')).rows;
const tkt = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36).slice(2), ticketNo: '', pnr: '', passengerName: '',
  airlineCode: '016', route: '', source: 'RTS', date: '2026-09-13', amount: 0, totalDoc: 0, commission: 0, reqNum: 'UAEVP711',
  vendorReference: '', status: 'ISSUE', currency: 'AED', isDuplicate: false, closed: false, userId: 'u', reportName: 'RTS', ...o } as Ticket);

console.log('\n1. An explained difference stays explained - at its figures');
{
  // 5513437053: their sheet "refunds" 4,600.00 - a staff liability, not a refund.
  const s = sheet([
    '016-5513437053,ZO8TOX,Reissue,0.00,0 AED,,13/9/2026 7:13pm,RTS,UAEVP711',
    '016-5513437053,ZO8TOX,Cancelled/Refunded,4600.00,4600 AED,4600.00,29/9/2026 1:33pm,RTS,UAEVP711',
  ]);
  const ours = [tkt({ ticketNo: '5513437053', pnr: 'ZO8TOX', amount: 0, transactionType: 'REISSUE' })];
  const before = compareTeamSheet(s, ours);
  const f = before.findings.find(x => /^REFUND_(NOT_IN_LEDGER|AWAITING_BILLING)$/.test(x.verdict))!;
  check('the difference is there', !!f, true);
  const ex = [{ id: '1', findingKey: explanationKey(f), fingerprint: fingerprint(f), note: 'Staff liability, not a refund' }];
  const after = compareTeamSheet(s, ours, [], {}, { explanations: ex });
  const g = after.findings.find(x => /^REFUND_(NOT_IN_LEDGER|AWAITING_BILLING)$/.test(x.verdict))!;
  check('explained, with the reason', g.explained, 'Staff liability, not a refund');
  check('and the sheet is clean', after.clean, true);
  // Their figure changes: it comes back.
  const s2 = sheet([
    '016-5513437053,ZO8TOX,Reissue,0.00,0 AED,,13/9/2026 7:13pm,RTS,UAEVP711',
    '016-5513437053,ZO8TOX,Cancelled/Refunded,4600.00,4600 AED,4400.00,29/9/2026 1:33pm,RTS,UAEVP711',
  ]);
  const back = compareTeamSheet(s2, ours, [], {}, { explanations: ex }).findings.find(x => /^REFUND_(NOT_IN_LEDGER|AWAITING_BILLING)$/.test(x.verdict))!;
  check('a changed figure brings it back', [back.explained, back.explainedBefore], [undefined, 'Staff liability, not a refund']);
}

console.log('\n2. A misfiling explained does not hold its request open');
{
  const s = sheet(['390-5513228009,XS7MLB,Issued,2420.00,2420 AED,,11/8/2026 1:00pm,RTS,UAECO623']);
  const ours = [tkt({ ticketNo: '5513228009', pnr: 'XS7MLB', amount: 2420, reqNum: 'COMPANY EXPENSE' })];
  const f = compareTeamSheet(s, ours).findings.find(x => x.verdict === 'REQ_DIFFERS')!;
  const r = compareTeamSheet(s, ours, [], {}, { explanations: [{ id: '1', findingKey: explanationKey(f), fingerprint: fingerprint(f), note: 'Ours is right' }] });
  check('the request agrees', r.byRequest.every(x => x.agrees), true);
}

console.log('\n3. What changed since the last sheet');
{
  const last = snapRows(sheet([
    '065-5513427772,ZZWSI5,Issued,1800.00,1800 AED,,21/9/2026 12:41pm,IATA Portal (UAE),UAEVP711',
    '065-5513427800,ZZZ111,Issued,500.00,500 AED,,21/9/2026 12:41pm,IATA Portal (UAE),UAEVP711',
  ]));
  const now = snapRows(sheet([
    '065-5513427772,ZZWSI5,Issued,1080.00,1080 AED,,21/9/2026 12:41pm,IATA Portal (UAE),UAEVP711',
    'U92Z3D,U92Z3D,Issued,1460.00,1460 AED,,2/10/2026 2:42pm,AL Website,UAECO788',
  ]));
  const d = sheetDiff(last, now);
  check('a new row', d.added.map(x => x.ref), ['U92Z3D']);
  check('a changed price', d.changed.map(x => [x.ref, x.what]), [['5513427772', 'cost 1,800.00 → 1,080.00']]);
  check('a row gone', d.removed.map(x => x.ref), ['5513427800']);
  check('the same sheet twice changes nothing', sheetDiff(now, now), { added: [], changed: [], removed: [] });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
