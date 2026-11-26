/**
 * A file's prices: commission and the aviation team's markup, ticket by
 * ticket, and what keeps a file from closing.
 *
 *   npx tsx scripts/test-price-review.ts
 */
import { classify, priceReview, priceTotals, BLOCKS_CLOSING, needsReason, blocksClosing } from '../src/core/helpers/priceReview';
import type { ProfitSheetRow } from '../src/core/helpers/aviationProfit';
import type { Ticket } from '../src/types';
import { compareTeamSheet } from '../src/core/helpers/teamSheetCompare';
import { parseTeamSheet } from '../src/core/parsers/teamSheet';
import { isAviationMarked, withoutAvMark } from '../src/core/helpers/aviationMark';
import { inSar, totalInSar } from '../src/core/helpers/sarTotal';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const row = (o: Partial<ProfitSheetRow>): ProfitSheetRow => ({ record_id: 'r1', serials: ['5513727400'], pnr: 'ABC123', status: 'Issued',
  req_num: 'KSAML2900', net_cost: 1100, currency: 'AED', issued_at: '2026-11-20T08:00:00Z', team_member: 'Kerolos Rrad',
  portal: 'IATA Portal (UAE)', airline: 'Emirates', ticket_cell: '176-5513727400', emd: '', ...o });
// The user's ticket: 1,000 fare, 100 commission, 900 to us.
const tk = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36).slice(2), ticketNo: '5513727400', source: 'IATA BSP', status: 'ISSUE',
  amount: 900, commission: 100, totalDoc: 1000, currency: 'AED', date: '2026-11-20', pnr: 'ABC123', reportName: 'IATA BSP', reqNum: 'KSAML2900', ...o } as Ticket);
const one = (netCost: number, ledger = [tk({})]) => {
  const l = priceReview([row({ net_cost: netCost })], ledger)[0];
  return [l.result, l.price, l.commission, l.net, l.markup, l.profit];
};

console.log('\n1. The user\'s example: 1,000 with 100 commission');
check('given at 1,100: 100 commission + 100 markup = 200', one(1100), ['MARKUP', 1000, 100, 900, 100, 200]);
check('given at 1,000: commission only', one(1000), ['COMMISSION_ONLY', 1000, 100, 900, 0, 100]);
check('given at 950: half the commission given away', one(950), ['PART_COMMISSION', 1000, 100, 900, -50, 50]);
check('given at 900: exactly net', one(900), ['EXACTLY_NET', 1000, 100, 900, -100, 0]);
check('given at 850: below net, a loss', one(850), ['BELOW_NET', 1000, 100, 900, -150, -50]);
check('a riyal either way is rounding: 900.80 is exactly net', one(900.8)[0], 'EXACTLY_NET');
check('...and 1,000.90 is commission only', one(1000.9)[0], 'COMMISSION_ONLY');
check('...but 898.50 is below net', one(898.5)[0], 'BELOW_NET');
check('no commission: given at the fare is exactly net', one(1000, [tk({ amount: 1000, commission: 0 })])[0], 'EXACTLY_NET');
check('Ibtekar: their 10-riyal fee is in our net (1,704), so 1,693.95 is below it',
  one(1693.95, [tk({ amount: 1704, commission: 0, totalDoc: 1693.95, source: 'Ibtekar', currency: 'AED' })]).slice(0, 2), ['BELOW_NET', 1704]);
check('classify on its own', [classify(1100, 900, 100), classify(1000, 900, 0)], ['MARKUP', 'MARKUP']);
check('only Below net and a refund above ours block closing', [...BLOCKS_CLOSING].sort(), ['BELOW_NET', 'REFUND_ABOVE']);

console.log('\n2. What is not compared');
check('before 9 Nov: counts only', priceReview([row({ issued_at: '2026-11-08T20:00:00Z' })], [tk({})]).length, 0);
check('not in our books', priceReview([row({})], []).map(l => [l.result, l.why]), [['NOT_COMPARED', 'Not in our books yet']]);
check('voided: never profit or loss', priceReview([row({})], [tk({})], { voided: ['5513727400'] }).length, 0);
check('our AED ticket priced in SAR is compared at the peg',
  priceReview([row({ currency: 'SAR', net_cost: 1100 * 3.75 / 3.6725 })], [tk({})]).map(l => [l.result, l.converted]), [['MARKUP', true]]);

