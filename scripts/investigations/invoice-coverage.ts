/**
 * Invoice by invoice: does the document in the folder list every ticket the
 * ledger files under its number?
 *
 * Both directions, side by side, for each invoice we hold. Refunds are left
 * out of the ledger side - a refund carries the ticket number of the sale it
 * reverses and is credited on its own document, so it was never going to be
 * printed on the invoice.
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { parseIbtekarInvoicePdf, PdfWord } from '../../src/core/parsers/ibtekarInvoicePdf';
import { documentKind } from '../../src/core/parsers/ibtekarStatementPdf';

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
const m2 = (n: number) => Number(n).toFixed(2);

(async () => {
  const DIR = process.argv[2];
  const held = new Map<string, { tax: boolean; tickets: Set<string>; file: string; total: number | null }>();
  const versions: any[] = [];
  const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
    .map(f => ({ ...JSON.parse(readFileSync(join(DIR, f), 'utf8')), name: f }))
    .sort((a, b) => a.mtime - b.mtime);

  for (const f of files) {
    const words: PdfWord[] = f.words;
    if (documentKind(words) === 'statement') continue;
    const parsed = parseIbtekarInvoicePdf(words).filter(i => i.lines.length > 0);
    // An invoice number can appear in two files with different contents -
    // Ibtekar reissues under the same number. Rather than pick one by
    // filename, both are kept: a ticket counts as billed if ANY version lists
    // it, and the disagreement is reported separately rather than hidden.
    for (const inv of parsed) {
      const prev = held.get(inv.invoice);
      const tickets = new Set([...(prev?.tickets ?? []), ...inv.lines.map(l => serial(l.ticketNo))]);
      if (prev && prev.tickets.size !== tickets.size) {
        versions.push({ invoice: inv.invoice, file: prev.file, lines: prev.tickets.size, total: prev.total });
        versions.push({ invoice: inv.invoice, file: f.file, lines: inv.lines.length, total: inv.total });
      }
      held.set(inv.invoice, {
        tax: inv.taxInvoice || !!prev?.tax, file: f.file,
        total: inv.total ?? prev?.total ?? null, tickets,
      });
    }
    if (parsed.length) continue;
    const text = words.map(w => w.text).join(' ');
    if (/Notice\s*NO\s+\d+/.test(text)) continue;
    const no = /Invoice\s*NO\s+(\d{3,6})/.exec(text) ?? /InvoNO:\s*(\d{3,6})/.exec(text);
    if (!no) continue;
    const set = new Set<string>();
    for (const w of words) { const m = /^\d{3}-?(\d{10})$/.exec(w.text); if (m) set.add(m[1]); }
    held.set(no[1], { tax: /Tax\s*Invoice/i.test(text), file: f.file, total: null, tickets: set });
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select ticket_no, amount::float8 amount, coalesce(vendor_reference,'') invoice
       from tickets where source = 'Ibtekar' and amount >= 0`);
  await c.end();

  const mine = new Map<string, any[]>();
  for (const r of rows as any[]) {
    if (!mine.has(r.invoice)) mine.set(r.invoice, []);
    mine.get(r.invoice)!.push(r);
  }

  const out = [...held.entries()].map(([invoice, doc]) => {
    const ours = mine.get(invoice) ?? [];
    const oursSet = new Set(ours.map(r => serial(r.ticket_no)));
    const missingFromInvoice = ours.filter(r => !doc.tickets.has(serial(r.ticket_no)));
    const notInLedger = [...doc.tickets].filter(t => !oursSet.has(t));
    return {
      invoice,
      'tax invoice': doc.tax ? 'yes' : 'NO',
      'lines on it': doc.tickets.size,
      'ours under it': ours.length,
      'ours NOT on it': missingFromInvoice.length,
      'on it, not ours': notInLedger.length,
      'ledger total': m2(ours.reduce((n, r) => n + r.amount, 0)),
      'invoice total': doc.total === null ? '—' : m2(doc.total),
    };
  }).sort((a, b) => a.invoice.localeCompare(b.invoice));

  console.table(out);
  if (versions.length) {
    console.log('\nthe same invoice number in two files, with different contents:');
    console.table(versions);
  }
  const bad = out.filter(o => o['ours NOT on it'] > 0);
  console.log(`invoices in the folder: ${out.length}`);
  console.log(`invoices that leave one of our tickets off: ${bad.length}`);
  if (bad.length) console.table(bad);
})().catch(e => { console.error(e); process.exit(1); });
