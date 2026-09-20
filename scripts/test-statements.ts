/**
 * A vendor's statement of account, checked three ways.
 *
 * The figures in section 1 are Ibtekar's real statement for 01/08-14/09 2026,
 * which is the document this screen was built to read: opening 13,235.37 Cr,
 * 24,969.00 billed over 21 tickets, one receipt of 20,000.00, closing
 * 8,266.37 Cr. The ledger for those dates was 609.81 short of what Ibtekar
 * billed, and every piastre of that was a defect in our own rows - a ticket
 * dated 1970, a ticket 200.00 under, a ticket 0.20 over.
 */
import {
  checkStatement, summariseVendor, ticketsInPeriod, unmatchedInPeriod,
  balanceOverRange, dayBefore, dayAfter, ledgerAccount,
} from '../src/core/helpers/statementMath';
import { calcVendorBalance } from '../src/core/helpers/walletMath';
import type { Ticket, VendorStatement } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2),
  ticketNo: '4861234273', pnr: '', passengerName: '', airlineCode: '065',
  route: '', source: 'Ibtekar', date: '2026-08-08', amount: 783,
  totalDoc: 783, commission: 0, reqNum: '', status: 'ISSUE',
  currency: 'SAR', isDuplicate: false, userId: 'u', ...o,
});

const stm = (o: Partial<VendorStatement>): VendorStatement => ({
  id: Math.random().toString(36).slice(2), vendorName: 'Ibtekar',
  periodStart: '2026-08-01', periodEnd: '2026-09-14', currency: 'SAR',
  openingBalance: 13235.37, closingBalance: 8266.37,
  billed: 24969, paid: 20000, otherCharges: 0, ...o,
});

console.log('\n1. Ibtekar 01/08-14/09 2026, as the statement prints it');
{
  const c = checkStatement(stm({}), []);
  check('the statement foots',              c.foots, true);
  check('implied closing is the printed one', c.impliedClosing, 8266.37);
  check('no footing gap',                   c.footingGap, 0);

  // The ledger as it stood: 24,359.19 over the same dates.
  const led = [
    tkt({ amount: 24359.19, date: '2026-08-08' }),
  ];
  const d = checkStatement(stm({}), led);
  check('the ledger is short by what we found', d.billedGap, 609.81);
  check('and it says how much we did record',   d.ledgerBilled, 24359.19);
}

console.log('\n2. A statement that does not foot is not quietly used');
{
  // A receipt on the statement that nobody entered.
  const c = checkStatement(stm({ paid: 0 }), []);
  check('foots is false',          c.foots, false);
  check('the gap is the missing receipt', c.footingGap, -20000);
}

console.log('\n3. Which tickets fall inside the period');
{
  const led = [
    tkt({ date: '2026-07-31', amount: 100 }),   // the day before
    tkt({ date: '2026-08-01', amount: 200 }),   // first day, counted
    tkt({ date: '2026-09-14', amount: 300 }),   // last day, counted
    tkt({ date: '2026-09-15', amount: 400 }),   // the day after
    tkt({ date: '',           amount: 500 }),   // undated
    tkt({ date: '2026-08-10', amount: 600, source: 'NSA' }), // another vendor
  ];
  const got = ticketsInPeriod('Ibtekar', led, '2026-08-01', '2026-09-14');
  check('both ends are inclusive, others are out', got.map(t => t.amount), [200, 300]);

  const c = checkStatement(stm({ billed: 500 }), led);
  check('an undated row is not counted in',  c.ledgerBilled, 500);
  check('and the row count says how many',   c.ledgerRows, 2);
}

console.log('\n4. A refund moves the ledger down, as the vendor credits it');
{
  const led = [
    tkt({ date: '2026-08-05', amount: 1000 }),
    tkt({ date: '2026-08-06', amount: -400, status: 'REFUND' }),
  ];
  const c = checkStatement(stm({ billed: 600 }), led);
  check('issues less refunds', c.ledgerBilled, 600);
  check('and no gap',          c.billedGap, 0);
}

