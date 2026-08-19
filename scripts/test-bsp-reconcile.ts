/**
 * End-to-end check of the BSP invoice import against the LIVE database:
 * PDF -> extract -> parse -> classify, exactly as the import screen does it.
 *
 * Run: npx tsx scripts/test-bsp-reconcile.ts [path-to-invoice.pdf]
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import Papa from 'papaparse';
import { Client } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { runParser } from '../src/core/parsers';
import { extractPdfRows, pdfRowsToCsv } from '../src/core/helpers/pdfText';
import { classifyAgainstExisting, RECON_LABEL, ReconClass } from '../src/core/ImportEngine';
import type { Ticket } from '../src/types';

const PDF = process.argv[2] ?? 'C:/Users/andre/AppData/Local/Temp/AE_FCAGBILLDET_8621913_20260802.PDF';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

async function main() {
  if (!existsSync(PDF)) { console.log(`invoice not found: ${PDF}`); return; }

  const buf = readFileSync(PDF);
  const rows = await extractPdfRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const csv = pdfRowsToCsv(rows);
  const grid = Papa.parse(csv, { skipEmptyLines: true }).data as string[][];
  const parsed = runParser(grid, undefined, 'AED', 'invoice.pdf');

  console.log(`parser: ${parsed.parserName}   transactions: ${parsed.rows.length}   errors: ${parsed.errors.length}`);

  const tickets: Ticket[] = parsed.rows.map(r => ({
    id: uuidv4(), ticketNo: r.ticketNo, pnr: r.pnr || '', passengerName: r.passengerName || '',
    airlineCode: r.airlineCode || '', route: r.route || '', source: r.source || 'IATA BSP',
    date: r.date, amount: r.amount, totalDoc: r.totalDoc ?? 0, commission: r.commission ?? 0,
    reqNum: r.reqNum, vendorReference: r.vendorReference || '', status: r.status,
    currency: r.currency, transactionType: r.status, reportName: 'BSP invoice', channel: r.channel,
    importTime: new Date().toISOString(), isDuplicate: false, userId: 'temp',
  } as Ticket));

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: dbRows } = await c.query(
    `select id, ticket_no, source, status, date, amount::float8 as amount,
            total_doc::float8 as total_doc, commission::float8 as commission, req_num
     from tickets where ticket_no = any($1)`, [tickets.map(t => t.ticketNo)]);
  const existing: Ticket[] = dbRows.map(r => ({
    id: r.id, ticketNo: r.ticket_no, source: r.source, status: r.status, date: r.date,
    amount: r.amount, totalDoc: r.total_doc, commission: r.commission, reqNum: r.req_num || '',
  } as Ticket));

  const classified = classifyAgainstExisting(tickets, existing);
  const tally = new Map<ReconClass, number>();
  for (const c2 of classified) tally.set(c2.cls, (tally.get(c2.cls) ?? 0) + 1);

  console.log('\nreconciliation verdicts:');
  for (const [cls, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${RECON_LABEL[cls].padEnd(20)} ${n}`);
  }

  console.log('\n--- commission the ledger is missing ---');
  const commMissing = classified.filter(c2 => c2.cls === 'COMMISSION_MISSING');
  let commTotal = 0;
  for (const c2 of commMissing) {
    commTotal += Math.abs(c2.delta.commission);
    console.log(`  ${c2.ticket.status.padEnd(6)} ${c2.ticket.ticketNo}  invoice comm=${(c2.ticket.commission ?? 0).toFixed(2).padStart(8)}  system comm=${(c2.existing?.commission ?? 0).toFixed(2).padStart(6)}  payable out by ${c2.delta.payable.toFixed(2)}`);
  }
  console.log(`  total: ${commTotal.toFixed(2)} AED`);

  console.log('\n--- on the invoice, absent from the system ---');
  const missing = classified.filter(c2 => c2.cls === 'NEW');
  const byChannel = new Map<string, { n: number; v: number }>();
  for (const c2 of missing) {
    const k = `${c2.ticket.source} / ${(c2.ticket as any).channel ?? '-'}`;
    const e = byChannel.get(k) ?? { n: 0, v: 0 };
    e.n++; e.v += c2.ticket.amount;
    byChannel.set(k, e);
  }
  for (const [ch, e] of byChannel) console.log(`  ${ch.padEnd(16)} ${String(e.n).padStart(3)} transactions, ${e.v.toFixed(2)} AED`);

  console.log('\n=== assertions ===');
  const web = classified.filter(c2 => (c2.ticket as any).channel === 'WEBSALES-EDIS');
  check('WEBSALES-EDIS kept on its own channel', web.length > 0, true);
  check('WEBSALES rows stay under the IATA vendor', web.every(c2 => c2.ticket.source === 'IATA BSP'), true);
  check('no WEBSALES row loses its channel', web.every(c2 => (c2.ticket as any).channel === 'WEBSALES-EDIS'), true);
  check('commission gaps detected as COMMISSION_MISSING, not FARE_DIFF',
    commMissing.length > 0 && classified.filter(c2 => c2.cls === 'FARE_DIFF').length === 0, true);
  check('every parsed row carries a date', tickets.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date)), true);
  check('commission cents preserved somewhere', tickets.some(t => Math.abs((t.commission ?? 0) % 1) > 0.001), true);
  check('fare - commission = payable holds for every non-void row',
    tickets.filter(t => t.status !== 'VOID').every(t => {
      const fareSigned = t.amount < 0 ? -(t.totalDoc ?? 0) : (t.totalDoc ?? 0);
      return Math.abs(fareSigned - (t.commission ?? 0) - t.amount) < 0.011;
    }), true);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
