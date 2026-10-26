/**
 * The team sheet check, scenario by scenario.
 *
 * Every shape a request has turned up in on the live sheet, built small and
 * run the way the request screen runs it. Each scenario states the verdict
 * it must reach, and every one is also held to the rules that must hold of
 * any report - the rules a sweep of all 329 live requests found broken in
 * thirty places:
 *
 *   A  the two counts differ only by what is named as missing or noted
 *   B  nothing is shown missing that the check has nothing to do about
 *   C  nothing the check asks for is left out of the counts
 *   E  every row on either side reaches a result
 *   F  no document is both agreed and missing, or missing twice
 *   G  a request is never "clean" with work left on it
 *   H  To Review gets each document once, priced when their sheet prices
 *      it, and never a conjunction's second booklet
 */
import { parseTeamSheet } from '../src/core/parsers/teamSheet';
import {
  compareTeamSheet, rowsForReview, whoActs, type Finding, type TeamSheetReport, type Verdict,
} from '../src/core/helpers/teamSheetCompare';
import { pendingFromFindings } from '../src/core/helpers/pendingFromFindings';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const HEAD = 'Ticket Number,PNR,Status,Req Num,Net Cost,Refund Amount,Refund Recieved?,Issued Date & Time,EMD Number,Portal,Total Cost with Currency';
const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2), ticketNo: '5513059078', pnr: 'PNR001',
  passengerName: 'A PASSENGER', airlineCode: '065', route: 'RUH/CAI', source: 'IATA BSP',
  date: '2026-08-20', amount: 1000, totalDoc: 1000, commission: 0, reqNum: 'REQ100',
  vendorReference: '', status: 'ISSUE', currency: 'AED', isDuplicate: false,
  closed: false, userId: 'u', ...o,
});
const key = (s: string) => (s || '').replace(/\D/g, '').slice(-10);

/** The rules every report must keep. Returns what broke. */
function broken(rep: TeamSheetReport, rows: ReturnType<typeof parseTeamSheet>['rows']): string[] {
  const out: string[] = [];
  const byDoc = new Map<string, Finding[]>();
  for (const f of rep.findings)
    for (const k of new Set([f.serial, f.pnr, (f.pnr || '').replace(/[^A-Z0-9]/gi, '')].filter(Boolean).map(x => x.toUpperCase())))
      byDoc.set(k, [...(byDoc.get(k) ?? []), f]);
  // A refund on its way is INFO, but still a refund our books lack.
  const act = (f: Finding) => !f.explained && f.verdict !== 'OK' && (whoActs(f) !== 'INFO' || f.verdict === 'REFUND_AWAITING_BILLING');
  for (const k of ['tickets', 'refunds', 'emds'] as const) {
    const d = rep.docTypes[k];
    const mo = d.ours - d.missingOnTheirs.length;
    const mt = d.theirs - d.missingInOurs.length - (d.noted?.length ?? 0);
    if (Math.abs(mo - mt) > (d.byPnrOnly ?? 0)) out.push(`A ${k}: matched ${mo} ours vs ${mt} theirs`);
    for (const doc of d.missingInOurs)
      if (!(byDoc.get(doc.toUpperCase()) ?? []).some(act)) out.push(`B ${k} ${doc} missing with nothing to do`);
    for (const doc of d.missingOnTheirs) {
      const fs = rep.findings.filter(f => f.serial === doc || f.pnr === doc
        || f.ours.some(t => key(t.ticketNo) === doc || t.ticketNo === doc || key(t.relatedTicket || '') === doc));
      if (!fs.some(act)) out.push(`B ${k} ${doc} missing on theirs with nothing to do`);
    }
  }
  const red = new Set(Object.values(rep.docTypes).flatMap(d => [...d.missingInOurs, ...d.missingOnTheirs]).map(x => x.toUpperCase()));
  for (const f of rep.findings) if (act(f)) {
    if ((f.verdict === 'NOT_IN_LEDGER' || f.verdict === 'REFUND_NOT_IN_LEDGER') && !red.has((f.serial || f.pnr).toUpperCase()))
      out.push(`C ${f.verdict} ${f.serial || f.pnr} not counted`);
    if (f.verdict === 'NOT_ON_SHEET'
      && !f.ours.some(t => [key(t.ticketNo), t.ticketNo, t.pnr, key(t.relatedTicket || '')].some(k => k && red.has(String(k).toUpperCase()))))
      out.push(`C NOT_ON_SHEET ${f.ours.map(t => t.ticketNo)} not counted`);
  }
  for (const u of rep.unaccounted) out.push(`E ${u.what}`);
  const bySerial = new Map<string, Verdict[]>();
  for (const f of rep.findings) if (f.serial) bySerial.set(f.serial, [...(bySerial.get(f.serial) ?? []), f.verdict]);
  for (const [k, vs] of bySerial) {
    if (vs.includes('OK') && vs.includes('NOT_IN_LEDGER')) out.push(`F ${k} both agreed and missing`);
    if (vs.filter(v => v === 'NOT_IN_LEDGER').length > 1) out.push(`F ${k} missing twice`);
  }
  const us = rep.findings.filter(f => !f.explained && whoActs(f) === 'US' && f.verdict !== 'OK');
  if (rep.clean && us.length) out.push(`G clean with ${us.map(f => f.verdict)}`);
  const props = pendingFromFindings(rep.findings, { newId: () => 'x', userId: 'u' });
  const seen = new Set<string>();
  for (const p of props) {
    const k = `${p.ticketNo}|${p.transactionType}`;
    if (seen.has(k)) out.push(`H ${k} proposed twice`); seen.add(k);
    if (!p.heldBack && rows.some(r => r.serial === p.ticketNo && r.couponOf)) out.push(`H booklet ${p.ticketNo} proposed`);
    const priced = rows.filter(r => r.serial === p.ticketNo && (r.cost ?? 0) > 0 && r.status !== 'REFUNDED' && (r.cellTickets ?? r.groupSize) <= 1);
    if (p.transactionType === 'ISSUE' && !p.amount && !p.heldBack && priced.length) out.push(`H ${p.ticketNo} proposed at 0, priced ${priced[0].cost}`);
  }
  return out;
}

