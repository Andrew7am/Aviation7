/**
 * Prove a backup can actually be put back.
 *
 * A backup is only worth what a restore of it is worth, and the only way to
 * know is to do one. Restoring over the live ledger to find out is not an
 * option, so this copies the real backup into throwaway tables in their own
 * schema, using the SAME reader and the SAME insert the restore uses, and
 * compares every row. The scratch schema is dropped whether the test passes
 * or fails.
 *
 * Run: npx tsx scripts/test-backup-restore.ts [--from=<backup folder>]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readTable, dependencyOrder, insertRows } from './restore-backup';
import { primaryBackupRoot } from './backup-paths';

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ROOT = primaryBackupRoot();
const SCHEMA = 'backup_restore_test';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

function newest(): string {
  const dirs = readdirSync(ROOT)
    .filter(n => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n))
    .filter(n => statSync(join(ROOT, n)).isDirectory()).sort();
  if (!dirs.length) { console.error(`no backups in ${ROOT} — run backup-ledger.ts first`); process.exit(1); }
  return join(ROOT, dirs[dirs.length - 1]);
}

console.log('\n1. Dependency order puts parents before children');
{
  const edges = [
    { child: 'vendor_imports', parent: 'vendors' },
    { child: 'nsa_rows', parent: 'vendor_imports' },
    { child: 'balance_topups', parent: 'vendor_balances' },
  ];
  const order = dependencyOrder(
    ['nsa_rows', 'balance_topups', 'vendor_imports', 'vendors', 'vendor_balances'], edges);
  const at = (t: string) => order.indexOf(t);
  check('vendors before vendor_imports', at('vendors') < at('vendor_imports'), true);
  check('vendor_imports before nsa_rows', at('vendor_imports') < at('nsa_rows'), true);
  check('vendor_balances before balance_topups', at('vendor_balances') < at('balance_topups'), true);
  check('every table is listed once', order.length, 5);
}

console.log('\n2. A cycle still lists every table rather than dropping any');
{
  const order = dependencyOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }]);
  check('both tables survive', order.slice().sort(), ['a', 'b']);
}

(async () => {
  const dir = arg('from') ?? newest();
  if (!existsSync(join(dir, 'manifest.json'))) { console.error(`not a backup: ${dir}`); process.exit(1); }
  console.log(`\n3. Real backup restored into scratch tables\n  using ${dir}`);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(`drop schema if exists ${SCHEMA} cascade`);
    await c.query(`create schema ${SCHEMA}`);

    // The tables worth proving: the ledger itself, the wallets, and the money
    // paid into them. Structure copied from the live tables so the insert has
    // to satisfy the same column types.
    const tables = ['tickets', 'vendor_balances', 'balance_topups'];
    for (const t of tables) {
      await c.query(`create table ${SCHEMA}."${t}" (like public."${t}" including defaults)`);
    }

    for (const t of tables) {
      const rows = readTable(dir, t);
      if (rows === null) { check(`${t} present in the backup`, false, true); continue; }
      const written = await insertRows(c as any, `${SCHEMA}"."${t}`, rows);
      check(`${t}: every row written`, written, rows.length);

      const { rows: [{ n }] } = await c.query(`select count(*)::int n from ${SCHEMA}."${t}"`);
      check(`${t}: count matches the live table`,
        n, (await c.query(`select count(*)::int n from public."${t}"`)).rows[0].n);
    }

    // Not just the row count — the content. Compared as sorted ids plus the
    // money, because a restore that kept the right number of wrong rows would
    // pass a count check.
    const liveSum = await c.query(
      `select round(sum(amount)::numeric, 2)::text s, count(distinct id)::int ids from public.tickets`);
    const testSum = await c.query(
      `select round(sum(amount)::numeric, 2)::text s, count(distinct id)::int ids from ${SCHEMA}.tickets`);
    check('tickets: the money is identical', testSum.rows[0].s, liveSum.rows[0].s);
    check('tickets: the ids are all distinct and all there', testSum.rows[0].ids, liveSum.rows[0].ids);

    // EVERY column, both directions. An earlier version compared only the
    // columns that seemed to matter and passed while the backup was quietly
    // truncating microseconds off every timestamp in the database.
    for (const t of tables) {
      const a = await c.query(
        `select count(*)::int n from (
           select * from public."${t}" except select * from ${SCHEMA}."${t}") x`);
      const b = await c.query(
        `select count(*)::int n from (
           select * from ${SCHEMA}."${t}" except select * from public."${t}") x`);
      check(`${t}: not one row differs, in either direction`, [a.rows[0].n, b.rows[0].n], [0, 0]);
    }
  } finally {
    await c.query(`drop schema if exists ${SCHEMA} cascade`);
    await c.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