console.log('\n5. The chain from one statement to the next');
{
  const s1 = stm({ periodStart: '2026-08-01', periodEnd: '2026-09-14', closingBalance: 8266.37 });
  const s2 = stm({ periodStart: '2026-09-15', periodEnd: '2026-09-30',
                   openingBalance: 8266.37, billed: 1000, paid: 0, closingBalance: 7266.37 });
  const sum = summariseVendor('Ibtekar', [s2, s1], []);
  check('oldest first regardless of the order given',
        sum.checks.map(c => c.statement.periodStart), ['2026-08-01', '2026-09-15']);
  check('the chain holds',        sum.hasChainBreak, false);
  check('the first has no chain', sum.checks[0].chainGap, null);
  check('the second matches',     sum.checks[1].chainGap, 0);
  check('the latest closing is the last one', sum.latestClosing, 7266.37);
  check('as of the last day',                 sum.latestAsOf, '2026-09-30');

  const broken = summariseVendor('Ibtekar',
    [s1, { ...s2, openingBalance: 9000 }], []);
  check('a period missing in between is reported', broken.hasChainBreak, true);
  check('by how much',                             broken.checks[1].chainGap, 733.63);
}

console.log('\n6. Only this vendor, and only its own currency');
{
  const s = summariseVendor('NSA', [stm({}), stm({ vendorName: 'NSA', currency: 'SAR' })], []);
  check('another vendor\'s statement is not counted', s.checks.length, 1);
  check('the currency comes from the statement',      s.currency, 'SAR');
}

console.log('\n7. Rows the vendor\'s own documents never name');
{
  const led = [
    tkt({ date: '2026-08-05', vendorReference: 'INV263097' }),
    tkt({ date: '2026-08-06', vendorReference: '1559' }),
    tkt({ date: '2026-08-07', vendorReference: 'KSAML2004' }),
    tkt({ date: '2026-08-08', vendorReference: '' }),
    tkt({ date: '2026-08-09', vendorReference: 'RV263365' }),
  ];
  const c = checkStatement(stm({}), led);
  check('an invoice number, a receipt and a ZATCA number all count as named',
        unmatchedInPeriod(c).map(t => t.vendorReference), ['KSAML2004', '']);
}

console.log('\n8. Rounding is to the piastre, not to the cent of a float');
{
  const c = checkStatement(stm({ openingBalance: 0.1, paid: 0.2, billed: 0, otherCharges: 0,
                                 closingBalance: 0.3 }), []);
  check('0.1 + 0.2 still foots as 0.3', c.foots, true);
  check('and the gap prints as zero',   c.footingGap, 0);
}

console.log('\n9. What the vendor added on their own side is charged, not ignored');
{
  const c = checkStatement(stm({ otherCharges: 500, closingBalance: 7766.37 }), []);
  check('a service fee lowers the implied closing', c.impliedClosing, 7766.37);
  check('and the period foots with it in',          c.foots, true);

  const without = checkStatement(stm({ otherCharges: 0, closingBalance: 7766.37 }), []);
  check('leaving it out breaks the footing by its size', without.footingGap, 500);
}

console.log('\n10. The account between any two dates');
{
  const pay = (o: any) => ({ id: 'p', vendorName: 'Ibtekar', amount: 0, date: '', ...o });

  check('the day before',   dayBefore('2026-09-01'), '2026-08-31');
  check('the day after',    dayAfter('2026-08-31'), '2026-09-01');
  check('over a month end', dayBefore('2026-03-01'), '2026-02-28');

  const statement = stm({ periodStart: '2026-08-01', periodEnd: '2026-08-31',
                          openingBalance: 13235.37, billed: 5000, paid: 0,
                          closingBalance: 8235.37 });
  const led = [
    tkt({ date: '2026-08-20', amount: 5000 }),            // inside the statement
    tkt({ date: '2026-09-03', amount: 1200 }),            // between it and the range
    tkt({ date: '2026-09-10', amount: 800 }),             // in the range
    tkt({ date: '2026-09-12', amount: -300, status: 'REFUND' }),
    tkt({ date: '2026-09-20', amount: 999 }),             // after the range
    tkt({ date: '', amount: 111 }),                       // undated
  ];
  const pays = [pay({ id: 'a', amount: 2000, date: '2026-09-05' }),
                pay({ id: 'b', amount: 500,  date: '2026-09-11' }),
                pay({ id: 'c', amount: 700,  date: '2026-09-25' })];

  const r = balanceOverRange('Ibtekar', '2026-09-08', '2026-09-15', [statement], led, pays);
  check('anchored on the statement',   r.anchor, 'statement');
  // 8,235.37 closing, then 03/09 -1,200 and 05/09 +2,000 before the range opens.
  check('carried to the day it opens', r.statedOpening, 9035.37);
  check('issued in the range',         r.issued, 800);
  check('refunded in the range',       r.refunded, 300);
  check('paid in the range',           r.paid, 500);
  check('closing',                     r.statedClosing, 9035.37 + 500 - 800 + 300);
  check('the tickets issued',   r.issues.map(t => t.date), ['2026-09-10']);
  check('the tickets refunded', r.refunds.map(t => t.date), ['2026-09-12']);
  check('the payments',         r.payments.map(p => p.id), ['b']);
  check('undated rows are reported, not counted', r.undated, 1);

  // A range that opens the day after a statement closes takes its figure whole.
  const flush = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-15', [statement], led, pays);
  check('no carry needed', flush.statedOpening, 8235.37);
  check('and it says so',  flush.anchorLabel.includes('stated this balance'), true);

  // The statement's own last day is inside its closing balance already.
  check('the statement period itself is not re-counted',
        balanceOverRange('Ibtekar', '2026-09-01', '2026-09-01', [statement], led, pays).statedOpening,
        8235.37);
}

