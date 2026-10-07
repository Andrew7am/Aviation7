/**
 * Re-decide every tax invoice on file by its QR code.
 *
 * Until 2026-10-07 a document counted as a tax invoice when it was headed
 * TAX INVOICE. Ibtekar's booking-system printouts are headed that way and are
 * not final tax invoices — no ZATCA QR code (INV264215, INV264288). This reads
 * each stored invoice's source file again and sets is_tax_invoice to what the
 * QR code says, keeping what the code said in `qr`.
 *
 * A row whose file cannot be found is left exactly as it is and listed.
 *
 *   npx tsx scripts/investigations/tax-invoice-qr-recheck.ts           # dry run
 *   npx tsx scripts/investigations/tax-invoice-qr-recheck.ts --apply   # writes, after a snapshot
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { readPdf } from '../../src/core/helpers/pdfRead';
import { readIbtekarInvoices } from '../../src/core/parsers/ibtekarInvoiceRead';

const DIRS = [
  'G:/Shared drives/Luxury Explorers Business Services/Accounting Department/New folder/IBTEKAR/TAX invoices',
  'G:/Shared drives/Luxury Explorers Business Services/Accounting Department/New folder/Aviation/ibtekar',
  'C:/Users/LE.Andrew/Desktop/New folder (3)',
];

const apply = process.argv.includes('--apply');

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const where = new Map<string, string>();
  for (const d of DIRS) if (existsSync(d))
    for (const f of readdirSync(d)) if (/\.pdf$/i.test(f) && !where.has(f)) where.set(f, join(d, f));

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `select id, invoice_no, layout, is_tax_invoice, total, vat, net, source_file, qr from tax_invoices order by invoice_no`);

  const readings = new Map<string, ReturnType<typeof readIbtekarInvoices>>();
  const plan: { id: string; invoice_no: string; was: boolean; now: boolean; qr: unknown; why: string }[] = [];
  const missing: string[] = [];

  for (const r of rows) {
    const path = r.source_file ? where.get(r.source_file) : undefined;
    if (!path) { missing.push(`${r.invoice_no} (${r.source_file ?? 'no file'})`); continue; }
    if (!readings.has(path)) {
      const c = await readPdf(pdfjs, readFileSync(path));
      readings.set(path, readIbtekarInvoices(c.words, r.source_file, c.qrCodes));
    }
    const read = readings.get(path)!;
    const mine = read.invoices.find(i => i.invoice.invoice === r.invoice_no);
    if (!mine) { missing.push(`${r.invoice_no} (not found again in ${r.source_file})`); continue; }
    const why = read.notFinal.find(n => n.startsWith(r.invoice_no)) ?? 'QR checked';
    plan.push({ id: r.id, invoice_no: r.invoice_no, was: r.is_tax_invoice, now: mine.invoice.taxInvoice,
                qr: mine.qr ?? null, why });
  }

  console.table(plan.map(p => ({ invoice: p.invoice_no, was: p.was, now: p.now, why: p.why })));
  console.log(`changes: ${plan.filter(p => p.was !== p.now).length}, unchanged: ${plan.filter(p => p.was === p.now).length}`);
  if (missing.length) console.log('left as they are (file not found):', missing);

  if (!apply) { console.log('\ndry run — nothing written. --apply to write.'); await db.end(); return; }

  mkdirSync('scratch', { recursive: true });
  const snap = `scratch/tax-invoices-before-qr-${Date.now()}.json`;
  writeFileSync(snap, JSON.stringify(rows, null, 2));
  console.log('snapshot:', snap);

  await db.query('begin');
  for (const p of plan)
    await db.query('update tax_invoices set is_tax_invoice = $2, qr = $3 where id = $1',
      [p.id, p.now, p.qr ? JSON.stringify(p.qr) : null]);
  await db.query('commit');
  console.log(`written: ${plan.length} row(s)`);
  await db.end();
})();
