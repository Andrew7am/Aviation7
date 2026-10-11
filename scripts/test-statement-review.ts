/**
 * A statement of account, line by line against our books.
 *
 *   npx tsx scripts/test-statement-review.ts
 *
 * Built on Ibtekar's 01/08-30/09 statement, which agrees with our books to
 * the fil and still carries two tickets at figures we do not hold: the
 * statement nets a refund across them. Correcting one of them would have
 * broken an account that agrees.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseIbtekarStatementPdf } from '../src/core/parsers/ibtekarStatementPdf';
import { reviewStatement } from '../src/core/helpers/statementAgainstBooks';
import type { Ticket, BalanceTopUp, VendorStatement } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const st = parseIbtekarStatementPdf(JSON.parse(readFileSync(resolve('scripts/fixtures/ibtekar-soa-wrapped-words.json'), 'utf8')))!;
let n = 0;
const t = (o: Partial<Ticket>): Ticket => ({ id: `t${++n}`, ticketNo: '', pnr: '', passengerName: '', airlineCode: '065',
  route: '', source: 'Ibtekar', date: '2026-08-10', amount: 0, totalDoc: 0, commission: 0, reqNum: '', vendorReference: '',
  status: 'ISSUE', currency: 'SAR', isDuplicate: false, closed: false, userId: '', ...o } as Ticket);
const pay = (amount: number, date: string, note = ''): BalanceTopUp =>
  ({ id: `p${++n}`, vendorId: 'v', vendorName: 'Ibtekar', amount, date, note, userId: '' });

/** Our books as they stood: every ticket at the statement's figure, fare
 *  about ten riyals under it, and 4862083218's refund booked on its own. */
function books(): Ticket[] {
  const out: Ticket[] = [];
  for (const l of st.lines.filter(l => l.section === 'TICKET')) {
    if (l.ticketNo === '4862083218') {
      out.push(t({ ticketNo: l.ticketNo, date: l.date, amount: 1844.12, totalDoc: 1833.67 }));
      out.push(t({ ticketNo: l.ticketNo, date: l.date, amount: -1603.67, totalDoc: 230, status: 'REFUND' }));
    } else if (l.ticketNo === '4862141169') {
      out.push(t({ ticketNo: l.ticketNo, date: l.date, amount: 1796, totalDoc: 1785.95 }));
    } else out.push(t({ ticketNo: l.ticketNo, date: l.date, amount: l.debit, totalDoc: Math.round((l.debit - 10) * 100) / 100 }));
  }
  return out;
}
// Everything before August, as one payment that leaves the account where
// the statement opens it.
const payments = [pay(14388.37, '2026-07-31'), pay(20000, '2026-08-23', 'Aug TopUp — receipt RV263365'),
  pay(5000, '2026-09-22', 'SEP TopUp'), pay(10000, '2026-09-27', 'Sep TopUp')];

console.log('\n1. An account that agrees');
{
  const r = reviewStatement(st, 'Ibtekar', books(), payments);
  check('our closing on 30/09', r.ourClosing, 13330.22);
  check('a fil of rounding', r.closingGap, 0.01);
  check('every receipt found, the last one three days later', r.receipts.map(x => !!x.recorded), [true, true, true]);
  check('nothing billed that we do not hold', r.notInBooks.length, 0);
  check('nothing of ours unbilled', r.notBilled.length, 0);
}

console.log('\n2. A refund netted across two tickets is said, not corrected');
{
  const r = reviewStatement(st, 'Ibtekar', books(), payments);
  check('nothing to correct', r.reprice.length, 0);
  check('both put to a person', r.ask.map(c => [c.line.ticketNo, c.gap]).sort(),
        [['4862083218', 791.23], ['4862141169', -791.24]]);
  check('and why', r.ask.every(c => /same money/.test(c.why)), true);
}

console.log('\n3. One ticket billed at another figure takes the statement\'s');
{
  const ours = books();
  const x = ours.find(o => o.ticketNo === '4861234273')!;
  x.amount = 772.8;   // held at the fare, the fee missing
  const r = reviewStatement(st, 'Ibtekar', ours, payments);
  const fix = r.reprice.find(p => p.ticketNo === '4861234273')!;
  check('repriced to the statement', [fix.was, fix.amount], [772.8, 783]);
  check('the fee above the fare marked', fix.adjustment, 10);
  check('the account out by it now', r.closingGap, -10.19);
  check('and agrees once corrected', r.gapAfterReprice, 0.01);
  // The other difference on the statement does not hide the netted refund.
  check('the netted pair still put to a person', r.ask.map(c => c.line.ticketNo).sort(), ['4862083218', '4862141169']);
  check('and only the one ticket corrected', r.reprice.map(p => p.ticketNo), ['4861234273']);
}

