/**
 * The Excel to send Ibtekar: the invoices to ask for, and every ticket under them.
 *
 * Same rows as the Tax Invoices screen's export, from the invoices on file
 * plus any invoice PDF in the folders that has not been uploaded yet — a
 * printout whose e-invoice is already sitting on the drive is not asked for
 * again. Those files are listed so they can be uploaded.
 *
 *   npx tsx scripts/investigations/ibtekar-invoices-to-request.ts <out.xlsx>
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { readPdf } from '../../src/core/helpers/pdfRead';
import { readIbtekarInvoices } from '../../src/core/parsers/ibtekarInvoiceRead';
import { coverageReport, type HeldInvoice } from '../../src/core/helpers/taxInvoiceCoverage';
import { invoiceRequestSheets, invoiceRequestList } from '../../src/core/helpers/taxInvoiceRequest';
import type { Ticket } from '../../src/types';

const DIRS = [
  'G:/Shared drives/Luxury Explorers Business Services/Accounting Department/New folder/IBTEKAR/TAX invoices',
  'G:/Shared drives/Luxury Explorers Business Services/Accounting Department/New folder/Aviation/ibtekar',
  'C:/Users/LE.Andrew/Desktop/New folder (3)',
];

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('give the output .xlsx path');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const stored = (await db.query(`
    select t.*, coalesce(array_agg(l.ticket_serial) filter (where l.ticket_serial is not null), '{}') serials
      from tax_invoices t left join tax_invoice_lines l on l.invoice_id = t.id
     where t.vendor = 'Ibtekar' group by t.id`)).rows;
  const held: HeldInvoice[] = stored.map(r => ({
    invoiceNo: r.invoice_no, invoiceDate: r.invoice_date ? new Date(r.invoice_date.getTime() + 3 * 3600e3).toISOString().slice(0, 10) : '',
    isTaxInvoice: r.is_tax_invoice, net: r.net == null ? null : Number(r.net), vat: r.vat == null ? null : Number(r.vat),
    total: r.total == null ? null : Number(r.total), serials: r.serials, theirSerial: r.their_serial ?? undefined,
    kind: r.kind, against: r.against ?? undefined,
  }));
  const have = new Set(held.map(h => h.invoiceNo));

  // On the drive, not uploaded.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const notUploaded: string[] = [];
  const seenFiles = new Set<string>();
  for (const d of DIRS) if (existsSync(d)) for (const f of readdirSync(d)) {
    if (!/\.pdf$/i.test(f) || seenFiles.has(f) || /soabulk|statement|soa/i.test(f)) continue;
    seenFiles.add(f);
    const c = await readPdf(pdfjs, readFileSync(join(d, f)));
    const r = readIbtekarInvoices(c.words, f, c.qrCodes);
    for (const i of r.invoices) {
      if (have.has(i.invoice.invoice)) continue;
      have.add(i.invoice.invoice);
      notUploaded.push(`${i.invoice.invoice}${i.invoice.taxInvoice ? ' (final, QR)' : ' (no QR)'} — ${f}`);
      held.push({
        invoiceNo: i.invoice.invoice, invoiceDate: i.invoice.invoiceDate, isTaxInvoice: i.invoice.taxInvoice,
        net: i.invoice.subTotal, vat: i.invoice.vat, total: i.invoice.total,
        serials: i.invoice.lines.map(l => l.ticketNo), theirSerial: i.theirSerial, kind: i.kind, against: i.against,
      });
    }
  }

  const tickets = (await db.query(`
    select id, ticket_no "ticketNo", pnr, passenger_name "passengerName", route, date::text, amount::float,
           currency, req_num "reqNum", vendor_reference "vendorReference", status, transaction_type "transactionType"
      from tickets where source = 'Ibtekar'`)).rows as Ticket[];
  await db.end();

  const report = coverageReport(held, tickets);
  const { invoices, tickets: rows } = invoiceRequestSheets(report);
  const wb = XLSX.utils.book_new();
  const inv = XLSX.utils.json_to_sheet(invoices);
  inv['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 13 }, { wch: 62 }];
  const tk = XLSX.utils.json_to_sheet(rows);
  tk['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 28 }, { wch: 9 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 12 }, { wch: 62 }];
  XLSX.utils.book_append_sheet(wb, inv, 'Invoices to request');
  XLSX.utils.book_append_sheet(wb, tk, 'Tickets');
  XLSX.writeFile(wb, out);

  const list = invoiceRequestList(report);
  const sum = (r: 'NO_QR' | 'NONE') => list.tickets.filter(t => t.reason === r);
  console.log('written:', out);
  console.log('invoices to request:', list.invoices.length,
    '| printouts (no QR):', list.invoices.filter(i => i.reason === 'NO_QR').length,
    '| no invoice at all:', list.invoices.filter(i => i.reason === 'NONE').length);
  for (const r of ['NO_QR', 'NONE'] as const)
    console.log(` ${r}: ${sum(r).length} tickets, ${sum(r).reduce((n, t) => n + (t.amount ?? 0), 0).toFixed(2)}`);
  console.table(list.invoices.map(i => ({ invoice: i.invoiceNo, date: i.invoiceDate, tickets: i.tickets, total: i.total, why: i.reason })));
  console.log('statuses of tickets asked for:',
    Object.entries(list.tickets.reduce((m, t) => {
      const s = tickets.find(x => x.ticketNo === t.ticketNo)?.status ?? '(not in books)'; m[s] = (m[s] ?? 0) + 1; return m;
    }, {} as Record<string, number>)));
  if (notUploaded.length) console.log('on the drive, not uploaded yet:', notUploaded);
})();
