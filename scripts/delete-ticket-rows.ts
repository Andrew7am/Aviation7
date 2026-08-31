/**
 * Delete specific ticket rows by id, with a rollback snapshot.
 *
 * For one-off corrections where the row has been identified by hand and the
 * reason recorded — not a rule, so nothing here infers what to remove. Every
 * id must be given explicitly and is echoed back before anything is written.
 *
 *   npx tsx scripts/delete-ticket-rows.ts <id> [<id> ...] [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const IDS = process.argv.slice(2).filter(a => !a.startsWith('--'));

(async () => {
  if (IDS.length === 0) {
    console.error('usage: tsx scripts/delete-ticket-rows.ts <id> [<id> ...] [--apply]');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query('select * from tickets where id = any($1)', [IDS]);
  console.log(`matched ${rows.length} of ${IDS.length} id(s)`);
  console.table(rows.map((r: any) => ({
    id: r.id.slice(0, 8), ticket: r.ticket_no, source: r.source, status: r.status,
    date: r.date, amount: Number(r.amount), total_doc: Number(r.total_doc),
    req: r.req_num, pnr: r.pnr,
  })));

  const valued = rows.filter((r: any) => Number(r.amount) !== 0);
  if (valued.length) {
    console.log(`\nNOTE: ${valued.length} row(s) carry a non-zero amount — deleting them MOVES money.`);
  }
  if (rows.length === 0) { await c.end(); return; }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply.');
    await c.end(); return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot = `deleted-rows-${stamp}.json`;
  writeFileSync(snapshot, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nrollback snapshot written: ${snapshot}`);

  await c.query('begin');
  try {
    const { rowCount } = await c.query('delete from tickets where id = any($1)', [rows.map((r: any) => r.id)]);
    await c.query('commit');
    console.log(`APPLIED: ${rowCount} row(s) deleted.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