/** One scenario: their rows, our rows, the request; what it must say. */
function scenario(name: string, lines: string[], ours: Ticket[], want: Partial<Record<Verdict, number>>,
                  more?: (rep: TeamSheetReport, props: ReturnType<typeof pendingFromFindings>) => void,
                  req = 'REQ100', voided: string[] = []) {
  console.log(`\n${name}`);
  // Their export always carries the currency beside the cost.
  const rows = parseTeamSheet([HEAD, ...lines.map(l => l + (/Ibtkar|NSA/.test(l) ? ',SAR' : ',AED'))].join('\n')).rows;
  const rep = compareTeamSheet(rowsForReview(rows, [req], ours), ours, [req], {},
    { voided, sheetStart: rows.map(r => r.issued).filter(Boolean).sort()[0] ?? '' });
  for (const [v, n] of Object.entries(want)) check(`${v} x${n}`, rep.counts[v as Verdict], n);
  check('keeps every rule', broken(rep, rows), []);
  more?.(rep, pendingFromFindings(rep.findings, { newId: () => 'x', userId: 'u' }));
}

const D = '20/08/2026 1:00pm';

scenario('1. Issued, held at the same price', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
], [tkt({})], { OK: 1 }, rep => check('clean', rep.clean, true));

scenario('2. Issued and not in our books', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
], [], { NOT_IN_LEDGER: 1 }, (rep, props) => {
  check('proposed at their figure', props.map(p => [p.ticketNo, p.amount]), [['5513059078', 1000]]);
  check('counted missing', rep.docTypes.tickets.missingInOurs, ['5513059078']);
});

scenario('3. In our books and not on their sheet', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
], [tkt({}), tkt({ ticketNo: '5513059079', pnr: 'PNR002' })], { OK: 1, NOT_ON_SHEET: 1 });

