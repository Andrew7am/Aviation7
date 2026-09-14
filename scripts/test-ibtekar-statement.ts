/**
 * Reading an Ibtekar statement of account, and telling it from an invoice.
 *
 * The fixture is the real statement for 01/08-14/09 2026. It matters twice
 * over: it is the document the whole Vendor Statements screen is fed from, and
 * it is the document that was dropped on the invoice checker and came back as
 * eleven empty invoices, because a statement carries invoice NUMBERS in its
 * Document column and an invoice reader will happily find them.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseIbtekarStatementPdf, documentKind } from '../src/core/parsers/ibtekarStatementPdf';
import { parseIbtekarInvoicePdf, PdfWord } from '../src/core/parsers/ibtekarInvoicePdf';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const fixture = (name: string): PdfWord[] =>
  JSON.parse(readFileSync(resolve('scripts/fixtures', name), 'utf8'));

const soa = fixture('ibtekar-soa-words.json');
const invoice = fixture('ibtekar-INV261733-words.json');
const bundle = fixture('ibtekar-aug-bundle-words.json');

console.log('\n1. A statement is not an invoice');
{
  check('the statement knows what it is', documentKind(soa), 'statement');
  check('an invoice knows what it is',    documentKind(invoice), 'invoice');
  check('so does a bundle of them',       documentKind(bundle), 'invoice');
  check('and neither is guessed from nothing',
        documentKind([{ page: 0, x: 1, y: 1, text: 'hello' }]), 'unknown');

  // What went wrong: the invoice reader finds the Document column's numbers.
  const asInvoices = parseIbtekarInvoicePdf(soa);
  check('read as invoices it yields empty ones', asInvoices.length > 1, true);
  check('every one of them with no lines',
        asInvoices.every(i => i.lines.length === 0), true);
}

console.log('\n2. The statement, read');
const st = parseIbtekarStatementPdf(soa)!;
{
  check('period from',   st.periodStart, '2026-08-01');
  check('period to',     st.periodEnd, '2026-09-14');
  check('currency',      st.currency, 'SAR');
  check('opening, Cr as positive', st.openingBalance, 13235.37);
  check('closing',       st.closingBalance, 8266.37);
  check('billed',        st.billed, 24969);
  check('paid',          st.paid, 20000);
  check('it foots',      st.foots, true);
  check('implied closing is the printed one', st.impliedClosing, 8266.37);
}

console.log('\n3. Its movements');
{
  check('every line',    st.lines.length, 22);
  check('21 of them are tickets',
        st.lines.filter(l => l.section === 'TICKET' && l.ticketNo.length === 10).length, 21);
  check('one is a receipt',
        st.lines.filter(l => l.credit > 0).map(l => [l.document, l.credit]),
        [['RV263365', 20000]]);

  const first = st.lines[0];
  check('the first line keeps its own date',     first.date, '2026-08-08');
  check('and its own document',                  first.document, 'INV263097');
  check('and its own airline',                   first.airline, '593');
  check('and its own ticket',                    first.ticketNo, '4861234273');
  check('and its own debit',                     first.debit, 783);
  // Read as flat text this row takes the opening balance instead of its own.
  check('and the balance that followed it, not the one before',
        first.balance, 12452.37);
}

console.log('\n4. The running balance walks down from the opening');
{
  let running = st.openingBalance;
  let drift = 0;
  for (const l of st.lines) {
    running = Math.round((running + l.credit - l.debit) * 100) / 100;
    // The statement prints the magnitude and puts Cr or Dr beside it, so the
    // walk is checked against the magnitude too.
    if (l.balance !== null) drift = Math.max(drift, Math.abs(Math.abs(running) - Math.abs(l.balance)));
  }
  check('every printed balance is where the arithmetic lands', drift < 0.011, true);
  check('and the last one is the closing balance', running, st.closingBalance);
}

console.log('\n5. A document with nothing in it');
{
  check('empty', parseIbtekarStatementPdf([]), null);
  check('not a statement at all',
        parseIbtekarStatementPdf([{ page: 0, x: 1, y: 1, text: 'hello' }]), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