console.log('\n10b. A statement that is still open on the day the range starts');
{
  // Ibtekar's real shape: one statement running 01/08 to 14/09, and someone
  // asking what happened in September. Its closing balance is no use - it is
  // dated after the range opens - but its OPENING balance is true on 01/08.
  const s = stm({ periodStart: '2026-08-01', periodEnd: '2026-09-14',
                  openingBalance: 13235.37, closingBalance: 8266.37,
                  billed: 24969, paid: 20000 });
  const led = [
    tkt({ date: '2026-08-10', amount: 4000 }),
    tkt({ date: '2026-09-05', amount: 1000 }),
  ];
  const pays = [{ id: 'a', vendorName: 'Ibtekar', amount: 2000, date: '2026-08-20' }];

  const r = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-30', [s], led, pays);
  check('it anchors on the statement, not the wallet', r.anchor, 'statement');
  check('carried from its opening balance over August', r.statedOpening, 13235.37 - 4000 + 2000);
  check('and it says which statement',
        r.anchorLabel.includes('2026-08-01 to 2026-09-14 statement'), true);
  check('September alone is the movement', r.issued, 1000);

  // A range starting on the statement's own first day takes its figure whole.
  const flush = balanceOverRange('Ibtekar', '2026-08-01', '2026-08-31', [s], led, pays);
  check('no carry on the first day', flush.statedOpening, 13235.37);

  // A statement that closed earlier still wins over one merely covering.
  const earlier = stm({ periodStart: '2026-07-01', periodEnd: '2026-08-31',
                        closingBalance: 999, openingBalance: 0, billed: 0, paid: 0 });
  const both = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-30', [s, earlier], led, pays);
  check('the one that closed the day before is preferred', both.statedOpening, 999);
}

console.log('\n10c. Our own books, beside theirs');
{
  const st = stm({ periodStart: '2026-08-01', periodEnd: '2026-08-31',
                   openingBalance: 1000, closingBalance: 1000, billed: 0, paid: 0 });
  const led = [
    tkt({ date: '2026-08-10', amount: 4000 }),
    tkt({ date: '2026-09-10', amount: 500 }),
    tkt({ date: '', amount: 250 }),          // undated: in the wallet, in no period
  ];
  const pays = [{ id: 'a', vendorName: 'Ibtekar', amount: 6000, date: '2026-09-05' }];
  const wallet = { initialBalance: 100 };

  const r = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-30', [st], led, pays, wallet);
  // 100 + 6,000 - (4,000 + 500 + 250): the same arithmetic Vendor Credit does.
  check('our books count every row, dated or not', r.closingBalance, 1350);
  check('and the vendor figure is carried separately', r.statedClosing, 1000 + 6000 - 500);
  check('the gap is the two set side by side', r.balanceGap, 1350 - 6500);

  // An undated row is in the wallet figure and in no period's movement.
  check('the movement leaves it out', r.issued, 500);
  check('but it is reported',         r.undated, 1);

  const early = balanceOverRange('Ibtekar', '2026-08-01', '2026-08-31', [st], led, pays, wallet);
  check('a later ticket is not counted early', early.closingBalance, 100 - 4000 - 250);

  const noWallet = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-30', [st], led, pays);
  check('with no wallet there is no such figure', noWallet.closingBalance, null);
  check('and no gap to report',                   noWallet.balanceGap, null);

  // The row of figures on screen has to add up, or it is five numbers rather
  // than an account. An undated row sits in both ends and cancels, which is
  // the only reason it can be counted in a dated balance at all.
  check('opening + paid - issued + refunded is the closing figure',
        Math.round((r.openingBalance! + r.paid - r.issued + r.refunded) * 100) / 100,
        r.closingBalance);
  check('and it still foots with an undated row in the ledger',
        led.some(t => !t.date), true);
}