scenario('4. Issued and refunded, both held', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
  `065-5513059078,PNR001,Cancelled/Refunded,REQ100,1000,800,checked,22/08/2026 1:00pm,,IATA Portal (UAE)`,
], [tkt({}), tkt({ amount: -800, totalDoc: 800, status: 'REFUND', date: '2026-08-22' })], { OK: 1, REFUND_NOT_IN_LEDGER: 0 });

scenario('5. Refunded on their sheet, not received, our refund not in yet', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
  `065-5513059078,PNR001,Cancelled/Refunded,REQ100,1000,800,,22/08/2026 1:00pm,,IATA Portal (UAE)`,
], [tkt({})], { REFUND_AWAITING_BILLING: 1 }, rep => {
  // On its way, but not in our books: missing, and the sheet stays open.
  check('missing in our books', rep.docTypes.refunds.missingInOurs, ['5513059078']);
  check('the sheet is not closed', rep.clean, false);
});

scenario('6. Refunded and marked received, our refund missing', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
  `065-5513059078,PNR001,Cancelled/Refunded,REQ100,1000,800,checked,22/08/2026 1:00pm,,IATA Portal (UAE)`,
], [tkt({})], { REFUND_NOT_IN_LEDGER: 1 }, rep => check('red', rep.docTypes.refunds.missingInOurs, ['5513059078']));

scenario('7. We hold a refund their sheet does not show', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
], [tkt({}), tkt({ amount: -800, status: 'REFUND', date: '2026-08-22' })], { REFUND_NOT_ON_SHEET: 1 });

scenario('8. A refund held under an application number of its own', [
  `065-5513059078,PNR001,Cancelled/Refunded,REQ100,1000,800,checked,${D},,IATA Portal (UAE)`,
], [tkt({}), tkt({ ticketNo: '0079533084', amount: -800, status: 'REFUND', relatedTicket: '5513059078', date: '2026-08-22' })],
{ REFUND_NOT_IN_LEDGER: 0, NOT_ON_SHEET: 0 }, rep => check('one refund each side', [rep.docTypes.refunds.ours, rep.docTypes.refunds.theirs], [1, 1]));

scenario('9. Void on their sheet, in our Voids', [
  `065-5513059078,PNR001,Void,REQ100,1000,,,${D},,IATA Portal (UAE)`,
], [], { VOID_NOT_BILLED: 1, NOT_IN_LEDGER: 0 }, undefined, 'REQ100', ['5513059078']);

scenario('10. Void on their sheet, billed in ours', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
  `065-5513059078,PNR001,Void,REQ100,1000,,,21/08/2026 1:00pm,,IATA Portal (UAE)`,
], [tkt({})], { VOID_BUT_BILLED: 1, OK: 0 }, rep => check('not clean', rep.clean, false));

scenario('11. A reissue at no charge, not in our books', [
  `065-5513059080,PNR001,Reissue,REQ100,0,,,${D},,IATA Portal (UAE)`,
], [], { REISSUE_NO_CHARGE: 1 }, rep => check('not red', rep.docTypes.tickets.missingInOurs, []));

scenario('12. Conjunction, first number held', [
  `176-4861731808-09,PNR001,Issued,REQ100,37053,,,${D},,NSA Portal (RUH)`,
], [tkt({ ticketNo: '4861731808', amount: 37043, totalDoc: 37043, source: 'NSA', currency: 'SAR' })],
{ OK: 1, CONJUNCT_ALREADY_HELD: 1, NOT_IN_LEDGER: 0 }, rep => {
  check('one ticket each side', [rep.docTypes.tickets.ours, rep.docTypes.tickets.theirs], [1, 1]);
  check('the booklet named', rep.docTypes.tickets.conjunctions, ['4861731809 (with 4861731808)']);
});

scenario('13. Conjunction, nothing held', [
  `176-5512970091-92,ZFKZHR,Issued,REQ100,49240,,,29/06/2026 6:04pm,,RTS`,
  `176 5512970091-92,ZFKZHR,Reissue,REQ100,0,,,01/08/2026 2:53pm,,RTS`,
], [], { NOT_IN_LEDGER: 1, CONJUNCT_OF_MISSING: 1 }, (rep, props) => {
  check('proposed once, at the ticket\'s price', props.map(p => [p.ticketNo, p.amount, p.date]), [['5512970091', 49240, '2026-06-29']]);
  check('one ticket missing', rep.docTypes.tickets.missingInOurs, ['5512970091']);
});

