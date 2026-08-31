/**
 * Remove documents the invoice prints as a cancellation but the ledger stored
 * as a live sale.
 *
 * IATAParser used to fall back to "amount < 0 ? REFUND : ISSUE" whenever the
 * TRNC column was unreadable. On a cancellation every column is 0.00, so the
 * fallback called it an ISSUE — a cancelled document sitting in the ledger as
 * a live ticket that can never be closed. The parser no longer does that; this
 * clears the ones it already produced.
 *
 * The ticket numbers are listed explicitly rather than inferred, because each
 * was verified by hand against its line in the FCAGBILLDET invoice.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const SNAPSHOT = 'misread-cancellation-snapshot.json';

/** ticket -> what the invoice actually prints. */
const CANCELLED: Record<string, string> = {
  '5512129161': 'CANN  (invoice 20260203)',
  '5512369151': 'CANX  (invoice 20260303)',
  '5512759968': 'CANX  (invoice 20260504)',
  '5512759969': 'CANX  (invoice 20260504)',
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select * from tickets
     where ticket_no = any($1) and source = 'IATA BSP' and amount = 0`,
    [Object.keys(CANCELLED)]);

  console.log(`rows to remove: ${rows.length} of ${Object.keys(CANCELLED).length} listed`);
  console.table(rows.map((r: any) => ({
    ticket: r.ticket_no, stored: r.status, amount: Number(r.amount),
    'invoice prints': CANCELLED[r.ticket_no], date: r.date, req: r.req_num,
  })));

  const nonZero = rows.filter((r: any) => Number(r.amount) !== 0);
  if (nonZero.length) {
    console.log('STOP: one of these carries a value — not touching it.');
    await c.end(); process.exitCode = 1; return;
  }
  if (rows.length === 0) { await c.end(); return; }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply.');
    await c.end(); return;
  }

  writeFileSync(SNAPSHOT, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nrollback snapshot written: ${SNAPSHOT}`);

  await c.query('begin');
  try {
    const { rowCount } = await c.query('delete from tickets where id = any($1)', [rows.map((r: any) => r.id)]);
    await c.query('commit');
    console.log(`APPLIED: ${rowCount} misread cancellations removed (0.00 of value).`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
