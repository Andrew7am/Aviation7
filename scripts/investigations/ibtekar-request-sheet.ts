/**
 * The same findings, written to be sent to Ibtekar rather than read by us.
 *
 * The working sheet says "Invoice No we hold", "In the folder", "nowhere in
 * the folder". Those are true and they are ours: a vendor reading them learns
 * that we keep a folder, not what we are asking for. Worse, the three asks are
 * mixed into one list, and they are not the same ask - one is "send the
 * invoice", one is "send it again as a tax invoice", one is "why did this come
 * off". Each goes on its own sheet, in their language, against their own file
 * numbers.
 *
 * What we already hold goes in too. It costs nothing and it stops the reply
 * being a bundle of everything from May onwards.
 *
 *   npx tsx scripts/investigations/ibtekar-request-sheet.ts <words dir> <out.xlsx>
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { parseIbtekarInvoicePdf, PdfWord } from '../../src/core/parsers/ibtekarInvoicePdf';
import { documentKind } from '../../src/core/parsers/ibtekarStatementPdf';

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);
const m2 = (n: number) => Math.round(n * 100) / 100;

/** The documents we already have, and what each one bills. */
function readFolder(dir: string) {
  const held = new Map<string, { tax: boolean; tickets: Set<string>; date: string; total: number | null }>();
  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    const words: PdfWord[] = f.words;
    if (documentKind(words) === 'statement') continue;
    const parsed = parseIbtekarInvoicePdf(words).filter(i => i.lines.length > 0);
    for (const inv of parsed) {
      const prev = held.get(inv.invoice);
      held.set(inv.invoice, {
        tax: inv.taxInvoice || !!prev?.tax,
        date: inv.invoiceDate || prev?.date || '',
        total: inv.total ?? prev?.total ?? null,
        tickets: new Set([...(prev?.tickets ?? []), ...inv.lines.map(l => serial(l.ticketNo))]),
      });
    }
    if (parsed.length) continue;
    const text = words.map(w => w.text).join(' ');
    if (/Notice\s*NO\s+\d+/.test(text)) continue;
    const no = /Invoice\s*NO\s+(\d{3,6})/.exec(text) ?? /InvoNO:\s*(\d{3,6})/.exec(text);
    if (!no) continue;
    const set = new Set<string>();
    for (const w of words) { const m = /^\d{3}-?(\d{10})$/.exec(w.text); if (m) set.add(m[1]); }
    const d = /(\d{2})-(\d{2})-(20\d{2})/.exec(text);
    held.set(no[1], { tax: /Tax\s*Invoice/i.test(text), tickets: set,
                      date: d ? `${d[3]}-${d[2]}-${d[1]}` : '', total: null });
  }
  return held;
}

