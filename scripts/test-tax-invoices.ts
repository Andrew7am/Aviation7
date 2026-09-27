/**
 * The tax invoice tracker: reading the document, and answering the question.
 *
 * The question is not "does this ticket have an invoice number" — every
 * Ibtekar row in the ledger has one, typed off a statement of account. It is
 * "is this document number printed on a piece of paper we hold, and does that
 * paper call itself a tax invoice". Those are different, and only the second
 * one is worth anything to an auditor.
 *
 * Two failures are guarded here above all others, because both are silent:
 *
 *   - Ibtekar's ZATCA template read by the older parser comes back as an
 *     empty list. No error. Every ticket on it would then be reported as
 *     having no tax invoice, which is the same wrong answer as never having
 *     uploaded it. Invoice 1559 was reported missing this way while sitting
 *     on the shared drive.
 *   - A document that does not call itself a TAX INVOICE cannot be used to
 *     reclaim the VAT on it. Counting it as one is the expensive mistake.
 *
 * The CLASSIC fixtures are real invoices, as positions. The ZATCA fixture is
 * built here from the template's documented shape — figures printed before
 * their labels, "InvoNO:", no per-ticket amounts — because no ZATCA file has
 * been through this repo yet.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { PdfWord } from '../src/core/parsers/ibtekarInvoicePdf';
import { parseIbtekarZatcaPdf, isZatcaInvoice, zatcaSerial } from '../src/core/parsers/ibtekarZatcaPdf';
import {
  readIbtekarInvoices, preferReading, type ReadInvoice,
} from '../src/core/parsers/ibtekarInvoiceRead';
import {
  coverageReport, invoiceable, serialOf, HeldInvoice,
} from '../src/core/helpers/taxInvoiceCoverage';
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

/** A word list from rows of text, laid out top to bottom. */
const words = (rows: string[][]): PdfWord[] => {
  const out: PdfWord[] = [];
  rows.forEach((row, r) =>
    row.forEach((text, c) => out.push({ page: 1, x: 40 + c * 90, y: 60 + r * 18, text })));
  return out;
};

const tkt = (o: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2),
  ticketNo: '', pnr: '', passengerName: '', airlineCode: '065', route: '',
  source: 'Ibtekar', date: '2026-05-30', amount: 0, totalDoc: 0, commission: 0,
  reqNum: '', status: 'ISSUE', currency: 'SAR', isDuplicate: false, userId: 'u', ...o,
});

const inv = (o: Partial<HeldInvoice>): HeldInvoice => ({
  invoiceNo: 'INV000001', invoiceDate: '2026-05-30', isTaxInvoice: true,
  net: null, vat: null, total: null, serials: [], ...o,
});

/* ── the ZATCA template ───────────────────────────────────────────────── */

const ZATCA = words([
  ['Tax', 'Invoice', 'فاتورة', 'ضريبية'],
  ['InvoNO:', '1581'],
  ['Date', '05-06-2026'],
  ['#', 'Ticket', 'Passenger', 'Sector'],
  ['1', '065-6906030983', '2026-05-27', 'MANSOUR/GIHAN', 'CAI/JED/RUH/CAI'],
  ['2', '065-6906030984', '2026-05-27', 'SALEM/AHMED', 'RUH/CAI/RUH'],
  ['3', '593-4861234273', '2026-05-28', 'OMAR/HANI', 'JED/DXB/JED'],
  ['PRO-011', 'Air', 'ticket', 'services'],
  ['41,614.62', 'Total(ExculdingVAT)'],
  ['6,018.38', 'Total VAT'],
  ['47,633.00', 'TotalAmountDue'],
]);

console.log('\n1. The ZATCA template is recognised and read');
{
  check('recognised as ZATCA', isZatcaInvoice(ZATCA), true);
  check('their own serial', zatcaSerial(ZATCA), '1581');

  const i = parseIbtekarZatcaPdf(ZATCA, 'INV261733 - Ibtekar.pdf')!;
  check('it calls itself a tax invoice', i.taxInvoice, true);
  check('filed under our reference, off the file name', i.invoice, 'INV261733');
  check('the date, as an ISO date', i.invoiceDate, '2026-06-05');
  check('three tickets', i.lines.map(l => l.ticketNo),
        ['6906030983', '6906030984', '4861234273']);
  check('the airline stays with the document', i.lines[2].airline, '593');
  check('the issue date beside it', i.lines[0].issueDate, '2026-05-27');

  // The figures are printed BEFORE their labels on this template; read
  // forwards, "Total VAT" picks up whatever follows it instead.
  check('net, read backwards from its label', i.subTotal, 41614.62);
  check('VAT', i.vat, 6018.38);
  check('the amount due', i.total, 47633.00);
  check('  ...and VAT is not 15% of the net', Math.round((i.vat! / i.subTotal!) * 10000) / 100, 14.46);

  // There are no per-ticket amounts on this layout at all. A guessed one is
  // worse than none: it makes a line-by-line comparison look available when
  // the document does not support one.
  check('no per-ticket amount is invented', i.lines.map(l => l.amount), [null, null, null]);
}

