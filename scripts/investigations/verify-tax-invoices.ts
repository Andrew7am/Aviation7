/**
 * Which tickets are on a tax invoice Ibtekar actually sent — line by line.
 *
 * Carrying an invoice number is not the same as appearing on an invoice. The
 * numbers in the ledger came from three of Ibtekar's documents, and only one
 * of the three is a tax invoice: the statement of account names the invoice a
 * ticket was billed on without being that invoice, and so do the statement
 * rows imported last July. A ticket can therefore read "INV261733" in the
 * Vendor Ref column while nothing in the folder lists it.
 *
 * So this starts from the ledger and asks, of each ticket, whether its number
 * is printed on a line of a document in the folder that calls itself a TAX
 * INVOICE. The reading is the app's own — the same parser the upload panel
 * uses — so what this reports and what the screen shows cannot drift apart.
 *
 * Two shapes of tax invoice are in the folder and both are read: Ibtekar's
 * TCPDF one, numbered INV261733, and their ZATCA e-invoice, numbered 1559.
 * A credit note is not an invoice and is excluded.
 *
 *   npx tsx scripts/investigations/verify-tax-invoices.ts <words dir> <out.xlsx>
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import {
  parseIbtekarInvoicePdf, PdfWord, ParsedInvoice,
} from '../../src/core/parsers/ibtekarInvoicePdf';
import { documentKind } from '../../src/core/parsers/ibtekarStatementPdf';

const DIR = process.argv[2];
const OUT = process.argv[3] ?? 'Ibtekar - tickets with no tax invoice.xlsx';

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
const money = (n: number) => Math.round(n * 100) / 100;

interface Billed {
  invoice: string;
  file: string;
  kind: 'tcpdf' | 'zatca';
  taxInvoice: boolean;
  date: string;
  amount: number | null;
}

/**
 * The ZATCA e-invoice, for its ticket numbers only.
 *
 * It is a different layout with its own numbering — "Invoice NO 1559" — and no
 * ticket blocks to read, so the TCPDF parser finds nothing in it. What is
 * needed here is only which tickets it lists and whether it says Tax Invoice.
 */
