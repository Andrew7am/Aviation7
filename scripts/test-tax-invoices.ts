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
  readIbtekarInvoices, preferReading, NO_QR, type ReadInvoice,
} from '../src/core/parsers/ibtekarInvoiceRead';
import {
  coverageReport, invoiceable, serialOf, HeldInvoice,
} from '../src/core/helpers/taxInvoiceCoverage';
import type { Ticket } from '../src/types';
import { decodeZatcaQr, IBTEKAR_VAT } from '../src/core/parsers/zatcaQr';
import { invoiceRequestList } from '../src/core/helpers/taxInvoiceRequest';

/** A ZATCA QR code's text: base64 of tag-length-value fields. */
const qrText = (fields: Record<number, string>) => {
  const parts: number[] = [];
  for (const [tag, value] of Object.entries(fields)) {
    const bytes = [...Buffer.from(value, 'utf8')];
    parts.push(Number(tag), bytes.length, ...bytes);
  }
  return Buffer.from(parts).toString('base64');
};
const ibtekarQr = (total: string, vat: string, vatNo = IBTEKAR_VAT) =>
  qrText({ 1: 'IBTEKAR CO FOR TRAVEL', 2: vatNo, 3: '2026-10-07T00:00:00', 4: total, 5: vat,
           6: 'hash', 7: 'signature', 8: 'key' });

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

console.log('\n4. A document with no QR code is not a final tax invoice, whatever its heading');
{
  const plain = words([
    ['Invoice'],
    ['InvoNO:', '1600'],
    ['1', '065-6906030999', 'X/Y', 'CAI/JED'],
    ['500.00', 'TotalAmountDue'],
  ]);
  const i = parseIbtekarZatcaPdf(plain, 'x.pdf')!;
  check('not headed as a tax invoice', i.taxInvoice, false);
  const r = readIbtekarInvoices(plain, 'x.pdf', []);
  check('and the reader raises it', r.notFinal, ['IBK-1600: ' + NO_QR]);
  check('  ...while still recording it', r.invoices.length, 1);
  check('  ...as not final', r.invoices[0].invoice.taxInvoice, false);

  // Headed TAX INVOICE and still not one: INV264215 and INV264288 were.
  const headed = readIbtekarInvoices(ZATCA, 'INV261733.pdf', []);
  check('a heading alone does not make it final', headed.invoices[0].invoice.taxInvoice, false);
  check('  ...and it is said', headed.notFinal.length, 1);
}