console.log('\n2. A ZATCA invoice with no INV in the file name still has an identity');
{
  const i = parseIbtekarZatcaPdf(ZATCA, 'scan001.pdf')!;
  check('falls back to their serial', i.invoice, 'IBK-1581');
  check('  ...never blank', i.invoice.length > 0, true);
}

console.log('\n3. An older ZATCA invoice, with no date column, still lists its tickets');
{
  // Requiring the date is how invoice 1559 came to be reported missing.
  const older = words([
    ['Tax', 'Invoice'],
    ['InvoNO:', '1559'],
    ['1', '065-6906030983', 'MANSOUR/GIHAN', 'CAI/JED/RUH/CAI'],
    ['2', '065-6906030984', 'SALEM/AHMED', 'RUH/CAI/RUH'],
    ['12,000.00', 'TotalAmountDue'],
  ]);
  const i = parseIbtekarZatcaPdf(older, 'x.pdf')!;
  check('both tickets read', i.lines.map(l => l.ticketNo), ['6906030983', '6906030984']);
  check('no date claimed', i.lines[0].issueDate, '');
  check('the total still reads', i.total, 12000);
}

console.log('\n4. A document that is not a tax invoice says so');
{
  const plain = words([
    ['Invoice'],
    ['InvoNO:', '1600'],
    ['1', '065-6906030999', 'X/Y', 'CAI/JED'],
    ['500.00', 'TotalAmountDue'],
  ]);
  const i = parseIbtekarZatcaPdf(plain, 'x.pdf')!;
  check('not headed as a tax invoice', i.taxInvoice, false);
  const r = readIbtekarInvoices(plain, 'x.pdf');
  check('and the reader raises it', r.problems.includes('it does not call itself a tax invoice'), true);
  check('  ...while still recording it', r.invoices.length, 1);
}

console.log('\n5. One way in, whichever template arrived');
{
  const zat = readIbtekarInvoices(ZATCA, 'INV261733.pdf');
  check('ZATCA is labelled ZATCA', zat.invoices.map(i => i.layout), ['ZATCA']);
  check('  ...and carries their serial', zat.invoices[0].theirSerial, '1581');
  check('  ...with nothing to complain about', zat.problems, []);

  const classic = readIbtekarInvoices(fixture('ibtekar-INV261733-words.json'), 'INV261733.pdf');
  check('the real classic invoice still reads', classic.invoices.length, 1);
  check('  ...as CLASSIC', classic.invoices[0].layout, 'CLASSIC');
  check('  ...49 tickets', classic.invoices[0].invoice.lines.length, 49);
  check('  ...and it keeps its per-ticket amounts',
        classic.invoices[0].invoice.lines[0].amount !== null, true);

  const bundle = readIbtekarInvoices(fixture('ibtekar-aug-bundle-words.json'), 'aug.pdf');
  check('a bundle comes back as several invoices', bundle.invoices.length > 1, true);

  // The silent failure this whole file exists for.
  const soa = readIbtekarInvoices(fixture('ibtekar-soa-words.json'), 'soa.pdf');
  check('a statement is refused, not read as empty invoices', soa.invoices, []);
  check('  ...and it says why', soa.problems, ['this is a statement of account, not an invoice']);

  const nothing = readIbtekarInvoices([], 'scan.pdf');
  check('a scan with no text is refused', nothing.invoices, []);
  check('  ...and it says why', nothing.problems.length, 1);
}

/* ── the answer the tracker exists to give ────────────────────────────── */