scenario('14. Conjunction billed on the second number', [
  `176-5512845110-11,ZWE5AG,Issued,REQ100,4510,,,${D},,RTS`,
], [tkt({ ticketNo: '5512845111', pnr: 'ZWE5AG', amount: 4510, totalDoc: 4510, source: 'RTS' })], { NOT_IN_LEDGER: 0 });

scenario('15. Two passengers in a row, written as a range, one held', [
  `065-5513427701-02,PX2,Issued,REQ100,2000,,,${D},,IATA Portal (UAE)`,
], [tkt({ ticketNo: '5513427701', pnr: 'PX2', amount: 1000 })], { NOT_IN_LEDGER: 1, CONJUNCT_ALREADY_HELD: 0 }, (_rep, props) =>
  check('held back for a person, not priced at the whole cell', props.map(p => [p.ticketNo, p.heldBack, p.amount]), [['5513427702', true, 0]]));

scenario('16. Two tickets in one cell, both held, priced together', [
  `"065-5513427711 // 065-5513427720",PX3,Issued,REQ100,2000,,,${D},,IATA Portal (UAE)`,
], [tkt({ ticketNo: '5513427711', pnr: 'PX3', amount: 1000 }), tkt({ ticketNo: '5513427720', pnr: 'PX3', amount: 1000 })],
{ OK: 2, PRICE_DIFFERS: 0 });

scenario('17. Filed under a different request', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
], [tkt({ reqNum: 'REQ200' })], { REQ_DIFFERS: 1 }, rep =>
  check('counted on both sides, once', [rep.docTypes.tickets.ours, rep.docTypes.tickets.theirs], [1, 1]));

scenario('18. Price differs', [
  `065-5513059078,PNR001,Issued,REQ100,1500,,,${D},,IATA Portal (UAE)`,
], [tkt({})], { PRICE_DIFFERS: 1 });

scenario('19. Ibtekar\'s ten riyals on top of the fare', [
  `065-4862141215,8BF8II,Issued,REQ100,846.4,,,${D},,Ibtkar RUH`,
], [tkt({ ticketNo: '4862141215', pnr: '8BF8II', source: 'Ibtekar', currency: 'SAR', amount: 856.41, totalDoc: 846.4, adjustment: 10.01 })],
{ OK: 1, PRICE_DIFFERS: 0 });

scenario('20. A ticket and its EMD in one cell', [
  `"065-5512760095 // EMD 065-1930576246",XDFKUC,Reissue,REQ100,590,,,${D},,IATA Portal (UAE)`,
], [tkt({ ticketNo: '5512760095', pnr: 'XDFKUC', amount: 40 }), tkt({ ticketNo: '1930576246', pnr: 'XDFKUC', amount: 550, status: 'EMDS' })],
{ NOT_IN_LEDGER: 0 }, rep =>
  check('one ticket and one EMD each side', [rep.docTypes.tickets.ours, rep.docTypes.tickets.theirs, rep.docTypes.emds.ours, rep.docTypes.emds.theirs], [1, 1, 1, 1]));

scenario('21. An EMD their sheet marks, held here as a plain issue', [
  `EMD 079-1949941530,PE1,Issued,REQ100,150,,,${D},,IATA Portal (UAE)`,
], [tkt({ ticketNo: '1949941530', pnr: 'PE1', amount: 150 })], { NOT_IN_LEDGER: 0 }, rep =>
  check('an EMD on both sides', [rep.docTypes.emds.ours, rep.docTypes.emds.theirs, rep.docTypes.tickets.ours], [1, 1, 0]));