console.log('\n3. One request');
const ledger = [tk({}), tk({ ticketNo: '5513727401', reqNum: 'UAEVP771' })];
const rows = [row({}), row({ record_id: 'r2', serials: ['5513727401'], req_num: 'UAEVP771' })];
check('only that request', priceReview(rows, ledger, { requests: ['UAEVP771'] }).map(l => l.docs[0]), ['5513727401']);
check('found by our request when theirs is blank',
  priceReview([row({ req_num: '' })], [tk({})], { requests: ['KSAML2900'] }).length, 1);

console.log('\n4. Refunds: their Refund Amount against what the supplier gave us');
const ref = (given: number | null, back: number | null) => priceReview(
  [row({ record_id: 'x', status: 'Cancelled/Refunded', net_cost: 200, refund_amount: given })],
  back === null ? [] : [tk({ amount: -back, commission: 0, status: 'REFUND' })])
  .filter(l => l.kind === 'REFUND').map(l => [l.result, l.net, l.toOps, l.profit, l.why ?? '']);
check('gave back what we got', ref(800, 800), [['REFUND_SAME', 800, 800, 0, '']]);
check('gave back less: the rest is ours', ref(750, 800), [['REFUND_KEPT', 800, 750, 50, '']]);
check('gave back more: a loss', ref(850, 800), [['REFUND_ABOVE', 800, 850, -50, '']]);
check('no Refund Amount on their sheet', ref(null, 800).map(x => [x[0], x[4]]), [['NOT_COMPARED', 'No Refund Amount on their sheet']]);
check('not refunded to us yet', ref(800, null).map(x => [x[0], x[4]]), [['NOT_COMPARED', 'Refund not in our books yet']]);

console.log('\n5. Totals add up');
const lines = priceReview([
  row({}), row({ record_id: 'r2', serials: ['5513727402'], net_cost: 850 }),
  row({ record_id: 'r3', serials: ['5513727403'], status: 'Cancelled/Refunded', refund_amount: 750 }),
], [tk({}), tk({ ticketNo: '5513727402' }), tk({ ticketNo: '5513727403', amount: -800, commission: 0 })]);
const [t] = priceTotals(lines);
check('commission, markup, below price, refunds', [t.commission, t.markup, t.belowPrice, t.refunds], [200, 100, -150, 50]);
check('profit = commission + markup + below price + refunds', t.profit, 200);
check('...and the same as to operations less our net, plus refunds', t.profit, (1100 + 850) - (900 + 900) + 50);
check('counted per result', Object.entries(t.counts).sort(), [['BELOW_NET', 1], ['MARKUP', 1], ['REFUND_KEPT', 1]]);
check('two currencies are never summed', priceTotals(priceReview([row({}), row({ record_id: 'r2', serials: ['5513727401'], currency: 'EUR' })],
  [tk({}), tk({ ticketNo: '5513727401', currency: 'EUR' })]), false).map(x => x.currency), ['AED', 'EUR']);

check('charged = our net + commission + aviation profit', [t.charged, t.net, t.commission, t.aviation], [1200, 1000, 200, 0]);
{
  // The user's file: 100,000 charged = 80,000 net + 10,000 commission + 10,000 aviation.
  const [f] = priceTotals(priceReview([row({ net_cost: 100000 })], [tk({ amount: 80000, commission: 10000, totalDoc: 90000 })]), false);
  check("the user's 100k file", [f.charged, f.net, f.commission, f.aviation, f.profit], [100000, 80000, 10000, 10000, 20000]);
}
{
  // A refund of a 1,000 fare: the supplier keeps back its 100 commission and pays 900.
  const r = (given: number) => priceReview([row({ record_id: 'x', status: 'Cancelled/Refunded', refund_amount: given })],
    [tk({ amount: -900, commission: -100, totalDoc: 1000, status: 'REFUND' })]).filter(l => l.kind === 'REFUND')
    .map(l => [l.result, l.price, l.commission, l.net, l.markup, l.profit]);
  check('full fare back to operations: commission goes, the team loses nothing', r(1000), [['REFUND_SAME', 1000, -100, 900, 0, -100]]);
  check('900 back to operations: the team kept the 100', r(900), [['REFUND_KEPT', 1000, -100, 900, 100, 0]]);
  check('1,100 back: above the refund, a loss to explain', r(1100), [['REFUND_ABOVE', 1000, -100, 900, -100, -200]]);
}