function readZatca(words: PdfWord[], file: string): Billed[] {
  const text = words.map(w => w.text).join(' ');
  if (/Notice\s*NO\s+\d+/.test(text)) return [];        // a credit note
  const no = /Invoice\s*NO\s+(\d{3,6})/.exec(text) ?? /InvoNO:\s*(\d{3,6})/.exec(text);
  if (!no) return [];
  const taxInvoice = /Tax\s*Invoice/i.test(text);
  const d = /(\d{2})-(\d{2})-(20\d{2})/.exec(text);
  const out: Billed[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const m = /^(\d{3})-?(\d{10})$/.exec(w.text);
    if (!m || seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({
      invoice: no[1], file, kind: 'zatca', taxInvoice,
      date: d ? `${d[3]}-${d[2]}-${d[1]}` : '', amount: null,
    });
  }
  return out.map((b, i) => ({ ...b, ticket: [...seen][i] })) as any;
}

(async () => {
  // ticket serial -> every invoice line that bills it
  const billed = new Map<string, Billed[]>();
  const invoices: { inv: ParsedInvoice; file: string }[] = [];
  const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
    .sort((a, b) => a.mtime - b.mtime);

  for (const f of files) {
    const words: PdfWord[] = f.words;
    const kind = documentKind(words);
    if (kind === 'statement') { console.log(`skipped (statement of account): ${f.file}`); continue; }

    const parsed = parseIbtekarInvoicePdf(words).filter(i => i.lines.length > 0);
    if (parsed.length) {
      for (const inv of parsed) {
        invoices.push({ inv, file: f.file });
        for (const l of inv.lines) {
          const k = serial(l.ticketNo);
          if (!billed.has(k)) billed.set(k, []);
          billed.get(k)!.push({
            invoice: inv.invoice, file: f.file, kind: 'tcpdf',
            taxInvoice: inv.taxInvoice, date: inv.invoiceDate, amount: l.amount,
          });
        }
      }
      continue;
    }

    const z = readZatca(words, f.file) as (Billed & { ticket: string })[];
    if (!z.length) { console.log(`skipped (no invoice lines): ${f.file}`); continue; }
    for (const b of z) {
      const k = serial(b.ticket);
      if (!billed.has(k)) billed.set(k, []);
      billed.get(k)!.push(b);
    }
  }

  console.log(`\ntax invoices read: ${invoices.filter(i => i.inv.taxInvoice).length}` +
              ` of ${invoices.length} TCPDF invoice(s), plus the ZATCA ones`);
  console.table(invoices.map(({ inv, file }) => ({
    invoice: inv.invoice, date: inv.invoiceDate,
    'tax invoice': inv.taxInvoice ? 'yes' : 'NO',
    lines: inv.lines.length, total: inv.total, file: file.slice(0, 30),
  })));

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select ticket_no, airline_code, date::text date, amount::float8 amount, currency,
            coalesce(vendor_reference,'') invoice, coalesce(req_num,'') req,
            coalesce(pnr,'') pnr, coalesce(passenger_name,'') pax,
            coalesce(route,'') route, status
       from tickets where source = 'Ibtekar' order by date, ticket_no`);
  await c.end();

  const onTax: any[] = [];
  const onPlain: any[] = [];
  const nowhere: any[] = [];
  const mismatch: any[] = [];
  // A refund is not billed on an invoice at all - Ibtekar credits it on a
  // separate document, and it carries the ticket number of the sale it
  // reverses. Counting it as "on a tax invoice" because that number appears
  // there would be the same mistake in reverse.
  const refunds: any[] = [];

  for (const r of rows as any[]) {
    if (r.amount < 0) { refunds.push(r); continue; }
    const lines = billed.get(serial(r.ticket_no)) ?? [];
    const tax = lines.filter(l => l.taxInvoice);
    if (!lines.length) { nowhere.push(r); continue; }
    if (!tax.length) { onPlain.push({ ...r, seenOn: lines.map(l => l.invoice).join(', ') }); continue; }
    onTax.push(r);
    // The ledger's number against the invoice that actually lists it.
    if (r.invoice && !tax.some(l => l.invoice === r.invoice)) {
      mismatch.push({ ...r, actually: tax.map(l => l.invoice).join(', ') });
    }
  }

  const sum = (a: any[]) => money(a.reduce((n, r) => n + r.amount, 0));
  console.log(`\nIbtekar rows in the ledger                           : ${rows.length}`);
  console.log(`  sales                                             : ${rows.length - refunds.length}`);
  console.log(`  refunds, which are credited not invoiced          : ${refunds.length}  ${sum(refunds)}`);
  console.log(`\nof the sales:`);
  console.log(`  printed on a TAX INVOICE in the folder            : ${onTax.length}  ${sum(onTax)}`);
  console.log(`  on a document in the folder that is NOT a tax invoice: ${onPlain.length}  ${sum(onPlain)}`);
  console.log(`  on nothing in the folder at all                   : ${nowhere.length}  ${sum(nowhere)}`);
  console.log(`\nof those on a tax invoice, the ledger's number disagrees with it: ${mismatch.length}`);
  if (mismatch.length) console.table(mismatch.map(r => ({
    ticket: r.ticket_no, ledger: r.invoice, 'actually on': r.actually,
    date: r.date, amount: money(r.amount) })));

  // Grouped the way it has to be asked for: by the invoice number we hold.
  const byInvoice = new Map<string, any[]>();
  for (const r of [...nowhere, ...onPlain]) {
    const k = r.invoice || '(no invoice number)';
    if (!byInvoice.has(k)) byInvoice.set(k, []);
    byInvoice.get(k)!.push(r);
  }
  const summary = [...byInvoice.entries()].map(([invoice, rs]) => {
    const dates = rs.map(r => r.date).filter(Boolean).sort();
    return {
      'Invoice No we hold': invoice,
      'In the folder': onPlain.some(r => (r.invoice || '(no invoice number)') === invoice)
        ? 'yes, but not as a tax invoice' : 'no',
      From: dates[0] ?? '', To: dates[dates.length - 1] ?? '',
      Tickets: rs.length, Amount: money(rs.reduce((n, r) => n + r.amount, 0)),
      Currency: rs[0].currency,
      'Request No': [...new Set(rs.map(r => r.req).filter(Boolean))].join(', '),
    };
  }).sort((a, b) => String(a.From).localeCompare(String(b.From)));

  console.log('\nwhat to ask Ibtekar for:');
  console.table(summary);
  console.log(`total: ${money([...nowhere, ...onPlain].reduce((n, r) => n + r.amount, 0))} SAR` +
              ` over ${nowhere.length + onPlain.length} ticket(s)`);

  const lines = [...nowhere, ...onPlain].map(r => ({
    'Invoice No we hold': r.invoice || '',
    'Ticket No': `${r.airline_code}-${r.ticket_no}`,
    Date: r.date, Passenger: r.pax, Route: r.route, PNR: r.pnr,
    'Request No': r.req, Status: r.status,
    Amount: money(r.amount), Currency: r.currency,
    'Where it was found': r.seenOn ? `on ${r.seenOn}, which is not a tax invoice` : 'nowhere in the folder',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Ask Ibtekar for');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), 'Tickets');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(refunds.map((r: any) => ({
    'Ticket No': `${r.airline_code}-${r.ticket_no}`, Date: r.date, Passenger: r.pax,
    'Request No': r.req, Amount: money(r.amount), Currency: r.currency,
    Note: 'A refund is credited on its own document, not billed on an invoice.',
  }))), 'Refunds');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    invoices.map(({ inv, file }) => ({
      Invoice: inv.invoice, Date: inv.invoiceDate,
      'Tax invoice': inv.taxInvoice ? 'yes' : 'no',
      Lines: inv.lines.length, Net: inv.subTotal, VAT: inv.vat, Total: inv.total, File: file,
    }))), 'Invoices in the folder');
  if (mismatch.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mismatch.map(r => ({
      'Ticket No': `${r.airline_code}-${r.ticket_no}`, 'Ledger says': r.invoice,
      'Invoice it is actually on': r.actually, Date: r.date, Amount: money(r.amount),
    }))), 'Number disagrees');
  }
  XLSX.writeFile(wb, OUT);
  console.log(`\nwritten: ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