scenario('22. A refund row that writes the PNR for the ticket', [
  `065-4862405604,9C4U6F,Issued,REQ100,966,,,${D},,Ibtkar RUH`,
  `9C4U6F,9C4U6F,Cancelled/Refunded,REQ100,736,736,checked,22/08/2026 1:00pm,,Ibtkar RUH`,
], [tkt({ ticketNo: '4862405604', pnr: '9C4U6F', source: 'Ibtekar', currency: 'SAR', amount: 966, totalDoc: 966 }),
    tkt({ ticketNo: '4862405604', pnr: '9C4U6F', source: 'Ibtekar', currency: 'SAR', amount: -736, status: 'REFUND', date: '2026-08-22' })],
{ NOT_IN_LEDGER: 0, REFUND_NOT_IN_LEDGER: 0, REFUND_NOT_ON_SHEET: 0, FILED_ELSEWHERE: 1 });

scenario('23. We hold only the refund; the sale is missing', [
  `065-4862405611,9DQUWG,Issued,REQ100,816.5,,,${D},,Ibtkar RUH`,
  `065-4862405611,9DQUWG,Cancelled/Refunded,REQ100,586.5,586.5,checked,22/08/2026 1:00pm,,Ibtkar RUH`,
], [tkt({ ticketNo: '4862405611', pnr: '9DQUWG', source: 'Ibtekar', currency: 'SAR', amount: -586.5, totalDoc: 586.5, status: 'REFUND', date: '2026-08-22' })],
{ NOT_IN_LEDGER: 1, OK: 0 }, (rep, props) => {
  check('the sale is proposed at its price', props.filter(p => p.transactionType === 'ISSUE').map(p => p.amount), [816.5]);
  check('counted missing', rep.docTypes.tickets.missingInOurs, ['4862405611']);
});

scenario('24. On hold with no ticket number', [
  `--,HOLD01,On Hold,REQ100,500,,,${D},,IATA Portal (UAE)`,
], [], { NOT_IN_LEDGER: 0, NO_TICKET_NUMBER: 0 }, rep => check('nothing counted', rep.docTypes.tickets.theirs, 0));

scenario('25. A number Excel destroyed', [
  `6.55512E+11,XL0001,Issued,REQ100,500,,,${D},,IATA Portal (UAE)`,
], [], { UNREADABLE: 1 });

scenario('26. Issued with the number left blank', [
  `---,BL0001,Issued,REQ100,500,,,${D},,IATA Portal (UAE)`,
], [tkt({ ticketNo: '5513059090', pnr: 'BL0001' })], { NO_TICKET_NUMBER: 1, NOT_ON_SHEET: 0 });

scenario('27. The same ticket twice on their sheet', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
], [tkt({})], { NOT_IN_LEDGER: 0 });

scenario('28. A reissue whose fare is on the ticket it replaced, refunded', [
  `065-5513059100,PNR001,Reissue,REQ100,0,,,${D},,IATA Portal (UAE)`,
  `065-5513059100,PNR001,Cancelled/Refunded,REQ100,,1200,,25/08/2026 1:00pm,,IATA Portal (UAE)`,
], [], { REISSUE_NO_CHARGE: 0 });

scenario('29. Website purchase, PNR only, held', [
  `,WEB001,Issued,REQ100,700,,,${D},,AL Website`,
], [tkt({ ticketNo: 'WEB001', pnr: 'WEB001', source: 'Airline Website', amount: 700 })], { NOT_IN_LEDGER: 0 });

scenario('30. Website purchase, PNR only, not held', [
  `,WEB002,Issued,REQ100,700,,,${D},,AL Website`,
], [], { NOT_IN_LEDGER: 1 }, (_rep, props) => check('proposed at its price', props.map(p => p.amount), [700]));

scenario('31. Bought in dollars, held in dirhams', [
  `065-5513059078,PNR001,Issued,REQ100,272.33,,,${D},,AL Website,USD`,
], [tkt({ source: 'Airline Website', amount: 1000, totalDoc: 1000, originalCurrency: 'USD', originalAmount: 272.33, fxRate: 3.6725 } as any)],
{ PRICE_DIFFERS: 0, NOT_IN_LEDGER: 0 });

