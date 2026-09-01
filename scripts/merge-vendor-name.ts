/**
 * Fold one vendor name into another.
 *
 * A new report FORMAT is not a new vendor. When a parser is named after the
 * format rather than the supplier, the ledger grows a second vendor that
 * shares the first one's wallet — Ibtekar and "Ibtekar (New)" were one
 * supplier listed twice.
 *
 * Refuses to run if the merge would make two rows indistinguishable, since
 * `source` is part of the duplicate key: collapsing it could turn two distinct
 * tickets into the same row.
 *
 *   npx tsx scripts/merge-vendor-name.ts "Ibtekar (New)" "Ibtekar" [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const FROM = process.argv[2];
const INTO = process.argv[3];
const APPLY = process.argv.includes('--apply');

(async () => {
  if (!FROM || !INTO) {
    console.error('usage: tsx scripts/merge-vendor-name.ts "<from>" "<into>" [--apply]');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query('select * from tickets where source = $1', [FROM]);
  console.log(`rows named "${FROM}": ${rows.length}`);
  if (rows.length === 0) { console.log('nothing to do.'); await c.end(); return; }

  const { rows: target } = await c.query(
    'select count(*)::int n, coalesce(sum(amount),0)::float8 net from tickets where source = $1', [INTO]);
  console.log(`rows already named "${INTO}": ${target[0].n}\n`);

  // `source` is part of the duplicate key, so collapsing it must not make two
  // separate tickets identical.
  const { rows: clash } = await c.query(
    `select ticket_no, coalesce(status,'') status, amount::float8 amount, date, count(*)::int n
     from tickets where source in ($1, $2)
     group by ticket_no, coalesce(status,''), amount, date
     having count(*) > 1`, [FROM, INTO]);
  if (clash.length) {
    console.log(`STOP: ${clash.length} row(s) would become indistinguishable after the merge:`);
    console.table(clash.slice(0, 10));
    console.log('Nothing written. Resolve these first.');
    await c.end();
    process.exitCode = 1;
    return;
  }
  console.log('safety check: no two rows collide on ticket + status + amount + date.');

  const moving = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);
  console.log(`\n"${INTO}" would go from ${target[0].n} rows / ${Number(target[0].net).toFixed(2)}`);
  console.log(`                    to ${target[0].n + rows.length} rows / ${(Number(target[0].net) + moving).toFixed(2)}`);
  console.log('(the money does not change — it is one vendor either way)');

  const { rows: wallets } = await c.query(
    'select vendor_name from vendor_balances where vendor_name in ($1, $2)', [FROM, INTO]);
  console.log(`\nwallets involved: ${wallets.map((w: any) => w.vendor_name).join(', ') || 'none'}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await c.end(); return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot = `vendor-merge-${stamp}.json`;
  writeFileSync(snapshot, JSON.stringify({ takenAt: new Date().toISOString(), from: FROM, into: INTO, rows }, null, 2));
  console.log(`\nrollback snapshot written: ${snapshot}`);

  await c.query('begin');
  try {
    const { rowCount } = await c.query(
      'update tickets set source = $1 where source = $2', [INTO, FROM]);
    // A wallet under the old name would be orphaned; fold it only if the
    // target has none, otherwise leave it for a human.
    const { rowCount: walletMoved } = await c.query(
      `update vendor_balances set vendor_name = $1
       where vendor_name = $2
         and not exists (select 1 from vendor_balances where vendor_name = $1)`, [INTO, FROM]);
    await c.query('commit');
    console.log(`APPLIED: ${rowCount} ticket(s) renamed${walletMoved ? `, ${walletMoved} wallet renamed` : ''}.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
