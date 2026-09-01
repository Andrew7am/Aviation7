/**
 * Reclassify stored RTS tickets from SAR to AED.
 *
 * RTS bills in AED and states it in its export's Total currency column, but
 * the parser used to take whatever currency the UI defaulted to — so the rows
 * saved before that was fixed all say SAR. The amounts are right; only the
 * currency they are counted under is wrong.
 *
 * This changes no figure, it moves figures between the two currency columns.
 * Dry run by default; --apply writes after a rollback snapshot.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const SNAPSHOT = 'rts-currency-snapshot.json';
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select * from tickets where source = 'RTS' and currency <> 'AED' order by date`);
  console.log(`RTS rows not already in AED: ${rows.length}`);
  if (rows.length === 0) { await c.end(); return; }

  console.table(Object.values(rows.reduce((acc: Record<string, any>, r: any) => {
    acc[r.currency] ??= { 'stored as': r.currency, rows: 0, total: 0 };
    acc[r.currency].rows++;
    acc[r.currency].total += Number(r.amount);
    return acc;
  }, {})).map((x: any) => ({ ...x, total: money(x.total) })));

  const before = (await c.query(
    `select currency, count(*)::int rows, sum(amount::numeric)::float8 net
     from tickets group by currency order by rows desc`)).rows;
  const moving = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);

  console.log('\n--- ledger totals, before and after ---');
  console.table(before.map((b: any) => {
    const delta = b.currency === 'SAR' ? -moving : b.currency === 'AED' ? moving : 0;
    return {
      currency: b.currency,
      before: money(Number(b.net)),
      after: money(Number(b.net) + delta),
      change: delta === 0 ? '—' : money(delta),
    };
  }));
  console.log(`\nthe amounts themselves are untouched; ${money(moving)} moves column.`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await c.end(); return;
  }

  writeFileSync(SNAPSHOT, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nrollback snapshot written: ${SNAPSHOT} (${rows.length} rows)`);

  await c.query('begin');
  try {
    const { rowCount } = await c.query(
      `update tickets set currency = 'AED' where id = any($1)`, [rows.map((r: any) => r.id)]);
    await c.query('commit');
    console.log(`APPLIED: ${rowCount} RTS rows reclassified to AED.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
