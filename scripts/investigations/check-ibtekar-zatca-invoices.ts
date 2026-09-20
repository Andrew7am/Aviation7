/**
 * Ibtekar's new ZATCA tax invoices, checked against the ledger.
 *
 * These are not the documents the existing parser reads. Ibtekar have moved
 * to the ZATCA bilingual template, and three things changed that matter:
 *
 *   1. There are no per-ticket amounts. The tickets are listed - serial,
 *      date, passenger, sector - and the money appears once, aggregated into
 *      a single PRO-011 line. So a line-by-line check is not available on
 *      these at all; the only comparison possible is the total.
 *   2. The INV###### reference we file under appears nowhere in the PDF. It
 *      is only in the file name. The document's own number is a short serial
 *      (1581-1590), which is a different numbering from the one our ledger
 *      uses, so the two have to be tied together by the file name.
 *   3. Every figure is printed BEFORE its label rather than after it, so a
 *      total is found by locating the label and stepping backwards.
 *
 *   npx tsx scripts/investigations/check-ibtekar-zatca-invoices.ts [folder]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const m = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (s: string) => Number(s.replace(/,/g, ''));

interface Invoice {
  file: string;
  /** Our reference, off the file name - it is not inside the document. */
  ref: string;
  /** Ibtekar's own short serial, printed on the page. */
  serial: string;
  date: string;
  taxInvoice: boolean;
  tickets: { airline: string; no: string; date: string }[];
  net: number | null;
  vat: number | null;
  due: number | null;
  paid: number | null;
  remaining: number | null;
}

/** The money printed immediately before `label`. */
function before(text: string, label: string): number | null {
  const at = text.indexOf(label);
  if (at < 0) return null;
  const hits = [...text.slice(0, at).matchAll(/([\d,]+\.\d\d)\s*$/gm)];
  const last = text.slice(0, at).trimEnd().split('\n').pop() ?? '';
  return /^[\d,]+\.\d\d$/.test(last.trim()) ? money(last.trim())
    : hits.length ? money(hits[hits.length - 1][1]) : null;
}

async function read(path: string, file: string): Promise<Invoice> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    text += (content.items as any[]).map(i => i.str).join('\n') + '\n';
  }

  // The date is optional. Ibtekar's earlier ZATCA invoices list a ticket as
  // number, passenger, sector with no date column at all; the later ones put
  // a date after the number. Requiring one read every older invoice as empty
  // - which is how invoice 1559 came to be reported as missing when it had
  // been on the shared drive the whole time.
  const tickets = [...text.matchAll(/(\d{3})-(\d{10})(?:\s+(\d{4}-\d{2}-\d{2}))?/g)]
    .map(x => ({ airline: x[1], no: x[2], date: x[3] ?? '' }));

  return {
    file,
    // Our filing reference. Usually the INV number in the file name; on the
    // older invoices there is none, and the ledger files those under
    // Ibtekar's own short serial instead.
    ref: (file.match(/INV\d{6}/i)?.[0]
          ?? file.match(/Invoice[_ ]?(\d{3,5})/i)?.[1] ?? '').toUpperCase(),
    serial: text.match(/InvoNO:\s*(\d+)/)?.[1] ?? '',
    date: text.match(/(\d{2}-\d{2}-20\d{2})/)?.[1] ?? '',
    // The one assurance the whole exercise depends on: a document that does
    // not call itself a tax invoice cannot be used to reclaim the VAT on it.
    taxInvoice: /Tax\s*Invoice/i.test(text),
    tickets,
    net: before(text, 'Total(ExculdingVAT)'),
    vat: before(text, 'Total VAT'),
    due: before(text, 'TotalAmountDue'),
    paid: before(text, 'Total Amount Paid'),
    remaining: before(text, 'Total Remaining Amount'),
  };
}