console.log('\n11. When no statement reaches back that far');
{
  const led = [tkt({ date: '2026-09-10', amount: 800 })];
  const bare = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-15', [], led, []);
  check('nothing anchors it',        bare.anchor, 'none');
  check('so no balance is invented', bare.statedOpening, null);
  check('nor a closing one',         bare.statedClosing, null);
  check('but the movement is real',  bare.issued, 800);

  const walleted = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-15', [], led, [],
                                    { initialBalance: 50000, openingDate: '2026-01-01' });
  check('the wallet can stand in', walleted.anchor, 'wallet');
  check('at its own figure',       walleted.statedOpening, 50000);
  check('and it admits whose arithmetic it is',
        walleted.anchorLabel.includes('our arithmetic, not theirs'), true);
}

console.log('\n12. Only this vendor is counted');
{
  const led = [
    tkt({ date: '2026-09-10', amount: 800, source: 'Ibtekar' }),
    tkt({ date: '2026-09-10', amount: 9999, source: 'NSA' }),
  ];
  const pays = [{ id: 'x', vendorName: 'NSA', amount: 5000, date: '2026-09-11' }];
  const r = balanceOverRange('Ibtekar', '2026-09-01', '2026-09-15', [], led, pays);
  check("another vendor's ticket is out", r.issued, 800);
  check('and their payment too',          r.paid, 0);
}

console.log('\n13. Our own books, period by period');
{
  // Two months of trading against a wallet that opened at zero.
  const led = [
    tkt({ date: '2026-08-05', amount: 1000 }),
    tkt({ date: '2026-08-20', amount: 500 }),
    tkt({ date: '2026-09-03', amount: 300 }),
    tkt({ date: '2026-09-04', amount: -200 }),      // a refund
  ];
  const pays = [{ id: 'p1', vendorName: 'Ibtekar', amount: 2000, date: '2026-08-10' }];
  const a = ledgerAccount('Ibtekar', [], led, pays, { initialBalance: 0 }, '2026-09-30');

  check('a period per month',            a.periods.length, 2);
  check('the first opens where the wallet did', a.periods[0].opening, 0);
  check('and closes on our own rows',    a.periods[0].closing, 500);
  check('the second opens where the first closed',
        a.periods[1].opening, a.periods[0].closing);
  check('refunds come back to us',       a.periods[1].refunded, 200);
  check('the closing balance is the last one', a.balance, 400);
  check('and it is dated',               a.balanceAsOf, '2026-09-30');
  check('with nothing stated against it', a.statedBalance, null);
  check('so no difference is claimed',   a.balanceGap, null);
}

console.log('\n14. Every period foots, by construction');
{
  const led = [
    tkt({ date: '2026-08-05', amount: 1000 }),
    tkt({ date: '2026-08-20', amount: -400 }),
    tkt({ date: '2026-09-03', amount: 300 }),
  ];
  const pays = [
    { id: 'p1', vendorName: 'Ibtekar', amount: 2000, date: '2026-08-10' },
    { id: 'p2', vendorName: 'Ibtekar', amount: 50, date: '2026-09-09' },
  ];
  const a = ledgerAccount('Ibtekar', [], led, pays, { initialBalance: 100 }, '2026-09-30');
  for (const p of a.periods)
    check(`${p.from} foots`,
          Math.round((p.opening + p.paid - p.issued + p.refunded) * 100) / 100, p.closing);
}