console.log('\n6. Which tickets we can produce a tax invoice for');
{
  const tickets = [
    tkt({ ticketNo: '065-6906030983', amount: 1500.69, vendorReference: 'INV261733' }),
    tkt({ ticketNo: '065-6906030984', amount: 2000.00, vendorReference: 'INV261733' }),
    tkt({ ticketNo: '065-6906030985', amount: 3000.00, vendorReference: 'INV261733' }),
    tkt({ ticketNo: '593-4861234273', amount: 783.00,  vendorReference: 'INV263097' }),
  ];
  const invoices = [
    inv({ invoiceNo: 'INV261733', serials: ['6906030983', '6906030984'], total: 4025.79 }),
    inv({ invoiceNo: 'INV263097', serials: ['4861234273'], isTaxInvoice: false }),
  ];
  const r = coverageReport(invoices, tickets);

  check('two are on a tax invoice we hold', r.covered.map(c => c.ticket.ticketNo),
        ['065-6906030983', '065-6906030984']);
  check('one is only on something that is not a tax invoice',
        r.notTax.map(c => c.ticket.ticketNo), ['593-4861234273']);
  check('one has nothing behind it', r.uncovered.map(c => c.ticket.ticketNo),
        ['065-6906030985']);

  // The reference on the ledger row is NOT the answer: 6906030985 is filed
  // under INV261733 and that invoice does not print it.
  check('a reference is not a document', r.uncovered[0].ticket.vendorReference, 'INV261733');
  check('  ...and the invoice it names does not list it',
        invoices[0].serials.includes('6906030985'), false);

  check('the money covered', r.coveredValue, 3500.69);
  check('the money with no invoice', r.uncoveredValue, 3000);
  check('which invoice covers a ticket', r.covered[0].invoices, ['INV261733']);
}

console.log('\n7. The invoice side of it');
{
  const tickets = [tkt({ ticketNo: '065-6906030983', amount: 1500.69 })];
  const r = coverageReport(
    [inv({ invoiceNo: 'INV261733', serials: ['6906030983', '9999999999'], total: 2000 })],
    tickets);
  const i = r.invoices[0];
  check('what it bills that we hold', i.inLedger.map(t => t.ticketNo), ['065-6906030983']);
  check('what it bills that we have never seen', i.notInLedger, ['9999999999']);
  check('our figure for it', i.ledgerTotal, 1500.69);
  check('against its own', i.difference, -499.31);
  check('billed and not held, across every invoice', r.billedNotHeld, ['9999999999']);
}

console.log('\n8. What an invoice was never going to name');
{
  const tickets = [
    tkt({ ticketNo: '065-6906030983', amount: 1500.69 }),
    tkt({ ticketNo: '065-6906030983', amount: -1500.69, transactionType: 'REFUND' }),
    tkt({ ticketNo: 'TOPUP-1', amount: 50000, status: 'FUND' }),
  ];
  check('a refund is not asked about', invoiceable(tickets[1]), false);
  check('a wallet top-up is not asked about', invoiceable(tickets[2]), false);
  check('a purchase is', invoiceable(tickets[0]), true);

  const r = coverageReport([], tickets);
  check('so only the purchase is counted', r.tickets.length, 1);
  check('  ...and the top-up is not reported as missing an invoice',
        r.uncovered.map(c => c.ticket.ticketNo), ['065-6906030983']);
}

console.log('\n9. Matching is on the document, not on how it was written');
{
  check('dashes and spaces fall away', serialOf('065-690 6030983'), '6906030983');
  check('a bare serial is itself', serialOf('6906030983'), '6906030983');
  const r = coverageReport(
    [inv({ serials: ['6906030983'] })],
    [tkt({ ticketNo: '0656906030983', amount: 100 })]);
  check('an unpunctuated ledger row still matches', r.covered.length, 1);
}

console.log('\n10. Nothing uploaded is not the same as nothing owed');
{
  const r = coverageReport([], [tkt({ ticketNo: '065-6906030983', amount: 100 })]);
  check('every ticket is uncovered', r.uncovered.length, 1);
  check('no invoice claims anything', r.invoices, []);
  check('and nothing is billed-not-held', r.billedNotHeld, []);
}