(async () => {
  const held = readFolder(process.argv[2]);
  const OUT = process.argv[3] ?? 'Ibtekar - tax invoices required.xlsx';

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select ticket_no, airline_code, date::text date, amount::float8 amount, currency,
            coalesce(vendor_reference,'') invoice, coalesce(req_num,'') req,
            coalesce(pnr,'') pnr, coalesce(passenger_name,'') pax, coalesce(route,'') route
       from tickets where source = 'Ibtekar' and amount >= 0 order by date, ticket_no`);
  await c.end();

  const missing: any[] = [];   // no document of any kind
  const notTax: any[] = [];    // document received, not a tax invoice
  for (const r of rows as any[]) {
    const doc = held.get(r.invoice);
    if (!doc) { missing.push(r); continue; }
    if (!doc.tax) notTax.push(r);
  }

  const group = (rs: any[]) => {
    const m = new Map<string, any[]>();
    for (const r of rs) {
      const k = r.invoice || '(not known)';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].map(([invoice, g]) => {
      const d = g.map(x => x.date).filter(Boolean).sort();
      return {
        'Invoice No': invoice,
        'Invoice date range': `${d[0]} to ${d[d.length - 1]}`,
        'File No (LPO)': [...new Set(g.map(x => x.req).filter(Boolean))].join(', '),
        'Tickets': g.length,
        'Amount charged to our account': m2(g.reduce((n, x) => n + x.amount, 0)),
        'Currency': g[0].currency,
      };
    }).sort((a, b) => a['Invoice date range'].localeCompare(b['Invoice date range']));
  };

  const detail = (rs: any[]) => rs.map(r => ({
    'Invoice No': r.invoice,
    'Ticket No': `${r.airline_code}-${r.ticket_no}`,
    'Issue date': r.date,
    'Passenger': r.pax,
    'Sector': r.route,
    'PNR': r.pnr,
    'File No (LPO)': r.req,
    'Amount': m2(r.amount),
    'Currency': r.currency,
  }));

  const received = [...held.entries()]
    .filter(([, d]) => d.tax)
    .map(([invoice, d]) => ({
      'Invoice No': invoice, 'Invoice date': d.date,
      'Tickets on it': d.tickets.size,
      'Invoice total': d.total === null ? '' : m2(d.total),
      'Status': 'Received — tax invoice in hand, no action needed',
    }))
    .sort((a, b) => String(a['Invoice date']).localeCompare(String(b['Invoice date'])));

  const cover = [
    { Item: 'Account', Detail: 'ALSAFAR ALMUTMIZ LETNEZIM ALMAARED WALMOTEMARAT — Acc Code 127015' },
    { Item: 'Prepared', Detail: new Date().toISOString().slice(0, 10) },
    { Item: '', Detail: '' },
    { Item: 'Request 1',
      Detail: `Tax invoices not yet received — ${group(missing).length} invoice(s), `
            + `${missing.length} ticket(s), ${m2(missing.reduce((n, r) => n + r.amount, 0))} SAR. `
            + `The invoice numbers below are taken from your own statement of account. See sheet "1. Not received".` },
    { Item: 'Request 2',
      Detail: notTax.length
        ? `Document received is not a tax invoice — ${m2(notTax.reduce((n, r) => n + r.amount, 0))} SAR. `
        + `It is headed INVOICE, carries no VAT registration number for either party and has no VAT amount, `
        + `so it cannot support input VAT recovery. Please reissue as a TAX INVOICE. See sheet "2. Not a tax invoice".`
        : 'None.' },
    { Item: 'Request 3',
      Detail: 'Ticket 593-4861438255 (ALY/MOHAMED KHAIRY, CAI/RUH, 214.70 net) appeared on invoice INV263283 '
            + 'in the first version we received (total 2,073.01) and was removed from the reissued version '
            + '(total 1,857.00). Please confirm whether it was cancelled or billed on another invoice.' },
    { Item: '', Detail: '' },
    { Item: 'Already received',
      Detail: `${received.length} tax invoice(s) are in hand and complete — every ticket we have recorded `
            + `against them appears on them. Listed in sheet "3. Already received" so they need not be resent.` },
  ];

  const wb = XLSX.utils.book_new();
  const add = (name: string, data: any[]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
  add('Summary', cover);
  add('1. Not received', group(missing));
  add('1. Not received - tickets', detail(missing));
  if (notTax.length) {
    add('2. Not a tax invoice', group(notTax));
    add('2. Not a tax invoice - tickets', detail(notTax));
  }
  add('3. Already received', received);
  XLSX.writeFile(wb, OUT);

  console.log(`1. tax invoices not received : ${group(missing).length} invoice(s), ${missing.length} ticket(s), ${m2(missing.reduce((n, r) => n + r.amount, 0))} SAR`);
  console.table(group(missing));
  console.log(`2. received but not a tax invoice : ${notTax.length} ticket(s), ${m2(notTax.reduce((n, r) => n + r.amount, 0))} SAR`);
  console.table(group(notTax));
  console.log(`3. already received and complete  : ${received.length} tax invoice(s)`);
  console.log(`\nwritten: ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
