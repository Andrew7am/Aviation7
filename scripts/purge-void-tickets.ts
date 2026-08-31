/**
 * Remove voided documents already stored.
 *
 * Import now discards them on the way in; these are the ones saved before that
 * rule existed. They settle at zero, so removing them moves no money — it only
 * takes documents nobody has to act on out of the ticket count and the
 * "not closed" list.
 *
 * Matches on STATUS, never on a zero amount: a zero-value ISSUE is a real
 * document (a free ticket, or a fare the report failed to state) and stays.
 *
 * Dry run by default; --apply deletes, after writing a rollback snapshot of
 * the full rows.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const SNAPSHOT = 'void-purge-snapshot.json';

/** The vendors' cancellation vocabulary — mirrors normalizeStatus()'s VOID. */
const VOID_STATUSES = ['VOID', 'CANN', 'CANX', 'CANCEL', 'CANCELLED', 'RFNX'];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select * from tickets
     where upper(btrim(coalesce(status,''))) = any($1)
     order by source, date`, [VOID_STATUSES]);

  console.log(`voided documents stored: ${rows.length}`);
  if (rows.length === 0) { await c.end(); return; }

  console.table(rows.slice(0, 15).map((r: any) => ({
    ticket: r.ticket_no, source: r.source, status: r.status,
    date: r.date, amount: Number(r.amount), req: r.req_num,
  })));

  const nonZero = rows.filter((r: any) => Number(r.amount) !== 0);
  console.log(`\ncarrying a non-zero amount: ${nonZero.length}`);
  if (nonZero.length) {
    console.log('STOP: a voided row should settle at zero. Left alone:');
    console.table(nonZero.map((r: any) => ({ ticket: r.ticket_no, source: r.source, amount: Number(r.amount) })));
    await c.end();
    process.exitCode = 1;
    return;
  }

  console.log(`\nby vendor:`);
  console.table(Object.values(rows.reduce((acc: Record<string, any>, r: any) => {
    acc[r.source] ??= { source: r.source, rows: 0 };
    acc[r.source].rows++;
    return acc;
  }, {})));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply.');
    await c.end();
    return;
  }

  writeFileSync(SNAPSHOT, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nrollback snapshot written: ${SNAPSHOT} (${rows.length} full rows)`);

  await c.query('begin');
  try {
    const { rowCount } = await c.query(
      `delete from tickets where id = any($1)`, [rows.map((r: any) => r.id)]);
    await c.query('commit');
    console.log(`APPLIED: ${rowCount} voided documents removed (0.00 of value).`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
