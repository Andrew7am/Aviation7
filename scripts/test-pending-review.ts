/**
 * The review queue: what the check proposes, and what stops a proposal.
 *
 *   npx tsx scripts/test-pending-review.ts
 *
 * Two rules carry the whole screen and both are easy to get quietly wrong:
 * their cost must never become our amount, and an Ibtekar or NSA ticket must
 * never become a ticket at all. Each is asserted from the outside, on the
 * shapes their real export produces.
 */
import { parseTeamSheet } from '../src/core/parsers/teamSheet';
import { compareTeamSheet } from '../src/core/helpers/teamSheetCompare';
import { portalSource, issuedFrom } from '../src/core/config/teamPortals';
import { knownSources, BUILTIN_SOURCES } from '../src/core/config/sources';
import {
  pendingFromFindings, whyNotConfirmable, canConfirm, dedupeKey, ticketFromPending,
} from '../src/core/helpers/pendingFromFindings';
import type { PendingTicket, Ticket } from '../src/types';

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`   ok   ${name}`); }
  else { failed++; console.log(`   FAIL ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

let n = 0;
const ids = () => `id-${++n}`;
const build = (findings: any[]) =>
  pendingFromFindings(findings, { newId: ids, userId: 'u1' });

const sheet = (rows: string[], header =
  'Ticket Number,PNR,Status,Net Cost,Refund Amount,Issued Date & Time,Portal,REQ No (Auto) (MICE)') =>
  parseTeamSheet([header, ...rows].join('\n')).rows;

/* ── 1. their portal, read as one of our vendors ──────────────────────── */
console.log('\n1. Their portal is one of our vendors under another name');
{
  check('Ibtkar RUH is Ibtekar',      portalSource('Ibtkar RUH').source, 'Ibtekar');
  check('NSA Portal (RUH) is NSA',    portalSource('NSA Portal (RUH)').source, 'NSA');
  /* The LEDGER'S spelling, not the vendor's short name. Every BSP row we
     hold is filed under "IATA BSP"; the wallet is called "IATA" and
     reaches them by substring. Mapping the portal to the wallet's name
     put a confirmed ticket under a bare "IATA" — a second spelling of one
     vendor, invisible to every report that groups by source. */
  check('IATA Portal (UAE) is IATA BSP', portalSource('IATA Portal (UAE)').source, 'IATA BSP');
  check('BSP Link is IATA BSP too',      portalSource('BSP Link').source, 'IATA BSP');
  check('RTS is RTS',                 portalSource('RTS').source, 'RTS');
  check('XY is flynas',               portalSource('XY').source, 'Flynas');
  check('flydubai',                   portalSource('flydubai').source, 'FlyDubai');
  check('Riyadh Air Portal',          portalSource('Riyadh Air Portal').source, 'Riyadh Air');
  check('Air Arabia Portal',          portalSource('Air Arabia Portal').source, 'AirArabia');
  check('Turkish Airlines Portal',    portalSource('Turkish Airlines Portal').source, 'Turkish Airlines');
  check('AL Website is the card',     portalSource('AL Website').source, 'Airline Website');

  // F3 is FlyAdeal's designator and FlyAdeal bills from two houses. Their
  // column names the airline, so the table must not pick one.
  const f3 = portalSource('F3');
  check('F3 names no single vendor',  f3.source, '');
  check('it offers both',             f3.choices, ['FlyAdeal KSA', 'FlyAdeal DXB']);
  check('and says so in one line',    issuedFrom('F3'), 'FlyAdeal KSA or FlyAdeal DXB');

  // A word nobody has mapped comes back as itself rather than as nothing:
  // "we do not know" and "their cell was empty" are different answers.
  check('an unknown portal is itself', issuedFrom('Sabre Red'), 'Sabre Red');
  check('an empty one is empty',       issuedFrom(''), '');
  check('and matches nothing',         portalSource('').source, '');
}

/* ── 2. two portals in one cell ───────────────────────────────────────── */
console.log('\n2. Their cell is sometimes two portals');
{
  const both = portalSource('IATA Portal (UAE),RTS');
  check('the first one we know names it', both.source, 'IATA BSP');
  check('their word keeps both',          both.portal, 'IATA Portal (UAE), RTS');
  check('and neither is held',            both.heldBack, false);

  // The safe way round: a held-back part holds the whole row. The cost of
  // holding one ticket for review is a question; the cost of keying a
  // wallet ticket twice is a wrong balance.
  const mixed = portalSource('IATA Portal (UAE),NSA Portal (RUH)');
  check('a held part holds the row',      mixed.heldBack, true);
  check('the reason travels with it',     mixed.why.includes('wallet'), true);
  check('the vendor is still the first',  mixed.source, 'IATA BSP');
}

/* ── 3. only Ibtekar and NSA are held ─────────────────────────────────── */
console.log('\n3. Only the two that settle against a wallet are held');
{
  const held = ['Ibtkar RUH', 'NSA Portal (RUH)'];
  const free = ['IATA Portal (UAE)', 'RTS', 'AL Website', 'F3', 'flydubai',
                'Riyadh Air Portal', 'XY', 'Air Arabia Portal', 'BSP Link',
                'Turkish Airlines Portal'];
  check('held',      held.map(p => portalSource(p).heldBack), [true, true]);
  check('not held',  free.map(p => portalSource(p).heldBack), free.map(() => false));
}

/* ── 4. what the check proposes, and what it refuses to ───────────────── */
console.log('\n4. Only a ticket our books do not have becomes a proposal');
{
  const rows = sheet([
    // On their sheet, in nobody's books.
    '065-5513373335,YSLM73,Issued,2530.00,,03/09/2026 1:00pm,RTS,KSAML2218',
    // In both, filed under different requests - a disagreement to settle,
    // not a ticket to add. Proposing it would create a second copy.
    '065-5513373336,YSLM74,Issued,1200.00,,03/09/2026 1:00pm,RTS,KSAML2219',
  ]);
  const ledger: Ticket[] = [{
    id: 't1', ticketNo: '5513373336', source: 'RTS', date: '2026-09-03',
    amount: 1180, commission: 0, totalDoc: 1180, reqNum: 'KSAML9999',
    pnr: 'YSLM74', status: 'ISSUE', currency: 'AED', userId: 'u1',
  }];
  const r = compareTeamSheet(rows, ledger, ['KSAML2218', 'KSAML2219', 'KSAML9999']);
  const out = build(r.findings);
  check('one proposal, not two', out.length, 1);
  check('and it is the missing one', out[0].ticketNo, '5513373335');
  check('the misfiled one is untouched',
    r.findings.some(f => f.verdict === 'REQ_DIFFERS'), true);
}

/* ── 5. their price is not our price ──────────────────────────────────── */
console.log('\n5. Their cost is carried, never copied');
{
  const r = compareTeamSheet(sheet([
    '065-5513373335,YSLM73,Issued,2530.00,,03/09/2026 1:00pm,RTS,KSAML2218',
  ]), []);
  const [p] = build(r.findings);

  // The whole reason the queue exists. Their column is a quote with their
  // uplift on it, in whichever currency it was quoted in; the actual cost
  // is the one thing the reviewer has and the sheet does not.
  check('their figure is kept',   p.theirCost, 2530);
  // It is a NET - their marked-up rate lives in a column that is never
  // read - so it is copied in rather than left blank. It matches our own
  // figure exactly about two times in three, and a blank on 221 rows is
  // the worse default.
  check('and it is copied in',    p.amount, 2530);
  check('as the document too',    p.totalDoc, 2530);
  check('so it can be confirmed', canConfirm(p), true);

  // Corrected by a person, both figures are kept, so an untouched row
  // still looks different from a checked one.
  const fixed = { ...p, amount: 2400 };
  check('a correction sticks',    fixed.amount, 2400);
  check('and theirs is still there', fixed.theirCost, 2530);
}

/* ── 6. a refund IS prefilled, and negative ───────────────────────────── */
console.log('\n6. A refund is not a quote, so it is filled in');
{
  // Their refund figure is what the airline actually gave back, and it
  // matches our net or our gross to the fils. Nothing to correct, so
  // nothing to retype.
  const rows = sheet([
    '065-5513373340,YSLM80,Issued,2890.00,,01/09/2026 1:00pm,IATA Portal (UAE),KSAML2218',
    '065-5513373340,YSLM80,Cancelled/Refunded,,2890.00,05/09/2026 1:00pm,IATA Portal (UAE),KSAML2218',
  ]);
  const ledger: Ticket[] = [{
    id: 't1', ticketNo: '5513373340', source: 'IATA', date: '2026-09-01',
    amount: 2664, commission: 226, totalDoc: 2890, reqNum: 'KSAML2218',
    pnr: 'YSLM80', status: 'ISSUE', currency: 'AED', userId: 'u1',
  }];
  const r = compareTeamSheet(rows, ledger, ['KSAML2218']);
  check('the refund is the finding', r.counts.REFUND_NOT_IN_LEDGER, 1);

  const [p] = build(r.findings.filter(f => f.verdict === 'REFUND_NOT_IN_LEDGER'));
  check('it is a refund',        p.transactionType, 'REFUND');
  check('stored negative',       p.amount, -2890);
  check('document positive',     p.totalDoc, 2890);
  check('and it is ready to go', canConfirm(p), true);
}

/* ── 7. Ibtekar and NSA are raised and cannot be confirmed ────────────── */
console.log('\n7. A wallet vendor is listed, counted, and closed');
{
  const r = compareTeamSheet(sheet([
    '065-5513373350,YSLM90,Issued,4100.00,,03/09/2026 1:00pm,Ibtkar RUH,KSAML2218',
    '065-5513373351,YSLM91,Issued,900.00,,03/09/2026 1:00pm,NSA Portal (RUH),KSAML2218',
  ]), []);
  const out = build(r.findings);

  // Raised, because a gap nobody can see is a gap nobody closes.
  check('both are raised', out.length, 2);
  check('both held',       out.map(p => p.heldBack), [true, true]);
  check('the vendor is still named', out.map(p => p.source), ['Ibtekar', 'NSA']);

  // And closed, because keying one moves the wallet twice.
  check('neither can be confirmed', out.map(canConfirm), [false, false]);
  check('the reason is the wallet',
    out[0].heldBackWhy!.includes('credit wallet'), true);

  // Not even fully filled in. The hold is not a missing field.
  const filled: PendingTicket = { ...out[0], amount: 4000, date: '2026-09-03' };
  check('filling it in changes nothing', canConfirm(filled), false);
  check('and it still says why', whyNotConfirmable(filled).includes('wallet'), true);
}

/* ── 8. the vendor their sheet cannot name ────────────────────────────── */
console.log('\n8. When their portal names an airline, not a vendor');
{
  const r = compareTeamSheet(sheet([
    '065-5513373360,YSLM95,Issued,610.00,,03/09/2026 1:00pm,F3,KSAML2218',
  ]), []);
  const [p] = build(r.findings);
  check('no vendor is guessed', p.source, '');
  check('their word is kept',   p.theirPortal, 'F3');
  // Asked for before the price, because picking from a list is the quicker
  // of the two and the screen should ask for the quick thing first.
  check('and that is what it asks for first',
    whyNotConfirmable(p), 'Pick the vendor that billed it.');
  // And once picked there is nothing else to ask: their net came across
  // with it, and their cell named one ticket.
  check('once picked, it is ready',
    whyNotConfirmable({ ...p, source: 'FlyAdeal KSA' }), '');
  check('at their figure', p.amount, 610);
}

/* ── 9. what else comes across ────────────────────────────────────────── */
console.log('\n9. Everything their sheet is the better witness for');
{
  const r = compareTeamSheet(sheet([
    '065-5513373370,ZQ4XYZ,Issued,1500.00,,14/07/2026 9:30am,RTS,KSAML2300',
  ]), []);
  const [p] = build(r.findings);
  check('the ticket',   p.ticketNo, '5513373370');
  check('the airline',  p.airlineCode, '065');
  check('the PNR',      p.pnr, 'ZQ4XYZ');
  check('the date',     p.date, '2026-07-14');
  check('the vendor',   p.source, 'RTS');
  // We hold no row for it, so their request is the only one there is - and
  // where it came from is recorded beside it rather than lost.
  check('their request becomes ours', p.reqNum, 'KSAML2300');
  check('and stays labelled theirs',  p.theirReq, 'KSAML2300');
  // Their "TEAM MEMBERS" column is who booked it, not who flew. Filling the
  // passenger with the booker's name would be worse than leaving it blank.
  check('no passenger is invented',   p.passengerName, '');
  check('it starts pending',          p.state, 'PENDING');
  check('and it says what raised it', p.finding, 'NOT_IN_LEDGER');
}

/* ── 10. the same sheet, checked twice ────────────────────────────────── */
console.log('\n10. Checking the same sheet twice asks the same question');
{
  const rows = sheet([
    '065-5513373380,YS1111,Issued,700.00,,03/09/2026 1:00pm,RTS,KSAML2218',
    '065-5513373380,YS1111,Cancelled/Refunded,,700.00,09/09/2026 1:00pm,RTS,KSAML2218',
  ]);
  const a = build(compareTeamSheet(rows, []).findings);
  const b = build(compareTeamSheet(rows, []).findings);
  check('the ids differ',    a[0].id === b[0].id, false);
  check('the key does not',  a.map(p => p.dedupe), b.map(p => p.dedupe));

  // One document can raise two separate things to agree to, so the verdict
  // is part of what the proposal is about. Collapsing them would lose one.
  check('key is origin, document and finding',
    dedupeKey('TEAM_SHEET', '5513373380', 'YS1111', 'NOT_IN_LEDGER'),
    'TEAM_SHEET|5513373380|NOT_IN_LEDGER');
  check('and a different finding is a different key',
    dedupeKey('TEAM_SHEET', '5513373380', 'YS1111', 'NOT_IN_LEDGER')
      === dedupeKey('TEAM_SHEET', '5513373380', 'YS1111', 'REFUND_NOT_IN_LEDGER'), false);

  // A carrier that issues no IATA ticket has no serial; the reference in
  // the PNR is what identifies it, and the key must not collapse to
  // "TEAM_SHEET||NOT_IN_LEDGER" for every one of them.
  check('the PNR stands in when there is no serial',
    dedupeKey('TEAM_SHEET', '', 'RX12237ZB622D', 'NOT_IN_LEDGER'),
    'TEAM_SHEET|RX12237ZB622D|NOT_IN_LEDGER');
}

/* ── 11. what stops a confirm, in order ───────────────────────────────── */
console.log('\n11. A proposal is not a ticket until a person finishes it');
{
  const base: PendingTicket = {
    id: 'x', userId: 'u1', ticketNo: '5513373390', source: 'RTS',
    date: '2026-09-03', amount: 500, commission: 0, totalDoc: 500,
    reqNum: 'KSAML2218', pnr: 'YS2222', currency: 'AED',
    transactionType: 'ISSUE', origin: 'TEAM_SHEET', heldBack: false,
    state: 'PENDING', dedupe: 'k',
  };
  check('complete is confirmable',   whyNotConfirmable(base), '');
  check('no vendor',                 whyNotConfirmable({ ...base, source: '  ' }),
    'Pick the vendor that billed it.');
  check('no date',                   whyNotConfirmable({ ...base, date: '' }), 'Give it a date.');
  // Two reasons a row can be unpriced, and they are said differently:
  // telling somebody their cell priced a whole booking when it priced
  // nothing sends them looking for a division that does not exist.
  check('no price, no figure',       whyNotConfirmable({ ...base, amount: 0 }),
    'Enter what it cost — their sheet states no figure for it.');
  check('no price, shared cell',
    whyNotConfirmable({ ...base, amount: 0, theirGroup: 3 }),
    'Enter what it cost — their figure covers all 3 tickets in that cell.');
  check('nothing to identify it',
    whyNotConfirmable({ ...base, ticketNo: '', pnr: '' }), 'No ticket number and no PNR.');
  // A reference in the PNR is identity enough - that is how every LCC row
  // in the ledger is held.
  check('a PNR alone is enough',
    whyNotConfirmable({ ...base, ticketNo: '', pnr: 'RX12237ZB622D' }), '');

  // Confirming wrote a ticket. Offering it again would write a second.
  check('a confirmed one is finished',
    whyNotConfirmable({ ...base, state: 'CONFIRMED' }), 'Already confirmed.');
  check('so is a rejected one',
    whyNotConfirmable({ ...base, state: 'REJECTED' }), 'Already rejected.');
}

/* ── 12. nothing to propose ───────────────────────────────────────────── */
console.log('\n12. A clean sheet proposes nothing');
{
  const rows = sheet([
    '065-5513373400,YS3333,Issued,800.00,,03/09/2026 1:00pm,RTS,KSAML2218',
  ]);
  const ledger: Ticket[] = [{
    id: 't1', ticketNo: '5513373400', source: 'RTS', date: '2026-09-03',
    amount: 790, commission: 0, totalDoc: 790, reqNum: 'KSAML2218',
    pnr: 'YS3333', status: 'ISSUE', currency: 'AED', userId: 'u1',
  }];
  const r = compareTeamSheet(rows, ledger, ['KSAML2218']);
  check('they agree', r.counts.OK, 1);
  check('and nothing is proposed', build(r.findings).length, 0);

  // A void is not a gap either: no supplier ever billed it.
  const voided = compareTeamSheet(sheet([
    '065-5513373401,YS4444,Issued,800.00,,03/09/2026 1:00pm,RTS,KSAML2218',
    '065-5513373401,YS4444,Void,,,04/09/2026 1:00pm,RTS,KSAML2218',
  ]), []);
  check('a void proposes nothing', build(voided.findings).length, 0);
}

/* ── 13. where they were bought, over a whole sheet ───────────────────── */
console.log('\n13. The question the column was added to answer');
{
  const r = compareTeamSheet(sheet([
    '065-5513373410,YA0001,Issued,100.00,,03/09/2026 1:00pm,RTS,KSAML2218',
    '065-5513373411,YA0002,Issued,100.00,,03/09/2026 1:00pm,RTS,KSAML2218',
    '065-5513373412,YA0003,Issued,100.00,,03/09/2026 1:00pm,IATA Portal (UAE),KSAML2218',
    '065-5513373413,YA0004,Issued,100.00,,03/09/2026 1:00pm,AL Website,KSAML2218',
    '065-5513373414,YA0005,Issued,100.00,,03/09/2026 1:00pm,Ibtkar RUH,KSAML2218',
  ]), []);
  const out = build(r.findings);
  const spread = new Map<string, number>();
  for (const p of out) spread.set(p.source, (spread.get(p.source) ?? 0) + 1);
  check('by vendor', [...spread].sort(),
    [['Airline Website', 1], ['IATA BSP', 1], ['Ibtekar', 1], ['RTS', 2]]);
  check('one of them is held', out.filter(p => p.heldBack).length, 1);
  check('four can be worked on', out.filter(p => !p.heldBack).length, 4);

  // And the finding itself carries it, which is what the report prints.
  check('the finding says where too',
    r.findings.filter(f => f.verdict === 'NOT_IN_LEDGER')
      .every(f => !!f.issuedFrom), true);
}

/* -- 14. what a Confirm actually writes --------------------------------- */
console.log('\n14. The ticket a confirmed proposal becomes');
{
  const base: PendingTicket = {
    id: 'x', userId: 'u1', ticketNo: '5513373390', source: 'RTS',
    date: '2026-09-03', amount: 500, commission: 0, totalDoc: 500,
    reqNum: 'ksaml2218', pnr: 'ys2222', passengerName: 'ahmed ali',
    airlineCode: '065', currency: 'AED', transactionType: 'ISSUE',
    origin: 'TEAM_SHEET', heldBack: false, state: 'PENDING', dedupe: 'k',
  };

  const t = ticketFromPending(base, 'new-id', 'u9');
  check('the id given is the id used', t.id, 'new-id');
  check('and the owner given',         t.userId, 'u9');
  check('an issue is positive',        t.amount, 500);
  check('status',                      t.status, 'ISSUE');
  // The ledger matches on these, and "ys2222" is a booking nobody finds.
  check('the request is uppercased',   t.reqNum, 'KSAML2218');
  check('the PNR too',                 t.pnr, 'YS2222');
  check('and the passenger',           t.passengerName, 'AHMED ALI');
  check('it says where it came from',  t.reportName, 'Team sheet — reviewed');
  check('and is not closed yet',       t.closed, false);
  check('nor a duplicate',             t.isDuplicate, false);

  // A refund is stored negative HOWEVER it was typed. Both directions,
  // because the screen writes a positive and the builder writes a negative
  // and a credit booked as a sale is the worst outcome this has.
  const asNeg = ticketFromPending(
    { ...base, transactionType: 'REFUND', amount: -800, totalDoc: 800 }, 'i', 'u1');
  const asPos = ticketFromPending(
    { ...base, transactionType: 'REFUND', amount: 800, totalDoc: 800 }, 'i', 'u1');
  check('a refund typed negative',  asNeg.amount, -800);
  check('a refund typed positive',  asPos.amount, -800);
  check('both document positive',   [asNeg.totalDoc, asPos.totalDoc], [800, 800]);
  check('and both are refunds',     [asNeg.status, asPos.status], ['REFUND', 'REFUND']);

  // An issue typed negative cannot become a credit either.
  check('an issue typed negative is still a sale',
    ticketFromPending({ ...base, amount: -500 }, 'i', 'u1').amount, 500);

  // A carrier with no IATA ticket: the reference is the document, and the
  // ledger's ticket column is where every one of ours lives.
  const ref = ticketFromPending(
    { ...base, ticketNo: '', pnr: 'rx12237zb622d' }, 'i', 'u1');
  check('the reference becomes the ticket', ref.ticketNo, 'RX12237ZB622D');
  check('and stays the PNR as well',        ref.pnr, 'RX12237ZB622D');

  // totalDoc falls back to the amount when nobody set it, so a row can
  // never reach the ledger with a document value of zero against money.
  check('the document falls back to the amount',
    ticketFromPending({ ...base, totalDoc: 0 }, 'i', 'u1').totalDoc, 500);
}

/* -- 15. the round trip ------------------------------------------------- */
console.log('\n15. From their row to our ledger, end to end');
{
  const r = compareTeamSheet(sheet([
    '065-5513373420,ZM9QQ1,Issued,2530.00,,03/09/2026 1:00pm,RTS,KSAML2218',
  ]), []);
  const [proposal] = build(r.findings);

  // As raised it already carries their net and can be confirmed.
  check('as raised, it is confirmable', canConfirm(proposal), true);
  check('at their figure',              proposal.amount, 2530);

  // Corrected by a person, it becomes exactly the ticket we would have keyed.
  const priced: PendingTicket = { ...proposal, amount: 2480, totalDoc: 2480 };
  check('and stays confirmable', canConfirm(priced), true);

  const t = ticketFromPending(priced, 'tid', 'u1');
  check('the ledger row', [t.ticketNo, t.airlineCode, t.pnr, t.source, t.date,
                           t.amount, t.currency, t.reqNum, t.status],
    ['5513373420', '065', 'ZM9QQ1', 'RTS', '2026-09-03', 2480, 'AED',
     'KSAML2218', 'ISSUE']);

  // And their figure never reached it.
  check('the correction reached the ledger', t.amount, 2480);
  check('and their figure did not',          t.amount === proposal.theirCost, false);
  check('but it is still on the proposal',   priced.theirCost, 2530);
}

/* -- 16. a card purchase has to be filable ------------------------------ */
console.log('\n16. Bought on the airline\'s own site, with nobody to invoice us');
{
  // 35 tickets on one sheet from 17 airlines, none of which bills us. The
  // portal maps them to "Airline Website", and if that name is not one the
  // vendor list offers then every one of those rows meets a dropdown with
  // no matching option - which renders EMPTY, showing "no vendor" on a row
  // that has one and losing it the moment anybody touches the field. That
  // is how they came to be unrecordable in the first place.
  check('the portal maps to it',
    portalSource('AL Website').source, 'Airline Website');
  check('and the vendor list offers it',
    BUILTIN_SOURCES.includes('Airline Website'), true);
  check('so a row carrying it finds itself',
    knownSources([], []).includes('Airline Website'), true);

  // It is a name, not a wallet. Nothing about it should look like a vendor
  // that settles, and nothing holds it back the way Ibtekar is held back.
  check('nothing holds it back', portalSource('AL Website').heldBack, false);

  const r = compareTeamSheet(sheet([
    '2121158834,MHSKUE,Issued,1195.00,,15/09/2026 1:00pm,AL Website,UAEVP711',
  ]), []);
  const [p] = build(r.findings);
  check('the proposal carries the name', p.source, 'Airline Website');
  check('and is ready to go',            whyNotConfirmable(p), '');

  const t = ticketFromPending({ ...p, amount: 1195, totalDoc: 1195 }, 'i', 'u1');
  check('and the ledger row keeps it', t.source, 'Airline Website');

  // The dropdown is still built from the ledger as well, so a vendor
  // somebody typed once is one click away the next time.
  check('a ledger vendor still shows',
    knownSources([], ['Sabre Direct']).includes('Sabre Direct'), true);
}

/* -- 17. one cell, several tickets, one price --------------------------- */
console.log('\n17. A price that belongs to a booking is not a ticket\'s price');
{
  // Their export puts a whole booking in one cell when it was issued
  // together - three numbers with /P1 /P2 /P3 after them - and the money
  // beside that cell is the BOOKING'S. Copying it onto each ticket would
  // treble the cost, which is the one way prefilling could do real harm.
  const r = compareTeamSheet(sheet([
    '"065-5513373301/P1\n065-5513373302/P2\n065-5513373303/P3",YSLM99,Issued,'
      + '7590.00,,03/09/2026 1:00pm,RTS,KSAML2218',
  ]), []);
  const out = build(r.findings);
  check('three tickets out of one cell', out.length, 3);
  check('and not one of them is priced', out.map(p => p.amount), [0, 0, 0]);
  check('their figure is still shown',   out.map(p => p.theirCost), [7590, 7590, 7590]);
  check('each one says what it is dividing',
    out.every(p => whyNotConfirmable(p)
      === 'Enter what it cost — their figure covers all 3 tickets in that cell.'), true);
  check('and carries the count',   out.map(p => p.theirGroup), [3, 3, 3]);

  // One ticket in the cell: prefilled, as it should be.
  const one = build(compareTeamSheet(sheet([
    '065-5513373304,YSLM98,Issued,2530.00,,03/09/2026 1:00pm,RTS,KSAML2218',
  ]), []).findings);
  check('a single ticket is priced', one[0].amount, 2530);
}

/* -- 18. a refund comes from their Refund Amount ------------------------ */
console.log('\n18. The refund is their own column, and it is taken as it stands');
{
  const rows = sheet([
    '065-5513373310,YSLM97,Issued,2890.00,,01/09/2026 1:00pm,IATA Portal (UAE),KSAML2218',
    '065-5513373310,YSLM97,Cancelled/Refunded,,2890.00,05/09/2026 1:00pm,IATA Portal (UAE),KSAML2218',
  ]);
  const ledger: Ticket[] = [{
    id: 't1', ticketNo: '5513373310', source: 'IATA', date: '2026-09-01',
    amount: 2664, commission: 226, totalDoc: 2890, reqNum: 'KSAML2218',
    pnr: 'YSLM97', status: 'ISSUE', currency: 'AED', userId: 'u1',
  }];
  const [p] = build(compareTeamSheet(rows, ledger, ['KSAML2218']).findings
    .filter(f => f.verdict === 'REFUND_NOT_IN_LEDGER'));

  // Their Refund Amount, not their Net Cost - the two sit on different
  // rows of the same document and only one of them is the refund.
  check('the refund amount, not the cost', Math.abs(p.amount), 2890);
  check('stored negative',                 p.amount, -2890);
  check('and carried beside it',           p.theirCost, 2890);
  check('ready to record',                 canConfirm(p), true);
}

/* -- 19. a free reissue never reaches the queue ------------------------- */
console.log('\n19. A reissue at no charge is not a ticket to record');
{
  const rows = parseTeamSheet([
    'Ticket Number,PNR,Status,Net Cost,Issued Date & Time,Portal,REQ No (Auto) (MICE),Ticket Type',
    '065-5512878158,AB1234,Reissue,0.00,01/08/2026 1:00pm,RTS,UAEVP420,REISSUE ATC',
    '065-5512878170,AB1250,Issued,900.00,01/08/2026 1:00pm,RTS,UAEVP420,TKT',
  ].join('\n')).rows;
  const r = compareTeamSheet(rows, []);
  check('the free reissue is set apart', r.counts.REISSUE_NO_CHARGE, 1);

  const out = build(r.findings);
  check('only the real one is proposed', out.length, 1);
  check('and it is the charged one',     out[0].ticketNo, '5512878170');
  check('priced at their figure',        out[0].amount, 900);
}

/* -- 20. one vendor, one spelling --------------------------------------- */
console.log('\n20. Every portal maps to a name the ledger already uses');
{
  // A proposal's vendor becomes a ticket's `source`, and `source` is what
  // reports group by and what wallet matching keys on. A name that is not
  // already in use is a SECOND SPELLING of an existing vendor, and a
  // second spelling is a row nobody's report can see.
  //
  // This is not hypothetical. The IATA portal was mapped to "IATA", the
  // name of the wallet, while every BSP row we hold is filed under "IATA
  // BSP". One confirmed ticket went into the ledger under the bare name
  // and 77 more were queued behind it before a ledger-wide invariant
  // caught it.
  const LEDGER = new Set([
    'IATA BSP', 'NSA', 'RTS', 'Ibtekar', 'FlyAdeal DXB', 'FlyAdeal KSA',
    'Turkish Airlines', 'FlyDubai', 'AirArabia', 'Flynas', 'Riyadh Air',
    'Gold Medal', 'Airline Website',
  ]);

  const PORTALS = [
    'IATA Portal (UAE)', 'BSP Link', 'Ibtkar RUH', 'NSA Portal (RUH)', 'RTS',
    'AL Website', 'F3', 'Turkish Airlines Portal', 'flydubai',
    'Riyadh Air Portal', 'XY', 'Air Arabia Portal',
  ];

  for (const portal of PORTALS) {
    const m = portalSource(portal);
    const names = m.source ? [m.source] : m.choices;
    check(`"${portal}" maps into the ledger`,
      names.length > 0 && names.every(n => LEDGER.has(n)), true);
  }

  // And a mapped name has to be one the dropdown offers, or the reviewer
  // meets a select that does not contain the vendor already on their row.
  const offered = knownSources([], [...LEDGER]);
  for (const portal of PORTALS) {
    const m = portalSource(portal);
    const names = m.source ? [m.source] : m.choices;
    check(`"${portal}" is pickable`, names.every(n => offered.includes(n)), true);
  }

  // The specific trap, named: the wallet's short name is not the ticket's
  // source, and nothing may map to it.
  check('nothing maps to the bare wallet name',
    PORTALS.some(x => portalSource(x).source === 'IATA'), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