console.log('\n5b. A row priced per ticket, with EMD rows beside it (UAEVP771/858)');
{
  const ls = priceReview([
    row({ serials: ['5513853657', '5513853658', '5513853659'], net_cost: 17920 }),
    ...['5513853657', '5513853658', '5513853659'].map((t, i) => row({ record_id: 'e' + i, serials: [t], net_cost: 2870, emd: `065-194993339${3 + i}` })),
  ], [...['5513853657', '5513853658', '5513853659'].map(t => tk({ ticketNo: t, amount: 17920, commission: 0 })),
      ...[3, 4, 5].map(i => tk({ ticketNo: `194993339${i}`, amount: 2870, commission: 0 }))]);
  check('17,920 is each ticket\'s: 3 x 17,920 + 3 x 2,870 = ours, exactly net', ls.map(l => [l.result, l.toOps, l.net]), [['EXACTLY_NET', 62370, 62370]]);
}

console.log('\n6. The count review leaves prices from 9 Nov to this');
const verdicts = (issued: string, cost: string, refund = '') => compareTeamSheet(parseTeamSheet(
  ['Ticket Number,PNR,Status,Req Num,Net Cost,Refund Amount,Issued Date & Time,Total Cost with Currency',
   `176-5513727400,ABC123,Issued,KSAML2900,${cost},,${issued},${cost} AED`,
   ...(refund ? [`176-5513727400,ABC123,Cancelled/Refunded,KSAML2900,100,${refund},${issued},100 AED`] : [])].join('\n')).rows,
  [tk({ date: issued.split('/').reverse().join('-') }),
   ...(refund ? [tk({ amount: -800, commission: 0, status: 'REFUND', transactionType: 'REFUND', totalDoc: 800 } as Partial<Ticket>)] : [])],
  ['KSAML2900']).findings.map(f => f.verdict).filter(v => v !== 'OK');
check('below our net on 20 Nov: not a Price differs, the price review asks why', verdicts('20/11/2026', '700'), []);
check('...but on 1 Nov it is still one', verdicts('01/11/2026', '700'), ['PRICE_DIFFERS']);
check('a refund above ours on 20 Nov: the price review, not Refund differs', verdicts('20/11/2026', '1000', '850'), []);
check('...and on 1 Nov still Refund differs', verdicts('01/11/2026', '1000', '850'), ['REFUND_DIFFERS']);

