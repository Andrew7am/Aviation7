/**
 * The four airline reports that carried a status column nobody read.
 *
 * FlyAdeal DXB, FlyAdeal KSA, FlyDubai and Flynas all ship one, and all four
 * parsers decided issue-against-refund from the money alone. A cancelled
 * booking therefore arrived as an ordinary sale: in the ledger, in the
 * request's cost, in the vendor's balance, and nowhere in the void count.
 *
 * The column is now read, and read only to CANCEL. It is not allowed to
 * reclassify anything else, because these columns are full of words that
 * mean nothing to us — "Default", "ACTIVE", blank — and a status that could
 * override the money would turn a real sale into a guess the first time a
 * vendor invented a new one.
 *
 * NSA is deliberately not here. Its file is a statement of account with no
 * status column at all: a cancellation there appears as a credit, which the
 * parser already reads as a refund.
 */
import Papa from 'papaparse';
import { runParser } from '../src/core/parsers';
import { isVoidRow } from '../src/core/helpers/normalizeStatus';
import { voidsFromImport } from '../src/core/helpers/voidFromImport';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const parse = (lines: string[]) => {
  const grid = Papa.parse<string[]>(lines.join('\n'), { skipEmptyLines: true }).data;
  return runParser(grid, undefined, 'SAR', 'report.csv', []);
};

/* ── FlyAdeal DXB ──────────────────────────────────────────────────────── */
const DXB_H = 'paymentDate,pnr,parentOrganizationCode,organizationCode,type,passenger_name,'
  + 'emailAddress,phone,bookingAmount,bookingCurrency,accountAmount,accountCurrency,balance,'
  + 'promoCode,segmentCount,sourceUserCode,req_number,column1,status';
const dxb = (pnr: string, status: string) =>
  `2026-08-12,${pnr},P,O,Booking,MR TEST PASSENGER,a@b.c,0,500,SAR,500,AED,0,,1,agent,KSAML1,domestic,${status}`;

console.log('\n1. FlyAdeal DXB');
{
  const r = parse([DXB_H, dxb('QCDDKA', 'CONFIRMED'), dxb('JYGVQT', 'Cancelled')]);
  check('the file is recognised', r.parserName, 'FlyAdeal DXB');
  check('two rows', r.rows.length, 2);
  check('the confirmed one is a sale', r.rows[0].status, 'ISSUE');
  check('the cancelled one is a void', r.rows[1].status, 'VOID');
  check('  ...and the import would cancel it', r.rows.filter(isVoidRow).length, 1);
}

console.log('\n2. FlyDubai');
{
  const H = 'Invoice No,Payment Date,Booking Reference,Master Booking Reference,Agency,User ID,'
    + 'Amount,Deposit Date,Balance,Balance Due,Payment Reference,Payer ID,Total Passengers,'
    + 'Total Segments,Order No,Passenger Name,Departure Date,Booked Date,Remarks,Currency Code,'
    + 'REQ Number,Status';
  const row = (ref: string, st: string) =>
    `INV1,2026-08-12,${ref},M,AG,user,750,2026-08-01,0,0,PR,PID,1,1,ORD,MR TEST,2026-09-01,`
    + `2026-08-12,,AED,KSAML1,${st}`;
  const r = parse([H, row('QNXWUT', 'CONFIRMED'), row('BPOLCW', 'CANCELLED')]);
  check('recognised', r.parserName, 'FlyDubai');
  check('the confirmed one is a sale', r.rows[0].status, 'ISSUE');
  check('the cancelled one is a void', r.rows[1].status, 'VOID');
}

console.log('\n3. Flynas');
{
  const H = 'Date,PNR2,PAX,Amount,REQ. NUMBER,Balance,Column6,Status';
  const row = (pnr: string, st: string) =>
    `2026-08-12,${pnr},MR TEST PASSENGER,640,KSAML1,0,domestic,${st}`;
  const r = parse([H, row('ABCDEF', 'CONFIRMED'), row('GHIJKL', 'Void')]);
  check('recognised', r.parserName, 'Flynas');
  check('the confirmed one is a sale', r.rows[0].status, 'ISSUE');
  check('the cancelled one is a void', r.rows[1].status, 'VOID');
}

console.log('\n4. FlyAdeal KSA — the column was already found and never used');
{
  const H = 'createdUserCode,organizationCode,parentOrganizationCode,recordLocator,seat,'
    + 'seatAmount,inft,passengerName,emailAddress,phone,flightNumber,departureDate,legDetails,'
    + 'pnrTotal,baseYQ,baseFare,ssrFees,cmf,otherCharge,promotionDiscount,discount,pnrCurrency,'
    + 'totalInOrgCurrency,status,paxStatus,organizationCurrency,REQ Number';
  const row = (loc: string, st: string) =>
    `u,O,P,${loc},1A,0,0,MR TEST PASSENGER,a@b.c,0,F3123,2026-09-01,JED-RUH,900,0,900,0,0,0,0,0,`
    + `SAR,900,${st},Default,SAR,KSAML1`;
  const r = parse([H, row('NEVGWH', 'CONFIRMED'), row('ZZZZZZ', 'CANX')]);
  check('recognised', r.parserName, 'FlyAdeal KSA');
  check('the confirmed one is a sale', r.rows[0].status, 'ISSUE');
  check('the cancelled one is a void', r.rows[1].status, 'VOID');
}

console.log('\n5. A status may cancel and nothing else');
{
  /* The real danger. These columns carry words that mean nothing to us, and
     a status allowed to decide the kind of row would reclassify a genuine
     sale the first time a vendor invented one. */
  for (const st of ['Default', 'ACTIVE', '', 'Pending', 'Waitlist'])
    check(`"${st}" leaves a sale a sale`,
          parse([DXB_H, dxb('QCDDKA', st)]).rows[0].status, 'ISSUE');

  // A refund is still decided by the money, not by a word.
  const refund = `2026-08-12,JYGVQT,P,O,Booking,MR TEST,a@b.c,0,-500,SAR,-500,AED,0,,1,agent,KSAML1,domestic,CONFIRMED`;
  check('a negative amount is still a refund', parse([DXB_H, refund]).rows[0].status, 'REFUND');
}

console.log('\n6. What reaches the register');
{
  const r = parse([DXB_H, dxb('QCDDKA', 'CONFIRMED'), dxb('JYGVQT', 'Cancelled')]);
  const voided = r.rows.filter(isVoidRow)
    .map(t => ({ ...t, source: t.source || r.parserName }));
  const recs = voidsFromImport(voided as never, 'FlyAdeal August.csv');
  check('one cancelled document', recs.length, 1);
  check('under the supplier', recs[0].source, 'FlyAdeal DXB');
  check('with its PNR', recs[0].pnr, 'JYGVQT');
  check('and a period that survives a re-import', recs[0].period, '2026-08');
  check('  ...the same on a second pass',
        voidsFromImport(voided as never, 'FlyAdeal August.csv')[0].period, recs[0].period);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