console.log('\n4. What is missing on either side');
{
  const ours = books().filter(o => o.ticketNo !== '4861378536');
  ours.push(t({ ticketNo: '4869999999', date: '2026-09-01', amount: 500, totalDoc: 490 }));
  const r = reviewStatement(st, 'Ibtekar', ours, payments.slice(0, 3));
  check('billed and not in our books', r.notInBooks.map(c => [c.line.ticketNo, c.theirs]), [['4861378536', 1857]]);
  check('ours and never billed', r.notBilled.map(o => o.ticketNo), ['4869999999']);
  check('a receipt we never recorded', r.receipts.filter(x => !x.recorded).map(x => x.line.document), ['RV263980']);
}

console.log('\n5. The ten riyals');
{
  const r = reviewStatement(st, 'Ibtekar', books(), payments);
  check('on every single-row ticket billed above its fare', r.fees.count, 28);
  check('ten each in this fixture', [r.fees.min, r.fees.max], [10, 10]);
}

console.log('\n6. What changed since their last statement');
{
  const prev = { id: 's', vendorName: 'Ibtekar', periodStart: '2026-08-01', periodEnd: '2026-09-14', currency: 'SAR',
    openingBalance: 13235.37, closingBalance: 8266.37, billed: 24969, paid: 20000, otherCharges: 0 } as VendorStatement;
  const r = reviewStatement(st, 'Ibtekar', books(), payments, [prev]);
  check('the same opening day, 1,153.00 higher', [r.since?.on, r.since?.was, r.since?.now, r.since?.change],
        ['2026-08-01', 13235.37, 14388.37, 1153]);
  const later = { ...prev, periodStart: '2026-07-01' };
  const r2 = reviewStatement(st, 'Ibtekar', books(), payments, [later]);
  check('a different opening day: their balance on its last day', [r2.since?.on, r2.since?.now, r2.since?.change],
        ['2026-09-14', 9419.37, 1153]);
  check('the statement itself, saved, is not its own previous one',
        reviewStatement(st, 'Ibtekar', books(), payments, [{ ...prev, periodEnd: '2026-09-30',
          openingBalance: 14388.37, closingBalance: 13330.23 }]).since, null);
}

console.log('\nN. A sale and its refund on the same statement');
{
  /* Ibtekar's 01/10-11/10 statement bills 4862343302 at 1,917.00 and
     refunds 1,906.70 on RFD260587 two days later; we held the sale only.
     Netted, that read as "reprice to 10.30" - burying a 1,906.70 refund
     inside a ticket priced at ten riyals. */
  const mini = {
    ...st, periodStart: '2026-10-01', periodEnd: '2026-10-11', openingBalance: 0, closingBalance: 0,
    lines: [
      { section: 'TICKET', date: '2026-10-06', document: 'INV264614', airline: '065', ticketNo: '4862343302', debit: 1917, credit: 0, balance: 0 },
      { section: 'TICKET', date: '2026-10-09', document: 'RFD260587', airline: '065', ticketNo: '4862343302', debit: 0, credit: 1906.7, balance: 0 },
      { section: 'TICKET', date: '2026-10-07', document: 'INV264666', airline: '065', ticketNo: '4862405611', debit: 827, credit: 0, balance: 0 },
      { section: 'TICKET', date: '2026-10-09', document: 'RFD260583', airline: '065', ticketNo: '4862405611', debit: 0, credit: 586.5, balance: 0 },
      { section: 'TICKET', date: '2026-10-07', document: 'INV264666', airline: '065', ticketNo: '4862405625', debit: 185, credit: 0, balance: 0 },
      { section: 'TICKET', date: '2026-10-08', document: 'RFD260589', airline: '065', ticketNo: '4862405625', debit: 0, credit: 570.4, balance: 0 },
    ],
  } as typeof st;
  const ours = [
    t({ ticketNo: '4862343302', date: '2026-10-06', amount: 1906.7, totalDoc: 1906.7 }),
    t({ ticketNo: '4862405611', date: '2026-10-07', amount: -586.5, totalDoc: 230, status: 'REFUND' }),
    t({ ticketNo: '4862405625', date: '2026-10-07', amount: 175, totalDoc: 175 }),
  ];
  const r = reviewStatement(mini, 'Ibtekar', ours, []);
  const by = (k: string) => r.lines.find(c => c.line.ticketNo === k)!;
  check('a refund we lack is not repriced into the sale', r.reprice.map(p => p.ticketNo), []);
  check('...it is asked, as a refund to record', [by('4862343302').verdict, /refunds 1906.70 \(RFD260587\).*Record the refund/.test(by('4862343302').why)], ['ASK', true]);
  check('a sale we lack, beside the refund we hold, is asked as a sale to record',
        /bills the sale at 827.00 \(INV264666\).*Record the sale/.test(by('4862405611').why), true);
  check('a refund bigger than its sale is questioned, not recorded',
        /larger than the sale/.test(by('4862405625').why), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
