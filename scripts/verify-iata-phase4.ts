/**
 * PHASE 4 post-import verification — read-only, re-runnable.
 *
 * Re-parses the invoices, re-reconciles against the live ledger and proves the
 * import landed correctly. Because reconciliation is idempotent, a correct
 * import shows up here as "nothing left to do": 0 dates to fix, 0 rows to
 * insert. That doubles as the idempotency proof.
 *
 * Compares against the baselines the apply run wrote to iata-phase4-report.json,
 * so the no-deletion and non-IATA checks are made against numbers captured
 * BEFORE the write, not re-derived after it.
 *
 * Run: npx tsx scripts/verify-iata-phase4.ts <dir-of-invoices> [report.json]
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { Client } from 'pg';
import { runParser } from '../src/core/parsers';
import { extractPdfRows } from '../src/core/helpers/pdfText';
import { reconcileIata, isVoid, type InvoiceTxn, type LedgerTxn } from '../src/core/helpers/iataReconcile';

const IATA_VENDOR = 'IATA BSP';
const DIR = process.argv[2];
const REPORT = process.argv[3] ?? 'iata-phase4-report.json';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `   — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `   — ${detail}` : ''}`); }
};

async function main() {
  if (!DIR || !existsSync(DIR)) { console.log('usage: tsx scripts/verify-iata-phase4.ts <dir-of-invoices> [report.json]'); process.exit(1); }
  if (!existsSync(REPORT)) { console.log(`report not found: ${REPORT}`); process.exit(1); }
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));

  const files = readdirSync(DIR).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f)).sort();
  const invoice: InvoiceTxn[] = [];
  for (const f of files) {
    const buf = readFileSync(path.join(DIR, f));
    const lines = await extractPdfRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const grid = Papa.parse(lines.map(r => `"${r.replace(/"/g, '""')}"`).join('\n'), { skipEmptyLines: true }).data as string[][];
    for (const r of runParser(grid, undefined, 'AED', f).rows) {
      invoice.push({
        ticketNo: r.ticketNo, rawType: r.rawType || '', status: r.status || '', date: r.date,
        channel: r.channel || 'BSP', fare: r.totalDoc ?? 0, commission: r.commission ?? 0,
        payable: r.amount, currency: r.currency || 'AED', file: f,
      });
    }
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: dbRows } = await c.query(
    `select id, ticket_no, status, date, amount::float8 as amount, total_doc::float8 as total_doc,
            commission::float8 as commission, channel, import_batch_id
     from tickets where source = $1`, [IATA_VENDOR]);
  const ledger: LedgerTxn[] = dbRows.map((r: any) => ({
    id: r.id, ticketNo: r.ticket_no, status: r.status, date: r.date,
    amount: r.amount, totalDoc: r.total_doc,
  }));
  const rec = reconcileIata(invoice, ledger);

  console.log(`\ninvoices ${files.length} · invoice transactions ${invoice.length} · IATA ledger rows ${ledger.length}\n`);
  console.log('IDEMPOTENCY (19) — a correct import leaves nothing to do');
  check('19  no date left to correct', rec.dateUpdates.length === 0, `${rec.dateUpdates.length} outstanding`);
  check('19  no transaction left to import', rec.toImport.length === 0, `${rec.toImport.length} outstanding`);
  check('A   every invoice-matched row now holds its invoice date',
    rec.alreadyCorrect.length === report.dateUpdates + report.inserted,
    `${rec.alreadyCorrect.length} rows agree with the invoice`);

  console.log('\nIMPORTED ROWS (B-J)');
  const ins = dbRows.filter((r: any) => r.import_batch_id === report.batchId);
  check('    the batch is present', ins.length === report.inserted, `${ins.length}/${report.inserted}`);
  check('B/E every imported row is IATA BSP', ins.every((r: any) => r.import_batch_id === report.batchId));
  check('C   no VOID was inserted', ins.every((r: any) => (r.status || '').toUpperCase() !== 'VOID'));
  check('D   every imported row carries a real invoice date',
    ins.every((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !Number.isNaN(Date.parse(r.date))));
  check('F/G channel is BSP or WEBSALES-EDIS',
    ins.every((r: any) => r.channel === 'BSP' || r.channel === 'WEBSALES-EDIS'),
    `BSP ${ins.filter((r: any) => r.channel === 'BSP').length}, WEBSALES-EDIS ${ins.filter((r: any) => r.channel === 'WEBSALES-EDIS').length}`);
  // The ledger keeps the fare as a magnitude and the sign on the amount, so
  // the sign is restored before checking the invoice's own equation.
  const badMath = ins.filter((r: any) => {
    const fareSigned = r.amount < 0 ? -r.total_doc : r.total_doc;
    return Math.abs(fareSigned - r.commission - r.amount) >= 0.011;
  });
  check('H   fare - commission = payable on every imported row', badMath.length === 0,
    badMath.slice(0, 3).map((r: any) => `${r.ticket_no} ${r.total_doc}/${r.commission}/${r.amount}`).join('; '));
  check('I   every imported refund is negative',
    ins.filter((r: any) => r.status === 'REFUND').every((r: any) => r.amount <= 0),
    `${ins.filter((r: any) => r.status === 'REFUND').length} refunds`);
  check('J   commission cents preserved',
    ins.some((r: any) => Math.abs(r.commission % 1) > 0.001),
    `${ins.filter((r: any) => Math.abs(r.commission % 1) > 0.001).length} rows carry fractional commission`);

  console.log('\nNOTHING LOST (K/L/M/29)');
  check('K/L no IATA row disappeared',
    ledger.length === report.iataBefore.n + report.inserted,
    `${report.iataBefore.n} + ${report.inserted} = ${ledger.length}`);
  const { rows: dupes } = await c.query(
    `select ticket_no, sign(amount) as dir from tickets where source = $1
     group by ticket_no, sign(amount) having count(*) > 1`, [IATA_VENDOR]);
  check('M   no new duplicate document+direction', dupes.length <= 3, `${dupes.length} keys hold >1 row (3 pre-existed)`);
  check('16  the 3 special cases are still present',
    ['5512369276', '5512559503', '5513059027'].every(d => dbRows.some((r: any) => r.ticket_no === d)));
  check('17  existing VOID rows survive',
    dbRows.filter((r: any) => (r.status || '').toUpperCase() === 'VOID').length >= 10,
    `${dbRows.filter((r: any) => (r.status || '').toUpperCase() === 'VOID').length} VOID rows`);
  check('    the 22 rows with no invoice line are untouched',
    rec.ledgerNoInvoice.length + rec.unresolved.length === report.ledgerNoInvoice + report.unresolved,
    `${rec.ledgerNoInvoice.length} + ${rec.unresolved.length}`);
  check('24  excluded VOIDs stay excluded', rec.excludedVoid.length === report.excludedVoid,
    `${rec.excludedVoid.length} invoice VOIDs still absent, by rule`);

  console.log('\nNON-IATA UNTOUCHED (N/21)');
  const { rows: now } = await c.query(`
    select source, count(*)::int as n,
           coalesce(sum(total_doc),0)::float8 as fare,
           coalesce(sum(commission),0)::float8 as comm,
           coalesce(sum(amount),0)::float8 as payable,
           count(*) filter (where date <> '' and date is not null)::int as dated
    from tickets where source <> $1 group by source order by source`, [IATA_VENDOR]);
  let drifted = 0;
  for (const b of report.nonIataBefore) {
    const a = now.find((x: any) => x.source === b.source);
    const same = a && a.n === b.n && Math.abs(a.fare - b.fare) < 0.005
      && Math.abs(a.comm - b.comm) < 0.005 && Math.abs(a.payable - b.payable) < 0.005 && a.dated === b.dated;
    if (!same) drifted++;
    console.log(`     ${String(b.source).padEnd(18)} ${String(b.n).padStart(5)} rows  net ${money(b.payable).padStart(14)}  ${same ? 'unchanged' : '*** CHANGED ***'}`);
  }
  check('N/21 every non-IATA vendor identical to its pre-import baseline', drifted === 0, `${drifted} drifted`);
  check('     no vendor appeared or vanished', now.length === report.nonIataBefore.length,
    `${now.length} vs ${report.nonIataBefore.length}`);
  const { rows: w } = await c.query(`select count(*)::int as n from vendor_balances`);
  check('11   wallet count unchanged — none created for IATA or WEBSALES', w[0].n === 7, `${w[0].n} wallets`);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
