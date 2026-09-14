/**
 * The invoices Ibtekar has billed us for but never sent a tax invoice for.
 *
 * Every Ibtekar ticket in the ledger now carries the invoice number that bills
 * it, taken from one of three of their documents. For most of them we hold the
 * tax invoice itself as a PDF; for the rest we know only the number, because
 * it reached us on a statement of account rather than on an invoice.
 *
 * Those are what this lists: the document number to ask for, the dates it
 * covers, how many tickets and how much. Two sheets - one row per invoice to
 * send them, one row per ticket to check what comes back against.
 *
 *   npx tsx scripts/investigations/missing-tax-invoices.ts <invoices.json> <out.xlsx>
 *
 * <invoices.json> is the output of scripts/investigations/parse_invoices.py -
 * the tax invoices we actually hold.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { Client } from 'pg';
import * as XLSX from 'xlsx';

const HELD = process.argv[2];
const OUT = process.argv[3] ?? 'ibtekar-missing-tax-invoices.xlsx';

const money = (n: number) => Math.round(n * 100) / 100;

(async () => {
  const held: { invoice: string; creditNote: boolean }[] = JSON.parse(readFileSync(HELD, 'utf8'));
  const have = new Set(held.filter(d => !d.creditNote).map(d => d.invoice));

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select ticket_no, airline_code, date::text date, amount::float8 amount,
            currency, coalesce(vendor_reference,'') invoice, coalesce(req_num,'') req,
            coalesce(pnr,'') pnr, coalesce(passenger_name,'') pax,
            coalesce(route,'') route, status
       from tickets where source = 'Ibtekar' order by date, ticket_no`);

  const missing = rows.filter((r: any) => r.invoice && !have.has(r.invoice));
  const noRef = rows.filter((r: any) => !r.invoice);

  const byInvoice = new Map<string, any[]>();
  for (const r of missing as any[]) {
    if (!byInvoice.has(r.invoice)) byInvoice.set(r.invoice, []);
    byInvoice.get(r.invoice)!.push(r);
  }

  const summary = [...byInvoice.entries()]
    .map(([invoice, rs]) => {
      const dates = rs.map(r => r.date).filter(Boolean).sort();
      return {
        'Invoice No': invoice,
        'From': dates[0] ?? '',
        'To': dates[dates.length - 1] ?? '',
        'Tickets': rs.length,
        'Amount': money(rs.reduce((n, r) => n + r.amount, 0)),
        'Currency': rs[0].currency,
        'Request No': [...new Set(rs.map(r => r.req).filter(Boolean))].join(', '),
      };
    })
    .sort((a, b) => a.From.localeCompare(b.From));

  const lines = (missing as any[]).map(r => ({
    'Invoice No': r.invoice,
    'Ticket No': `${r.airline_code}-${r.ticket_no}`,
    'Date': r.date,
    'Passenger': r.pax,
    'Route': r.route,
    'PNR': r.pnr,
    'Request No': r.req,
    'Status': r.status,
    'Amount': money(r.amount),
    'Currency': r.currency,
  }));

  console.log(`Ibtekar rows in the ledger      : ${rows.length}`);
  console.log(`tax invoice held for them       : ${rows.length - missing.length - noRef.length}`);
  console.log(`invoice number known, no PDF    : ${missing.length} ticket(s) on ${byInvoice.size} invoice(s)`);
  console.log(`no invoice number at all        : ${noRef.length}`);
  console.table(summary);
  console.log(`total to ask for: ${money(missing.reduce((n: number, r: any) => n + r.amount, 0))} SAR`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Invoices to request');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), 'Tickets');
  if (noRef.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((noRef as any[]).map(r => ({
      'Ticket No': `${r.airline_code}-${r.ticket_no}`, 'Date': r.date,
      'Passenger': r.pax, 'Request No': r.req, 'Status': r.status,
      'Amount': money(r.amount), 'Currency': r.currency,
    }))), 'No invoice number');
  }
  XLSX.writeFile(wb, OUT);
  console.log(`\nwritten: ${OUT}`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
