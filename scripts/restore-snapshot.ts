/**
 * Restore ticket rows from a snapshot written by one of the maintenance
 * scripts. Only the columns present in the snapshot are written back, and
 * only for rows that still exist.
 *
 *   npx tsx scripts/restore-snapshot.ts <snapshot.json> [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');

const COLS = [
  'ticket_no', 'source', 'date', 'amount', 'commission', 'total_doc', 'req_num',
  'pnr', 'passenger_name', 'airline_code', 'route', 'status', 'currency',
  'transaction_type', 'vendor_reference', 'serial', 'channel', 'closed',
] as const;

(async () => {
  const snap = JSON.parse(readFileSync(FILE, 'utf8'));
  const rows: any[] = snap.before ?? snap.rows ?? [];
  console.log(`snapshot taken ${snap.takenAt}, holds ${rows.length} row(s)`);
  if (rows.length === 0) return;

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: now } = await c.query('select * from tickets where id = any($1)',
    [rows.map(r => r.id)]);
  const byId = new Map(now.map((r: any) => [r.id, r]));

  const diffs: any[] = [];
  for (const was of rows) {
    const is = byId.get(was.id);
    if (!is) { diffs.push({ ticket: was.ticket_no, change: 'ROW IS GONE' }); continue; }
    for (const col of COLS) {
      if (String(was[col] ?? '') !== String(is[col] ?? '')) {
        diffs.push({ ticket: was.ticket_no, column: col, now: is[col], 'restore to': was[col] });
      }
    }
  }
  console.log(`\ncolumns that differ from the snapshot: ${diffs.length}`);
  console.table(diffs.slice(0, 25));
  if (diffs.length === 0) { await c.end(); return; }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to restore.');
    await c.end(); return;
  }

  await c.query('begin');
  try {
    for (const was of rows) {
      if (!byId.has(was.id)) continue;
      await c.query(
        `update tickets set ticket_no=$1, source=$2, date=$3, amount=$4, commission=$5,
                            total_doc=$6, req_num=$7, pnr=$8, passenger_name=$9,
                            airline_code=$10, route=$11, status=$12, currency=$13,
                            transaction_type=$14, vendor_reference=$15, serial=$16,
                            channel=$17, closed=$18
         where id=$19`,
        [was.ticket_no, was.source, was.date, was.amount, was.commission, was.total_doc,
         was.req_num, was.pnr, was.passenger_name, was.airline_code, was.route, was.status,
         was.currency, was.transaction_type, was.vendor_reference, was.serial, was.channel,
         was.closed, was.id]);
    }
    await c.query('commit');
    console.log(`RESTORED ${rows.length} row(s) to their snapshot values.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