(async () => {
  const dir = process.argv[2] ?? 'C:/Users/LE.Andrew/Desktop/New folder (3)';
  const files = readdirSync(dir).filter(f => /\.pdf$/i.test(f)).sort();

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const ledger = (await c.query(
    `select ticket_no, date, amount::float8 amount, status,
            coalesce(vendor_reference,'') vref, coalesce(passenger_name,'') pax
       from tickets where source = 'Ibtekar'`)).rows;

  const ser = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
  const byNo = new Map<string, any[]>();
  for (const t of ledger) {
    const k = ser(t.ticket_no);
    if (!byNo.has(k)) byNo.set(k, []);
    byNo.get(k)!.push(t);
  }

  console.log('='.repeat(102));
  console.log(`${files.length} INVOICES FROM IBTEKAR, AGAINST ${ledger.length} LEDGER ROWS`);
  console.log('='.repeat(102));

  const problems: string[] = [];
  const covered = new Set<string>();
  let billed = 0, held = 0, ticketCount = 0;

  for (const f of files) {
    const inv = await read(join(dir, f), f);
    ticketCount += inv.tickets.length;
    billed += inv.due ?? 0;
    for (const t of inv.tickets) covered.add(t.no);

    // Our rows filed under this reference, issues only.
    const ours = ledger.filter(t => t.vref.trim().toUpperCase() === inv.ref && t.amount >= 0);
    const ourTotal = r2(ours.reduce((n, t) => n + t.amount, 0));
    held += ourTotal;
    const diff = r2(ourTotal - (inv.due ?? 0));
    const agrees = Math.abs(diff) < 0.02;

    console.log(`\n${inv.ref}  (their no. ${inv.serial}, ${inv.date})`
      + `  ${inv.tickets.length} ticket(s)${inv.taxInvoice ? '' : '   [NOT A TAX INVOICE]'}`);
    console.log(`   net ${m(inv.net)}  + VAT ${m(inv.vat)}  = due ${m(inv.due)}`
      + `      our ledger ${m(ourTotal)}   ${agrees ? 'AGREES' : `OFF BY ${m(diff)}`}`);

    if (!inv.taxInvoice) problems.push(`${inv.ref}: not headed as a tax invoice`);
    if (!inv.ref) problems.push(`${f}: no INV reference in the file name`);
    if (inv.net != null && inv.vat != null && inv.due != null
        && Math.abs(r2(inv.net + inv.vat) - inv.due) >= 0.02)
      problems.push(`${inv.ref}: net + VAT does not make the amount due`);
    if (!agrees) problems.push(`${inv.ref}: off by ${m(diff)} against our ledger`);

    // Tickets it bills that we do not hold, or hold under something else.
    for (const t of inv.tickets) {
      const rows = (byNo.get(t.no) ?? []).filter(r => r.amount >= 0);
      if (!rows.length) {
        console.log(`      NOT IN OUR LEDGER   ${t.airline}-${t.no}  ${t.date}`);
        problems.push(`${inv.ref}: ${t.no} is billed but we do not hold it`);
      } else if (!rows.some(r => r.vref.trim().toUpperCase() === inv.ref)) {
        console.log(`      WE FILE IT ELSEWHERE ${t.airline}-${t.no}`
          + `  ours says "${rows[0].vref || '(none)'}"`);
        problems.push(`${inv.ref}: ${t.no} is filed under "${rows[0].vref || '(none)'}"`);
      }
    }
    // Rows we file here that the invoice never lists.
    for (const t of ours) {
      if (!inv.tickets.some(x => x.no === ser(t.ticket_no))) {
        console.log(`      OURS, NOT ON IT      ${t.ticket_no}  ${m(t.amount)}  ${t.pax}`);
        problems.push(`${inv.ref}: our row ${t.ticket_no} is not on the invoice`);
      }
    }
  }

  console.log('\n' + '='.repeat(102));
  console.log('THE BATCH');
  console.log('='.repeat(102));
  console.log(`   tickets billed       ${String(ticketCount).padStart(6)}`);
  console.log(`   they bill            ${m(r2(billed)).padStart(14)}`);
  console.log(`   our ledger holds     ${m(r2(held)).padStart(14)}`);
  console.log(`   difference           ${m(r2(held - billed)).padStart(14)}`);

  const bare = ledger.filter(t =>
    t.amount >= 0
    && !/^INV\d+/i.test(t.vref.trim())
    && !covered.has(ser(t.ticket_no)));
  console.log('\n' + '='.repeat(102));
  console.log('IBTEKAR TICKETS STILL WITH NO TAX INVOICE');
  console.log('='.repeat(102));
  console.log(`   ${bare.length} ticket(s), ${m(r2(bare.reduce((n, t) => n + t.amount, 0)))} SAR`);
  for (const t of bare)
    console.log(`      ${t.date}  ${t.ticket_no}  ${m(t.amount).padStart(10)}`
      + `  ref "${t.vref}"  ${t.pax}`);

  console.log('\n' + '='.repeat(102));
  console.log(problems.length ? `TO RAISE WITH IBTEKAR: ${problems.length}` : 'NOTHING TO RAISE');
  console.log('='.repeat(102));
  for (const p of problems) console.log(`   ${p}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
