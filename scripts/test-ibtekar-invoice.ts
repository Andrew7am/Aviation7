/**
 * Reading an Ibtekar tax invoice, and setting it against the ledger.
 *
 * The fixtures are two real invoices, as positions rather than as text:
 * INV261733 of 30/05/2026 — 49 tickets, 41,614.62 net, 47,633.00 to pay — and
 * the August bundle, five invoices in one file, which is the shape that broke
 * every text-order reading of them.
 *
 * INV261733 is the one that matters most. It carries an international sector,
 * so its VAT is 14.46% of its net rather than 15%, and a reading that grosses
 * a line up by 15% reports a ticket the ledger has exactly right as 223.79
 * short. That case is section 4.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseIbtekarInvoicePdf, invoiceFoots, toRows, findColumns, PdfWord,
} from '../src/core/parsers/ibtekarInvoicePdf';
import { reconcileInvoice } from '../src/core/helpers/invoiceReconcile';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const fixture = (name: string): PdfWord[] =>
  JSON.parse(readFileSync(resolve('scripts/fixtures', name), 'utf8'));

const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2),
  ticketNo: '', pnr: '', passengerName: '', airlineCode: '065', route: '',
  source: 'Ibtekar', date: '2026-05-30', amount: 0, totalDoc: 0, commission: 0,
  reqNum: '', status: 'ISSUE', currency: 'SAR', isDuplicate: false, userId: 'u', ...o,
});

console.log('\n1. One invoice, 49 tickets');
const [big] = parseIbtekarInvoicePdf(fixture('ibtekar-INV261733-words.json'));
{
  check('the number',        big.invoice, 'INV261733');
  check('the date',          big.invoiceDate, '2026-05-30');
  check('it says tax invoice', big.taxInvoice, true);
  check('every ticket line',  big.lines.length, 49);
  check('net',               big.subTotal, 41614.62);
  check('VAT',               big.vat, 6018.38);
  check('to pay',            big.total, 47633.00);

  const f = invoiceFoots(big);
  check('the lines come to the printed net', f.lines, true);
  check('net plus VAT is the total',         f.totals, true);
  check('and the line sum is that figure',   f.lineSum, 41614.62);
}

console.log('\n2. A ticket block is read as one thing, not four rows');
{
  const l = big.lines.find(x => x.ticketNo === '6906030983')!;
  check('airline',    l.airline, '065');
  check('amount',     l.amount, 1500.69);
  check('passenger',  l.passenger, 'MANSOUR/GIHAN MOHAMED');
  check('sector',     l.sector, 'CAI/JED/RUH/CAI');
  check('carrier',    l.carrier, 'Saudi Arabian Airlines');
  check('PNR',        l.pnr, '7XH5T2');
  check('cabin',      l.cabin, 'Economy Class');
  check('travel date', l.travelDate, '2026-06-01');
  check('issue date',  l.issueDate, '2026-05-27');
}

console.log('\n3. A bundle is every invoice in it, not the first');
{
  const bundle = parseIbtekarInvoicePdf(fixture('ibtekar-aug-bundle-words.json'));
  check('five invoices',  bundle.map(i => i.invoice),
        ['INV263097', 'INV263283', 'INV263365', 'INV263387', 'INV263439']);
  check('each keeps its own date', bundle.map(i => i.invoiceDate),
        ['2026-08-08', '2026-08-17', '2026-08-18', '2026-08-20', '2026-08-22']);
  check('each keeps its own lines', bundle.map(i => i.lines.length), [1, 1, 1, 4, 1]);
  check('each keeps its own total', bundle.map(i => i.total),
        [783, 1857, 1803, 7774.99, 859]);
  check('all five foot', bundle.map(i => invoiceFoots(i).lines), [true, true, true, true, true]);
  check('no ticket leaks from one invoice to the next',
        bundle[1].lines.map(l => l.ticketNo), ['4861378536']);
}

console.log('\n4. VAT is charged on the invoice, not on the line');
{
  // 6,018.38 on 41,614.62 is 14.46%: the international sector is zero-rated.
  const rate = Math.round((big.vat! / big.subTotal!) * 10000) / 100;
  check('this invoice is not a flat 15%', rate, 14.46);

  // The ledger holds the same 49 tickets at 47,633.00 — the invoice's total,
  // not the sum of its lines grossed up.
  const led = big.lines.map(l => tkt({
    ticketNo: l.ticketNo, amount: 0, vendorReference: 'INV261733',
  }));
  led[0].amount = 47633.00;
  const r = reconcileInvoice(big, led);
  check('compared invoice to invoice, it agrees', r.agrees, true);
  check('and the difference is nothing',          r.difference, 0);
  check('every line is matched',
        r.lines.filter(l => l.verdict === 'MATCHED').length, 49);

  // The comparison that was wrong: line net x 1.15 for a zero-rated sector.
  const naive = Math.round(1500.69 * 1.15 * 100) / 100;
  check('grossing the line up would have invented 223.79',
        Math.round((naive - 1502.00) * 100) / 100, 223.79);
}

console.log('\n5. What the ledger is missing, and what it holds that is not billed');
{
  const inv = parseIbtekarInvoicePdf(fixture('ibtekar-aug-bundle-words.json'))[3]; // INV263387
  check('four lines', inv.lines.length, 4);

  const led = [
    tkt({ ticketNo: inv.lines[0].ticketNo, amount: 1857, vendorReference: 'INV263387' }),
    tkt({ ticketNo: inv.lines[1].ticketNo, amount: 906,  vendorReference: 'INV263365' }),
    // lines[2] is absent altogether
    tkt({ ticketNo: inv.lines[3].ticketNo, amount: 469,  vendorReference: 'INV263387' }),
    tkt({ ticketNo: '9999999999',          amount: 100,  vendorReference: 'INV263387' }),
  ];
  const r = reconcileInvoice(inv, led);
  check('matched',        r.lines.filter(l => l.verdict === 'MATCHED').length, 2);
  check('missing',        r.lines.filter(l => l.verdict === 'MISSING').map(l => l.line.ticketNo),
        [inv.lines[2].ticketNo]);
  check('held elsewhere', r.lines.filter(l => l.verdict === 'ELSEWHERE').map(l => l.heldUnder),
        ['INV263365']);
  check('filed here but not billed', r.notOnInvoice.map(t => t.ticketNo), ['9999999999']);
  check('the ledger total is what is filed here', r.ledgerTotal, 2426);
  check('the difference is against the printed total',
        r.difference, Math.round((2426 - 7774.99) * 100) / 100);
}

console.log('\n6. A refund never makes its invoice look short');
{
  const inv = parseIbtekarInvoicePdf(fixture('ibtekar-aug-bundle-words.json'))[0]; // INV263097, 783.00
  const t = inv.lines[0].ticketNo;
  const led = [
    tkt({ ticketNo: t, amount: 783, vendorReference: 'INV263097' }),
    tkt({ ticketNo: t, amount: -783, status: 'REFUND', vendorReference: 'INV263097' }),
  ];
  const r = reconcileInvoice(inv, led);
  check('the refund is not counted against it', r.ledgerTotal, 783);
  check('so the invoice still agrees',          r.agrees, true);
  check('but the refund is reported',           r.refunds.length, 1);
}

console.log('\n7. A line billed at nothing is not a hole in the ledger');
{
  const fake = {
    invoice: 'INV999999', invoiceDate: '2026-07-24', taxInvoice: true,
    subTotal: 100, vat: 15, total: 115,
    lines: [
      { airline: '065', ticketNo: '1111111111', passenger: '', sector: '', carrier: '',
        pnr: '', cabin: '', amount: 100, travelDate: '', issueDate: '' },
      { airline: '065', ticketNo: '2222222222', passenger: '', sector: '', carrier: '',
        pnr: '', cabin: '', amount: 0, travelDate: '', issueDate: '' },
    ],
  };
  const r = reconcileInvoice(fake, [tkt({ ticketNo: '1111111111', amount: 115, vendorReference: 'INV999999' })]);
  check('the priced line matches', r.lines[0].verdict, 'MATCHED');
  check('the zero line is called what it is', r.lines[1].verdict, 'ZERO_LINE');
  check('and the invoice agrees', r.agrees, true);
}

console.log('\n8. The columns come from the invoice, not from a constant');
{
  const rows = toRows(fixture('ibtekar-INV261733-words.json'));
  const col = findColumns(rows);
  check('the name column was found',   col.name > 0 && col.name < 100, true);
  check('the ticket column was found', col.ticket > 300 && col.ticket < 400, true);
  check('amount is right of ticket',   col.amount > col.ticket, true);

  // No header anywhere: the measured fallback is used rather than nothing.
  const none = findColumns([[{ page: 0, x: 10, y: 10, text: 'nothing' }]]);
  check('the fallback stands in', none, { seq: 0, name: 45, sector: 200, ticket: 350, amount: 500 });
}

console.log('\n9. Nothing in, nothing out');
{
  check('an empty document', parseIbtekarInvoicePdf([]), []);
  check('words with no invoice number',
        parseIbtekarInvoicePdf([{ page: 0, x: 10, y: 10, text: 'hello' }]), []);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