console.log('\n5. One way in, whichever template arrived');
{
  const zat = readIbtekarInvoices(ZATCA, 'INV261733.pdf', [ibtekarQr('47633.00', '6018.38')]);
  check('ZATCA is labelled ZATCA', zat.invoices.map(i => i.layout), ['ZATCA']);
  check('  ...and carries their serial', zat.invoices[0].theirSerial, '1581');
  check('  ...with nothing to complain about', zat.problems, []);
  check('  ...and final, by its QR code', [zat.notFinal, zat.invoices[0].invoice.taxInvoice], [[], true]);

  const classic = readIbtekarInvoices(fixture('ibtekar-INV261733-words.json'), 'INV261733.pdf', []);
  check('the real classic invoice still reads', classic.invoices.length, 1);
  check('  ...as CLASSIC', classic.invoices[0].layout, 'CLASSIC');
  check('  ...49 tickets', classic.invoices[0].invoice.lines.length, 49);
  check('  ...and it keeps its per-ticket amounts',
        classic.invoices[0].invoice.lines[0].amount !== null, true);
  check('  ...headed TAX INVOICE, no QR code: not final', classic.invoices[0].invoice.taxInvoice, false);

  const bundle = readIbtekarInvoices(fixture('ibtekar-aug-bundle-words.json'), 'aug.pdf', []);
  check('a bundle comes back as several invoices', bundle.invoices.length > 1, true);

  // The silent failure this whole file exists for.
  const soa = readIbtekarInvoices(fixture('ibtekar-soa-words.json'), 'soa.pdf', []);
  check('a statement is refused, not read as empty invoices', soa.invoices, []);
  check('  ...and it says why', soa.problems, ['this is a statement of account, not an invoice']);

  const nothing = readIbtekarInvoices([], 'scan.pdf', []);
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
  const r = readIbtekarInvoices(bundle, 'bundle.pdf', []);
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
  const good = readIbtekarInvoices(ok, 'ok.pdf', []);
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

console.log('\n13. The QR code is what makes it final');
{
  // Invoice 1599's own code, as read off the PDF.
  const real = decodeZatcaQr('ARVJQlRFS0FSIENPIEZPUiBUUkFWRUwCDzMxMTY2OTkwMjgwMDAwMwMTMjAyNi0xMC0wN1QwMDowMDowMAQHMzY0MC4xMgUGNDc0LjgwBixzYzZPc2ZINTlNNE9LRGROMG0rT2dReWVHZ2d3N3cwUTdCN3dIZVdjY01nPQdgTUVZQ0lRQzB4aFNTcDhobTV2Z3c1UFpnNHNLQm1ZSHBMT0xoZVFrdjljc2ZTbnRKb2dJaEFLdWNjTG01eUxpRXB4U1lMTzdNQmpqRUVmSzZaMGlDVkx1VkcrRStIdVAzCFswWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASoiLS9shR7Ow2cxdvJu/Iu/49VH5jI7wpmE7MJrUll2hHLF0RtJI+R4oEcFU7jlnXaLOZ9+vNR76QAqDf0Pvaz');
  check('a real code decodes', real && [real.seller, real.vatNo, real.total, real.vat, real.signed],
        ['IBTEKAR CO FOR TRAVEL', IBTEKAR_VAT, 3640.12, 474.8, true]);
  check('a link or junk is not a ZATCA code', [decodeZatcaQr('https://example.com/x'), decodeZatcaQr('hello')], [null, null]);

  const page = words([
    ['Tax', 'Invoice'], ['InvoNO:', '1599'],
    ['1', '065-4862083218', 'ALZAHRANI/RAZAN', 'RUH/JED/ELQ/RUH'],
    ['3,165.32', 'Total(ExculdingVAT)'], ['474.80', 'Total VAT'], ['3,640.12', 'TotalAmountDue'],
  ]);
  const ok = readIbtekarInvoices(page, 'Invoice_1599.pdf', [ibtekarQr('3640.12', '474.80')]);
  check('its QR agrees with the page: final', ok.invoices[0].invoice.taxInvoice, true);
  check('  ...and what the code said is kept', ok.invoices[0].qr?.total, 3640.12);

  const otherSeller = readIbtekarInvoices(page, 'x.pdf', [ibtekarQr('3640.12', '474.80', '300000000000003')]);
  check("a code naming somebody else's VAT number is not Ibtekar's invoice",
        [otherSeller.invoices[0].invoice.taxInvoice, otherSeller.notFinal[0].includes('300000000000003')], [false, true]);

  const wrongTotal = readIbtekarInvoices(page, 'x.pdf', [ibtekarQr('3000.00', '474.80')]);
  check('a code for a different total is not this invoice',
        [wrongTotal.invoices[0].invoice.taxInvoice, wrongTotal.notFinal[0].includes('3000.00')], [false, true]);

  const unread = words([['Tax', 'Invoice'], ['InvoNO:', '1599'], ['1', '065-4862083218', 'X/Y', 'RUH/JED']]);
  const filled = readIbtekarInvoices(unread, 'x.pdf', [ibtekarQr('3640.12', '474.80')]);
  check('a total the page did not give up is taken from the code',
        [filled.invoices[0].invoice.total, filled.invoices[0].invoice.vat, filled.invoices[0].invoice.subTotal],
        [3640.12, 474.8, 3165.32]);
}

console.log('\n14. A ZATCA credit note');
{
  // Notice 15, against invoice 1599: the refund of 4862083218 taken off it.
  const cn = words([
    ['Notice', 'NO', '15'], ['Invoice', 'NO', '1599'], ['Notice', 'Date', '07-10-2026'],
    ['1,603.68', '209.18', '15.00%', '1,394.50', 'PRO-011'],
    ['1,394.50', 'Total(Excluding', 'VAT)'], ['209.18', 'Total', 'VAT', '15.00'],
    ['1,603.68', 'Total', 'Amount', 'Due'],
  ]);
  const r = readIbtekarInvoices(cn, 'Invoice_15 - CREDIT NOTE.pdf', [ibtekarQr('1603.68', '209.18')]);
  const c = r.invoices[0];
  check('read as a credit note', [c.kind, c.invoice.invoice, c.theirSerial, c.against],
        ['CREDIT_NOTE', 'IBK-CN-15', '15', '1599']);
  check('  ...its figures negative', [c.invoice.subTotal, c.invoice.vat, c.invoice.total], [-1394.5, -209.18, -1603.68]);
  check('  ...final, by its QR code', [c.invoice.taxInvoice, r.notFinal], [true, []]);
  check('  ...the date', c.invoice.invoiceDate, '2026-10-07');

  const bare = readIbtekarInvoices(cn, 'x.pdf', []);
  check('a credit note with no code is flagged too', bare.notFinal, ['credit note 15: ' + NO_QR]);
}

console.log('\n15. A printout, its e-invoice, and the credit note between them');
{
  /* Real: INV264215 printed 4862083218 and 4862141169 with no QR code; the
     same two came back on e-invoice 1599 (3,640.12), with credit note 15
     (1,603.68) taking the refund off it — 2,036.44, the printout's total. */
  const tickets = [
    tkt({ ticketNo: '065-4862083218', amount: 1603.58 }),
    tkt({ ticketNo: '065-4862141169', amount: 1561.74 }),
    tkt({ ticketNo: '065-4862141183', amount: 1561.74 }),
  ];
  const r = coverageReport([
    inv({ invoiceNo: 'INV264215', isTaxInvoice: false, serials: ['4862083218', '4862141169'], total: 2036.44 }),
    inv({ invoiceNo: 'IBK-1599', theirSerial: '1599', serials: ['4862083218', '4862141169'], total: 3640.12 }),
    inv({ invoiceNo: 'IBK-CN-15', theirSerial: '15', kind: 'CREDIT_NOTE', against: '1599', total: -1603.68 }),
    inv({ invoiceNo: 'INV264288', isTaxInvoice: false, serials: ['4862141183'], total: 1561.74 }),
  ], tickets);
  const by = (n: string) => r.invoices.find(i => i.invoice.invoiceNo === n)!;
  check('the e-invoice covers both tickets', r.covered.map(c => c.ticket.ticketNo), ['065-4862083218', '065-4862141169']);
  check('the printout points at the final one', by('INV264215').finalFor, ['IBK-1599']);
  check('a printout with no final one yet is owed one', r.awaitingFinal.map(a => a.invoice.invoiceNo), ['INV264288']);
  check('the credit note sits under its invoice', by('IBK-1599').credits.map(c => c.invoiceNo), ['IBK-CN-15']);
  check('  ...and is not held against the ledger', by('IBK-CN-15').difference, null);
}

console.log('\n16. What to ask Ibtekar for');
{
  const tickets = [
    tkt({ ticketNo: '065-4862083218', amount: 1603.58, passengerName: 'ALZAHRANI/RAZAN', reqNum: 'R1' }),
    tkt({ ticketNo: '065-4862141183', amount: 1561.74, passengerName: 'ALNOMAN/HATEM', reqNum: 'R2' }),
    tkt({ ticketNo: '065-4862141185', amount: 1908.90, vendorReference: 'INV264300' }),
    tkt({ ticketNo: '065-4862141186', amount: 500 }),
  ];
  const r = coverageReport([
    inv({ invoiceNo: 'IBK-1599', serials: ['4862083218'], total: 1844.12 }),
    inv({ invoiceNo: 'INV264288', isTaxInvoice: false, serials: ['4862141183', '4862149999'], total: 9052.70,
          invoiceDate: '2026-09-23' }),
  ], tickets);
  const { invoices, tickets: rows } = invoiceRequestList(r);
  check('a ticket on a final invoice is not asked for', rows.some(t => t.ticketNo === '065-4862083218'), false);
  check('a printout is asked for under its own number, with its total',
        invoices.find(i => i.invoiceNo === 'INV264288'), { invoiceNo: 'INV264288', invoiceDate: '2026-09-23', tickets: 2, total: 9052.7, reason: 'NO_QR' });
  check('  ...including what it bills that our books lack',
        rows.filter(t => t.invoiceNo === 'INV264288').map(t => [t.ticketNo, !!t.notInOurBooks]),
        [['065-4862141183', false], ['4862149999', true]]);
  check('a ticket with no document quotes the number their statement gave it',
        rows.find(t => t.ticketNo === '065-4862141185')?.invoiceNo, 'INV264300');
  check('  ...or says it has none', rows.find(t => t.ticketNo === '065-4862141186')?.invoiceNo, '(no invoice number)');
  check('  ...and those are a separate ask', invoices.filter(i => i.reason === 'NONE').map(i => i.invoiceNo),
        ['(no invoice number)', 'INV264300']);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
