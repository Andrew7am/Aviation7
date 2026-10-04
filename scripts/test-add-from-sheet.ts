/**
 * "Add them to the ledger" cannot mean "add all of them".
 *
 * Most of what the team-sheet check finds cannot go in unread, and each
 * reason costs real money if it is ignored:
 *
 *   - A shared cell prices a whole booking and arrives at zero, so recording
 *     it writes a ticket worth nothing into a request's cost.
 *   - A row from Ibtekar or NSA settles against a credit wallet. Keyed by
 *     hand it moves that balance twice — once now and again when their
 *     statement is imported — and the wallet is wrong by the price of the
 *     ticket until somebody finds it.
 *   - A row with no date sits in no period, so it drops out of every
 *     statement comparison and makes a total quietly fail to foot.
 *
 * So the button records what already passes every test the confirm button
 * applies, and queues the rest with the reason. The test is the SAME
 * function — whyNotConfirmable — because two definitions of "ready" is how a
 * row gets in one way that could not get in the other.
 */
import { planSheetAdd, waitingReasons } from '../src/core/helpers/addFromSheet';
import { whyNotConfirmable } from '../src/core/helpers/pendingFromFindings';
import type { Finding } from '../src/core/helpers/teamSheetCompare';
import type { TeamSheetRow } from '../src/core/parsers/teamSheet';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

let n = 0;
const newId = () => `id${++n}`;
const plan = (findings: Finding[], tickets: Ticket[] = []) =>
  planSheetAdd(findings, { newId, userId: 'u', tickets });

/** A row of their sheet, as their parser produces one. */
const row = (o: Partial<TeamSheetRow> = {}): TeamSheetRow => ({
  rowNo: 275, rawTicket: '065-5513373350', groupSize: 1, siblings: [],
  unreadable: false, excelDamaged: false,
  serial: '5513373350', airlineCode: '065', pnr: 'XNZBUG',
  status: 'ISSUED' as TeamSheetRow['status'], rawStatus: 'Issued',
  cost: 18200, currency: 'AED', refund: null, refundReceived: false,
  issued: '2026-08-12', account: '', department: '', member: 'ALNOMAN HATEM',
  airline: '', portal: 'IATA BSP', reqNum: 'KSAML2218', ticketType: '',
  ...o,
});

/** A NOT_IN_LEDGER finding, as the check produces one. */
const finding = (o: Partial<TeamSheetRow> = {}): Finding => {
  const sheet = row(o);
  return {
    verdict: 'NOT_IN_LEDGER', serial: sheet.serial, airlineCode: sheet.airlineCode,
    pnr: sheet.pnr, sheet, ours: [], reqNum: '', theirReq: sheet.reqNum,
    note: '', source: sheet.portal,
  } as unknown as Finding;
};

const tkt = (ticketNo: string): Ticket => ({
  id: ticketNo, ticketNo, source: 'IATA BSP', date: '2026-08-12', amount: 100,
  totalDoc: 100, commission: 0, reqNum: 'KSAML2218', status: 'ISSUE',
  isDuplicate: false, userId: 'u', currency: 'AED',
});

console.log('\n1. A complete row goes straight in');
{
  const p = plan([finding()]);
  check('one ready', p.ready.length, 1);
  check('nothing waiting', p.waiting.length, 0);
  check('it carries their figure', p.ready[0].amount, 18200);
  check('and their request', p.ready[0].reqNum, 'KSAML2218');
  check('filed under the portal that sold it', p.ready[0].source, 'IATA BSP');
}

console.log('\n2. A wallet vendor is never keyed by hand');
{
  // Ibtekar and NSA bill on a statement that settles against a credit
  // wallet. This row is exactly the one in the screenshot: Ibtekar, held.
  const p = plan([finding({ portal: 'Ibtekar', reqNum: 'KSAML2467', cost: 217,
                            currency: 'SAR', serial: '4861806209' })]);
  check('nothing recorded', p.ready.length, 0);
  check('it waits instead', p.waiting.length, 1);
  check('and says why', p.waiting[0].why.length > 0, true);
  check('  ...it is the held-back reason, not a missing field',
        /wallet|statement|held/i.test(p.waiting[0].why), true);
}

console.log('\n3. A shared cell prices a booking, not a ticket');
{
  // Their sheet repeats the booking's value beside every coupon, so the
  // proposal arrives at zero and somebody has to divide it.
  const p = plan([finding({ groupSize: 5, siblings: ['1','2','3','4'], cost: 6390 })]);
  check('nothing recorded', p.ready.length, 0);
  check('it waits', p.waiting.length, 1);
  check('and the reason names the head count',
        p.waiting[0].why.includes('5'), true);
}

console.log('\n4. A row that does not say when');
{
  const p = plan([finding({ issued: '' })]);
  check('nothing recorded', p.ready.length, 0);
  check('and the reason asks for a date',
        /date/i.test(p.waiting[0]?.why ?? ''), true);
}

console.log('\n5. A row with no figure at all');
{
  const p = plan([finding({ cost: null })]);
  check('nothing recorded', p.ready.length, 0);
  check('and it asks for the cost', /cost/i.test(p.waiting[0]?.why ?? ''), true);
}