console.log('\n7. Refunds marked AV: the aviation team\'s hidden profit (KSAML2747-AV)');
check('the mark', ['KSAML2747-AV', 'KSAML2425 - KSAFM2786 - AV', 'KSAML2747', 'UAEVP771', 'KSAML2747 av'].map(isAviationMarked), [true, true, false, false, true]);
check('the request under it', ['KSAML2747-AV', 'KSAML2425 - KSAFM2786 - AV', 'KSAML2747'].map(withoutAvMark), ['KSAML2747', 'KSAML2425 - KSAFM2786', 'KSAML2747']);
{
  const sale = tk({ ticketNo: '5513727231', amount: 1670, commission: 0, date: '2026-10-25', reqNum: 'KSAML2747' });
  const av = tk({ ticketNo: '5513727231', amount: -1250, commission: 0, status: 'REFUND', transactionType: 'REFUND', date: '2026-11-09', reqNum: 'KSAML2747-AV' } as Partial<Ticket>);
  const ls = priceReview([], [sale, av], { requests: ['KSAML2747'] });
  check('all of it is aviation profit, whatever the date', ls.map(l => [l.result, l.req, l.net, l.toOps, l.markup]), [['AV_PROFIT', 'KSAML2747', 1250, 0, 1250]]);
  const [t] = priceTotals(ls, false);
  check('...charged stays, our net drops, aviation rises', [t.charged, t.net, t.commission, t.aviation], [0, -1250, 0, 1250]);
  check('not in another request', priceReview([], [sale, av], { requests: ['KSAML2771'] }).length, 0);
  const csv = ['Ticket Number,PNR,Status,Req Num,Net Cost,Issued Date & Time,Total Cost with Currency',
    '176-5513727231,ABC123,Issued,KSAML2747,1670,25/10/2026,1670 AED'].join('\n');
  const rep = compareTeamSheet(parseTeamSheet(csv).rows, [sale, av], ['KSAML2747']);
  check('the sheet check leaves it out of the counts: no refund missing, not misfiled',
    [rep.findings.map(f => f.verdict).filter(v => v !== 'OK'), rep.docTypes.refunds.ours, rep.aviationMarked.map(x => x.ticketNo)],
    [[], 0, ['5513727231']]);
  const unmarked = { ...av, reqNum: 'KSAML2747' };
  check('...while the same refund unmarked is still one their sheet lacks',
    compareTeamSheet(parseTeamSheet(csv).rows, [sale, unmarked], ['KSAML2747']).findings.map(f => f.verdict).filter(v => v !== 'OK'), ['REFUND_NOT_ON_SHEET']);
}

console.log('\n8. The file in riyals too: AED x 1.02 (the user, 26 Nov)');
check('KSAML2747 charged: 40,560 AED + 4,692.14 SAR', inSar({ AED: 40560, SAR: 4692.14 }), { sar: 46063.34, left: [] });
check('another currency is left out and named', inSar({ SAR: 100, EUR: 403 }), { sar: 100, left: ['EUR'] });
{
  const ls = priceReview([row({ net_cost: 1100 }), row({ record_id: 'r2', serials: ['5513727401'], currency: 'SAR', net_cost: 500 })],
    [tk({}), tk({ ticketNo: '5513727401', currency: 'SAR', amount: 450, commission: 0 })]);
  const t = totalInSar(priceTotals(ls, false))!;
  check('the price totals as one riyal figure', [t.currency, t.charged, t.net, t.commission, t.aviation], ['SAR', 1622, 1368, 102, 152]);
  check('...and it still adds up', Math.round((t.net + t.commission + t.aviation) * 100) / 100, t.charged);
}

console.log('\n9. A whole file: what operations was charged is their sheet, whatever the date');
{
  const old = { issued_at: '2026-10-20T08:00:00Z' };
  const rows = [row({ ...old, net_cost: 1200 }), row({ ...old, record_id: 'r2', serials: ['5513727401'], net_cost: 850 })];
  const ledger = [tk({ date: '2026-10-20' }), tk({ ticketNo: '5513727401', date: '2026-10-20' })];
  check('without it, a file before 9 Nov has no prices', priceReview(rows, ledger, { requests: ['KSAML2900'] }).length, 0);
  const ls = priceReview(rows, ledger, { requests: ['KSAML2900'], wholeFile: true });
  check('with it: their 1,200 on our 1,000 fare is 200 to the team', ls.map(l => [l.result, l.toOps, l.price, l.markup, l.early]),
    [['MARKUP', 1200, 1000, 200, true], ['BELOW_NET', 850, 1000, -150, true]]);
  const [t] = priceTotals(ls, false);
  check('charged is their sheet: 1,200 + 850', [t.charged, t.net, t.commission, t.aviation], [2050, 1800, 200, 50]);
  check('before 9 Nov: never asked about, never holding the file', ls.map(l => [needsReason(l), blocksClosing(l)]), [[false, false], [false, false]]);
  const now = priceReview([row({ net_cost: 850 })], [tk({})], { wholeFile: true });
  check('...while from 9 Nov the same is asked about and holds it', now.map(l => [needsReason(l), blocksClosing(l)]), [[true, true]]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