console.log('\n15. The closing figure IS the Vendor Credit balance');
{
  // The invariant the whole screen rests on: two different code paths, the
  // same number. If these ever part company one of them has a bug, and the
  // one people will believe is whichever screen they happened to open.
  const wallet = {
    id: 'w', vendorName: 'Ibtekar', initialBalance: 1234.56,
    currentBalance: 0, userId: 'u',
  } as any;
  const led = [
    tkt({ date: '2026-08-05', amount: 1000 }),
    tkt({ date: '2026-08-20', amount: -400 }),
    tkt({ date: '2026-09-03', amount: 300 }),
    tkt({ date: '', amount: 77 }),                  // undated, and still charged
    tkt({ date: '2026-09-04', amount: 900, status: 'FUND' }),  // never a charge
  ];
  const tops = [
    { id: 'p1', vendorId: 'w', vendorName: 'Ibtekar', amount: 2000, date: '2026-08-10' },
    { id: 'p2', vendorId: 'w', vendorName: 'Ibtekar', amount: 50, date: '2026-09-09' },
  ] as any[];
  const a = ledgerAccount('Ibtekar', [], led, tops, { initialBalance: 1234.56 }, '2026-09-30');
  const vc = Math.round(calcVendorBalance(wallet, led as any, tops) * 100) / 100;

  check('the two agree to the piastre', a.balance, vc);
  check('a FUND row is a charge on neither', vc, 2307.56);
  check('the undated row is counted, and said so', a.undated, 1);
  check('with its amount',                   a.undatedAmount, 77);
}

console.log('\n16. A wallet with an opening date does not reach behind it');
{
  const wallet = {
    id: 'w', vendorName: 'Ibtekar', initialBalance: 5000,
    openingDate: '2026-08-01', currentBalance: 0, userId: 'u',
  } as any;
  const led = [
    tkt({ date: '2026-07-20', amount: 9999 }),      // settled before the wallet opened
    tkt({ date: '2026-08-05', amount: 1000 }),
    tkt({ date: '', amount: 77 }),                  // undatable, so not charged either
  ];
  const a = ledgerAccount('Ibtekar', [], led, [],
    { initialBalance: 5000, openingDate: '2026-08-01' }, '2026-08-31');
  const vc = Math.round(calcVendorBalance(wallet, led as any, []) * 100) / 100;

  check('the old ticket is not charged twice', a.balance, 4000);
  check('and Vendor Credit says the same',     a.balance, vc);
}

console.log('\n17. Their statement is set against ours on the same dates');
{
  const s = stm({ periodStart: '2026-08-01', periodEnd: '2026-09-14',
                  openingBalance: 13235.37, closingBalance: 8266.37,
                  billed: 24969, paid: 20000 });
  const led = [tkt({ date: '2026-08-08', amount: 24359.19 })];
  const pays = [{ id: 'p', vendorName: 'Ibtekar', amount: 20000, date: '2026-08-20' }];
  const a = ledgerAccount('Ibtekar', [s], led, pays,
    { initialBalance: 13235.37 }, '2026-09-14');

  const cut = a.periods.find(p => p.statement)!;
  check('their dates are used as the cut',   [cut.from, cut.to], ['2026-08-01', '2026-09-14']);
  check('their statement is carried on it',  cut.statement!.id, s.id);
  check('they billed more than we recorded', cut.billedGap, 609.81);
  check('our closing is ours',               cut.closing, 8876.18);
  check('and the difference is stated',      cut.balanceGap, 609.81);
  check('the headline is theirs, dated',     [a.statedBalance, a.statedAsOf],
        [8266.37, '2026-09-14']);
}

console.log('\n18. Past their last statement, the account is ours alone');
{
  const s = stm({ periodStart: '2026-08-01', periodEnd: '2026-08-31',
                  openingBalance: 0, closingBalance: 500, billed: 1000, paid: 1500 });
  const led = [
    tkt({ date: '2026-08-10', amount: 1000 }),
    tkt({ date: '2026-09-10', amount: 250 }),       // after they stopped stating
  ];
  const pays = [{ id: 'p', vendorName: 'Ibtekar', amount: 1500, date: '2026-08-11' }];
  const a = ledgerAccount('Ibtekar', [s], led, pays, { initialBalance: 0 }, '2026-09-30');

  check('two periods: theirs, then ours',  a.periods.length, 2);
  check('the first is cut on their dates', a.periods[0].to, '2026-08-31');
  check('the second is a month of ours',   [a.periods[1].from, a.periods[1].to],
        ['2026-09-01', '2026-09-30']);
  check('with nothing of theirs on it',    a.periods[1].statement, null);
  check('and no difference claimed',       a.periods[1].balanceGap, null);
  check('todays balance is on that row',   a.balance, 250);
  check('while theirs stopped in August',  a.statedAsOf, '2026-08-31');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