console.log('\n6. Ready means exactly what the confirm button means');
{
  /* If these two ever disagree, a row goes into the ledger through this
     door that the review queue would have refused — or the other way
     round, and the button looks broken. */
  const cases = [
    finding(),
    finding({ portal: 'Ibtekar' }),
    finding({ issued: '' }),
    finding({ cost: null }),
    finding({ groupSize: 4, siblings: ['1','2','3'] }),
  ];
  const p = plan(cases);
  check('every ready row passes whyNotConfirmable',
        p.ready.every(r => whyNotConfirmable(r) === ''), true);
  check('every waiting row fails it',
        p.waiting.every(w => whyNotConfirmable(w.proposal) !== ''), true);
  check('and its reason is the same words',
        p.waiting.every(w => w.why === whyNotConfirmable(w.proposal)), true);
  check('none is lost between the two piles',
        p.ready.length + p.waiting.length + p.alreadyHeld.length, cases.length);
}

console.log('\n7. Pressing it twice does not write the ticket twice');
{
  // The findings are a snapshot of a comparison already run. Press again,
  // or run the check again after adding, and without this every row would
  // arrive a second time.
  const f = finding();
  const first = plan([f]);
  check('first time it goes in', first.ready.length, 1);

  const ledger = [tkt('065-5513373350')];
  const second = plan([f], ledger);
  check('second time it does not', second.ready.length, 0);
  check('it is reported as already held', second.alreadyHeld.length, 1);
  check('and it is not queued for review either', second.waiting.length, 0);
}

console.log('\n8. The same document twice inside one batch');
{
  // Their sheet lists a reissue on two rows often enough.
  const p = plan([finding(), finding()]);
  check('one recorded', p.ready.length, 1);
  check('the other recognised as the same document', p.alreadyHeld.length, 1);
}

console.log('\n9. Punctuation is not identity');
{
  const p = plan([finding({ serial: '5513373350' })], [tkt('0655513373350')]);
  check('an unpunctuated ledger row still matches', p.alreadyHeld.length, 1);
  check('and nothing is added', p.ready.length, 0);
}

console.log('\n10. What the screen is told');
{
  const p = plan([
    finding({ portal: 'Ibtekar', serial: '1111111111' }),
    finding({ portal: 'NSA', serial: '2222222222' }),
    finding({ issued: '', serial: '3333333333' }),
  ]);
  const reasons = waitingReasons(p);
  check('the reasons are grouped', reasons.length >= 1, true);
  check('and they count to the number waiting',
        reasons.reduce((s, r) => s + r.count, 0), p.waiting.length);
  check('commonest first',
        reasons.every((r, i) => i === 0 || reasons[i - 1].count >= r.count), true);
}

console.log('\n11. Nothing to do is not an error');
{
  const p = plan([]);
  check('no ready', p.ready, []);
  check('no waiting', p.waiting, []);
  check('no reasons', waitingReasons(p), []);
}

console.log('\n9. A refund, and the ticket it refunds');
{
  // U92Z3D: bought on Air India Express's site at 1,460.00, 700.00 refunded the same day.
  const sale = finding({ serial: 'U92Z3D', rawTicket: 'U92Z3D', pnr: 'U92Z3D', airlineCode: '', cost: 1460,
    portal: 'AL Website', reqNum: 'UAECO788', issued: '2026-10-02' });
  const refund = { ...finding({ serial: 'U92Z3D', rawTicket: 'U92Z3D', pnr: 'U92Z3D', airlineCode: '', cost: null,
    refund: 700, status: 'REFUNDED' as TeamSheetRow['status'], rawStatus: 'Cancelled/Refunded',
    portal: 'AL Website', reqNum: 'UAECO788', issued: '2026-10-02' }), verdict: 'REFUND_NOT_IN_LEDGER' } as Finding;
  const p = plan([sale, refund]);
  check('both go in together', p.ready.map(x => x.amount), [1460, -700]);
  check('neither is "already in the books"', p.alreadyHeld.length, 0);

  // A BSP ticket we hold, which their sheet says was refunded.
  const bspRefund = { ...finding({ cost: null, refund: 7025, status: 'REFUNDED' as TeamSheetRow['status'],
    rawStatus: 'Cancelled/Refunded' }), verdict: 'REFUND_NOT_IN_LEDGER' } as Finding;
  const q = plan([bspRefund], [tkt('5513373350')]);
  check('a supplier\'s refund is not taken from their sheet', q.ready.length, 0);
  check('it waits for the supplier\'s report', /arrives with its own report/.test(q.waiting[0]?.why ?? ''), true);
  check('and is not mistaken for one already held', q.alreadyHeld.length, 0);

  // A website purchase we hold, refunded: no report will ever show it.
  const webSale = { ...tkt('U92Z3D'), source: 'Airline Website', pnr: 'U92Z3D', amount: 1460 };
  check('a website refund is taken from their sheet', plan([refund], [webSale]).ready.map(x => x.amount), [-700]);
  check('and a refund we already hold is held', plan([refund], [webSale, { ...webSale, id: 'r', amount: -700, status: 'REFUND' }]).alreadyHeld.length, 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
