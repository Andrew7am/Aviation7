/**
 * What to say to Ibtekar, sorted into the questions they can actually answer.
 *
 * "Some tickets have no tax invoice" is not one problem, it is three, and they
 * have three different answers:
 *
 *   the invoice was never sent   we know its number - their own statement
 *                                names it - but no PDF ever reached us.
 *   the document is not a tax    it is in the folder, and its header says
 *   invoice                      INVOICE with no VAT lines at all.
 *   the invoice is short         we hold the invoice, and a ticket we
 *                                recorded against it is not printed on it.
 *
 * The third is the one worth checking hardest, because it is the only one
 * where the paperwork looks complete and is not.
 *
 *   npx tsx scripts/investigations/ibtekar-call-sheet.ts <words dir>
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { parseIbtekarInvoicePdf, PdfWord } from '../../src/core/parsers/ibtekarInvoicePdf';
import { documentKind } from '../../src/core/parsers/ibtekarStatementPdf';

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
const money = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const DIR = process.argv[2];

  /** invoice number -> what the folder holds for it */
  const held = new Map<string, { taxInvoice: boolean; tickets: Set<string>; file: string; total: number | null }>();
  const zatca = new Map<string, Set<string>>();

  const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
    .sort((a, b) => a.mtime - b.mtime);

  for (const f of files) {
    const words: PdfWord[] = f.words;
    if (documentKind(words) === 'statement') continue;
    const parsed = parseIbtekarInvoicePdf(words).filter(i => i.lines.length > 0);
    for (const inv of parsed) {
      // A later file wins: Ibtekar reissues an invoice under its own number.
      held.set(inv.invoice, {
        taxInvoice: inv.taxInvoice, file: f.file, total: inv.total,
        tickets: new Set(inv.lines.map(l => serial(l.ticketNo))),
      });
    }
    if (parsed.length) continue;
    const text = words.map(w => w.text).join(' ');
    if (/Notice\s*NO\s+\d+/.test(text)) continue;
    const no = /Invoice\s*NO\s+(\d{3,6})/.exec(text) ?? /InvoNO:\s*(\d{3,6})/.exec(text);
    if (!no) continue;
    const set = new Set<string>();
    for (const w of words) {
      const m = /^(\d{3})-?(\d{10})$/.exec(w.text);
      if (m) set.add(m[2]);
    }
    zatca.set(no[1], set);
    held.set(no[1], { taxInvoice: /Tax\s*Invoice/i.test(text), file: f.file, total: null, tickets: set });
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select ticket_no, airline_code, date::text date, amount::float8 amount,
            coalesce(vendor_reference,'') invoice, coalesce(req_num,'') req,
            coalesce(passenger_name,'') pax
       from tickets where source = 'Ibtekar' and amount >= 0 order by date, ticket_no`);
  await c.end();

  const neverSent = new Map<string, any[]>();   // invoice number known, no PDF
  const notTax = new Map<string, any[]>();      // PDF exists, is not a tax invoice
  const short = new Map<string, any[]>();       // PDF exists, ticket not on it
  const fine: any[] = [];

  for (const r of rows as any[]) {
    const doc = held.get(r.invoice);
    if (!r.invoice) { (neverSent.get('(no number)') ?? neverSent.set('(no number)', []).get('(no number)')!).push(r); continue; }
    if (!doc) {
      if (!neverSent.has(r.invoice)) neverSent.set(r.invoice, []);
      neverSent.get(r.invoice)!.push(r);
      continue;
    }
    if (!doc.tickets.has(serial(r.ticket_no))) {
      if (!short.has(r.invoice)) short.set(r.invoice, []);
      short.get(r.invoice)!.push(r);
      continue;
    }
    if (!doc.taxInvoice) {
      if (!notTax.has(r.invoice)) notTax.set(r.invoice, []);
      notTax.get(r.invoice)!.push(r);
      continue;
    }
    fine.push(r);
  }

  const total = (a: any[]) => money(a.reduce((n, r) => n + r.amount, 0));
  const flat = (m: Map<string, any[]>) => [...m.values()].flat();

  console.log('='.repeat(78));
  console.log('IBTEKAR — what to ask for, by what kind of problem it is');
  console.log('='.repeat(78));
  console.log(`\nsales in the ledger: ${rows.length}`);
  console.log(`  the tax invoice is in hand and lists the ticket : ${fine.length}  ${total(fine)}`);
  console.log(`  1. the invoice was never sent                   : ${flat(neverSent).length}  ${total(flat(neverSent))}`);
  console.log(`  2. the document is not a tax invoice            : ${flat(notTax).length}  ${total(flat(notTax))}`);
  console.log(`  3. we hold the invoice, the ticket is not on it : ${flat(short).length}  ${total(flat(short))}`);

  const table = (title: string, m: Map<string, any[]>, extra?: (k: string) => string) => {
    if (!m.size) return;
    console.log(`\n${title}`);
    console.table([...m.entries()].map(([invoice, rs]) => {
      const d = rs.map(r => r.date).filter(Boolean).sort();
      return {
        invoice, from: d[0] ?? '', to: d[d.length - 1] ?? '',
        tickets: rs.length, amount: total(rs),
        note: extra ? extra(invoice) : '',
      };
    }).sort((a, b) => String(a.from).localeCompare(String(b.from))));
  };

  table('1. NEVER SENT — we know the number from their own statement, no invoice ever arrived',
        neverSent);
  table('2. NOT A TAX INVOICE — the document is in the folder and carries no VAT at all',
        notTax, k => `${held.get(k)?.file ?? ''}`);
  table('3. THE INVOICE IS SHORT — we hold it and the ticket is not printed on it',
        short, k => `${held.get(k)?.file ?? ''}`);

  if (short.size) {
    console.log('\n   the tickets in question:');
    console.table(flat(short).map((r: any) => ({
      invoice: r.invoice, ticket: `${r.airline_code}-${r.ticket_no}`,
      date: r.date, amount: money(r.amount), passenger: r.pax.slice(0, 26), req: r.req,
    })));
  }

  // The other direction: an invoice in hand billing a ticket we never recorded.
  const ledger = new Set((rows as any[]).map(r => serial(r.ticket_no)));
  const theirsOnly: any[] = [];
  for (const [invoice, doc] of held) {
    for (const t of doc.tickets) if (!ledger.has(t)) theirsOnly.push({ invoice, ticket: t, file: doc.file });
  }
  console.log(`\n4. ON THEIR INVOICE, NOT IN OUR LEDGER: ${theirsOnly.length}`);
  if (theirsOnly.length) console.table(theirsOnly);
})().catch(e => { console.error(e); process.exit(1); });