scenario('32. Sold before their sheet began, refunded after', [
  `065-5513059078,PNR001,Cancelled/Refunded,REQ100,1000,800,checked,${D},,IATA Portal (UAE)`,
], [tkt({ date: '2026-01-05' }), tkt({ amount: -800, status: 'REFUND', date: '2026-08-22' })], { NOT_IN_LEDGER: 0, REFUND_NOT_IN_LEDGER: 0 });

scenario('33. Refunds that differ', [
  `065-5513059078,PNR001,Cancelled/Refunded,REQ100,1000,900,checked,${D},,IATA Portal (UAE)`,
], [tkt({}), tkt({ amount: -500, totalDoc: 500, status: 'REFUND', date: '2026-08-22' })], { REFUND_DIFFERS: 1 });

scenario('34. Flyadeal, matched by its PNR', [
  `560-9152641826,H692FC,Issued,REQ100,1261.51,,,${D},,F3 Portal`,
], [tkt({ ticketNo: 'H692FC', pnr: 'H692FC', source: 'FlyAdeal DXB', amount: 1261.51, totalDoc: 1261.51 })],
{ NOT_IN_LEDGER: 0, NOT_ON_SHEET: 0 });

// KSAML2706: sold under the e-ticket number, refunded on a row of its own under the PNR.
scenario('34b. Flyadeal sold by number, refunded under its PNR', [
  `560-9152641826,H692FC,Issued,REQ100,1261.51,,,${D},,F3 Portal`,
  `H692FC,H692FC,Cancelled/Refunded,REQ100,0,821.74,checked,${D},,F3 Portal`,
], [tkt({ ticketNo: 'H692FC', pnr: 'H692FC', source: 'FlyAdeal DXB', amount: 1261.51, totalDoc: 1261.51 }),
    tkt({ ticketNo: 'H692FC', pnr: 'H692FC', source: 'FlyAdeal DXB', amount: -821.74, totalDoc: 821.74, status: 'REFUND', date: '2026-08-22' })],
{ NOT_IN_LEDGER: 0, NOT_ON_SHEET: 0, REFUND_NOT_ON_SHEET: 0, REFUND_NOT_IN_LEDGER: 0 });

scenario('35. Our ticket, on their sheet under another request', [
  `065-5513059078,PNR001,Issued,REQ200,1000,,,${D},,IATA Portal (UAE)`,
], [tkt({})], { REQ_DIFFERS: 1, NOT_ON_SHEET: 0 });

scenario('36. A conjunction refunded, both sides', [
  `235-5512129227-28,PNR001,Issued,REQ100,3580,,,${D},,IATA Portal (UAE)`,
  `235-5512129227-28,PNR001,Cancelled/Refunded,REQ100,3580,2925.2,checked,22/08/2026 1:00pm,,IATA Portal (UAE)`,
], [tkt({ ticketNo: '5512129227', amount: 3535.2, totalDoc: 3580 }),
    tkt({ ticketNo: '5512129227', amount: -2925.2, totalDoc: 2925.2, status: 'REFUND', date: '2026-08-22' })],
{ NOT_IN_LEDGER: 0, REFUND_NOT_IN_LEDGER: 0, CONJUNCT_ALREADY_HELD: 1 });

scenario('37. A reissue refunded; the fare sits on the original', [
  `065-5513059078,PNR001,Issued,REQ100,1000,,,${D},,IATA Portal (UAE)`,
  `065-5513059200,PNR001,Reissue,REQ100,20,,,21/08/2026 1:00pm,,IATA Portal (UAE)`,
  `065-5513059200,PNR001,Cancelled/Refunded,REQ100,20,900,checked,25/08/2026 1:00pm,,IATA Portal (UAE)`,
], [tkt({}), tkt({ ticketNo: '5513059200', amount: 20, totalDoc: 20, date: '2026-08-21' }),
    tkt({ ticketNo: '0079500001', amount: -900, totalDoc: 900, status: 'REFUND', relatedTicket: '5513059200', date: '2026-08-25' })],
{ NOT_IN_LEDGER: 0, REFUND_NOT_IN_LEDGER: 0, NOT_ON_SHEET: 0 });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