console.log('\n11. A net and a VAT that do not make the total are not this invoice\'s');
{
  /* Ibtekar send bundles, and in a bundle one invoice's totals block gets
     picked up by the next one along. INV261827 read back with a subtotal of
     733.62 against a printed total of 12,645.00 — and its own 17 lines come
     to 10,995.64, which grossed at 15% is 12,645.00 exactly. The lines and
     the total agree; the two rows between them came from another document.
     Keeping them would put someone else's VAT in the tracker. */
  const bundle = words([
    ['INVOICE'],
    ['TAX INVOICE'],
    ['Inv.', 'No:', 'INV261827'],
    ['#', 'Name', 'Sector', 'Ticket', 'Amount'],
    ['1', 'ALPHA/ONE', 'JED/RUH', '065-4861506110', '10,995.64'],
    ['Sub', 'Total', '', '', '733.62'],
    ['Total', 'VAT', '', '', '110.04'],
    ['Total', '', '', '', '12,645.00'],
  ]);
  const r = readIbtekarInvoices(bundle, 'bundle.pdf');
  const i = r.invoices[0].invoice;
  check('the total is kept', i.total, 12645);
  check('the borrowed net is dropped', i.subTotal, null);
  check('the borrowed VAT is dropped', i.vat, null);
  check('and it is said out loud',
        r.problems.some(p => p.includes('do not make its total')), true);

  const ok = words([
    ['TAX INVOICE'],
    ['Inv.', 'No:', 'INV261658'],
    ['#', 'Name', 'Sector', 'Ticket', 'Amount'],
    ['1', 'ALPHA/ONE', 'JED/RUH', '065-4861506110', '2,948.65'],
    ['Sub', 'Total', '', '', '2,948.65'],
    ['Total', 'VAT', '', '', '442.30'],
    ['Total', '', '', '', '3,390.95'],
  ]);
  const good = readIbtekarInvoices(ok, 'ok.pdf');
  check('an invoice that foots keeps its net', good.invoices[0].invoice.subTotal, 2948.65);
  check('  ...and its VAT', good.invoices[0].invoice.vat, 442.30);
  check('  ...with nothing said', good.problems, []);
}

console.log('\n12. The same invoice twice: which copy is the document');
{
  /* INV263549 is real. It reads out of a bundle with no totals and no TAX
     INVOICE heading, and again from its own ZATCA file, complete — the same
     two tickets both times. Keeping whichever was read first would make the
     answer depend on the order the folders were typed. */
  const fromBundle: ReadInvoice = {
    layout: 'CLASSIC', theirSerial: '',
    invoice: {
      invoice: 'INV263549', invoiceDate: '2026-08-25', taxInvoice: false,
      subTotal: null, vat: null, total: null,
      lines: [
        { airline: '065', ticketNo: '4861506110', passenger: '', sector: '', carrier: '',
          pnr: '', cabin: '', amount: 1614, travelDate: '', issueDate: '' },
        { airline: '065', ticketNo: '4861588756', passenger: '', sector: '', carrier: '',
          pnr: '', cabin: '', amount: 732, travelDate: '', issueDate: '' },
      ],
    },
  };
  const ownFile: ReadInvoice = {
    layout: 'ZATCA', theirSerial: '1585',
    invoice: {
      invoice: 'INV263549', invoiceDate: '2026-09-20', taxInvoice: true,
      subTotal: 2040, vat: 306, total: 2346,
      lines: fromBundle.invoice.lines.map(l => ({ ...l, amount: null })),
    },
  };

  check('the tax invoice wins, whichever came first',
        preferReading(fromBundle, ownFile).layout, 'ZATCA');
  check('  ...and the other way round too',
        preferReading(ownFile, fromBundle).layout, 'ZATCA');
  check('  ...even though the bundle copy has per-ticket amounts and this one has none',
        ownFile.invoice.lines.every(l => l.amount === null), true);

  // Between two that both call themselves one, the fuller reading wins.
  const thin: ReadInvoice = {
    ...ownFile,
    invoice: { ...ownFile.invoice, total: null, subTotal: null, vat: null },
  };
  check('a reading with a total beats one without',
        preferReading(thin, ownFile).invoice.total, 2346);

  const twoTickets = ownFile;
  const oneTicket: ReadInvoice = {
    ...ownFile, invoice: { ...ownFile.invoice, lines: [ownFile.invoice.lines[0]] },
  };
  check('and the one naming more tickets beats the one naming fewer',
        preferReading(oneTicket, twoTickets).invoice.lines.length, 2);

  // Identical readings: neither is better, so nothing churns.
  check('two identical readings leave the first alone',
        preferReading(ownFile, { ...ownFile }), ownFile);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
