/**
 * Apply ONE migration file, in a transaction.
 *
 * run-supabase-migrations.ts replays every file in the folder, which is right
 * for standing a fresh project up but wrong against production here: several
 * of the early vendor_*_rows migrations were never applied to this database,
 * and replaying them would create tables the app does not use. This applies
 * exactly the file named on the command line.
 *
 *   npx tsx scripts/apply-migration.ts supabase/migrations/0019_....sql
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('usage: tsx scripts/apply-migration.ts <path/to/migration.sql>'); process.exit(1); }

  const sql = readFileSync(file, 'utf8');
  const c = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 60_000 });
  await c.connect();
  console.log(`applying ${file} ...`);
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('applied.');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('ROLLED BACK, nothing changed:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
