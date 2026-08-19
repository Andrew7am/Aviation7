/** Read-only: how the 18 card-payment (FOP=CC) documents sit in the ledger. */
import 'dotenv/config';
import { Client } from 'pg';
const DOCS = ['5512129174', '5512129175', '5512129176', '5512129177', '5512129178', '5512129179', '5512129180',
              '1930576214', '1930576215', '1930576216', '1930576217'];
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `select ticket_no, status, transaction_type, date, amount::float8 a, total_doc::float8 f,
            commission::float8 cm, req_num, import_batch_id
     from tickets where source = 'IATA BSP' and ticket_no = any($1)
     order by ticket_no, date`, [DOCS]);
  console.log(`ledger rows for the 18 card-payment documents: ${rows.length}\n`);
  for (const r of rows) {
    console.log(`  ${r.ticket_no} ${String(r.transaction_type || r.status).padEnd(6)} ${r.date}  fare ${money(r.f).padStart(11)}  comm ${money(r.cm).padStart(9)}  payable ${money(r.a).padStart(12)}  req=${r.req_num || '—'}  ${r.import_batch_id ? 'PHASE-4 IMPORT' : 'pre-existing'}`);
  }
  const imported = rows.filter((r: any) => r.import_batch_id);
  console.log(`\n  of these, imported by Phase 4: ${imported.length}`);
  console.log(`  carrying a phantom commission (|comm| = |fare|, fare != 0): ${rows.filter((r: any) => Math.abs(r.f) > 0.005 && Math.abs(Math.abs(r.cm) - Math.abs(r.f)) < 0.011).length}`);
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
