/**
 * Record the migrations that are in the database but not in the ledger of them.
 *
 * schema_migrations stops at 0016, while 0017-0022 were plainly applied - the
 * audit_log table, tickets.channel, the admin-write policies, the wallet
 * opening date, the cabin class and the manual-profile origin are all there.
 * The runner therefore tries to replay 0017 on every run and dies on a policy
 * that already exists, which means no migration written since can be applied
 * by the ordinary command.
 *
 * Each file is recorded only after the thing it creates is shown to exist, so
 * this cannot mark an unapplied migration as done.
 *
 *   npx tsx scripts/investigations/record-applied-migrations.ts
 *   npx tsx scripts/investigations/record-applied-migrations.ts --apply
 */
import 'dotenv/config';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');

/** filename -> a query returning one row when that migration is in place. */
const EVIDENCE: Record<string, string> = {
  '0017_shared_workspace_and_audit.sql':
    `select 1 from information_schema.tables where table_name = 'audit_log'`,
  '0018_ticket_channel.sql':
    `select 1 from information_schema.columns where table_name = 'tickets' and column_name = 'channel'`,
  '0019_admin_write_viewer_read.sql':
    `select 1 from pg_policies where tablename = 'tickets' and policyname = 'tickets_admin_write'`,
  '0020_wallet_opening_date.sql':
    `select 1 from information_schema.columns where table_name = 'vendor_balances' and column_name = 'opening_date'`,
  '0021_ticket_cabin_class.sql':
    `select 1 from information_schema.columns where table_name = 'tickets' and column_name = 'cabin_class'`,
  '0022_manual_parser_profiles.sql':
    `select 1 from information_schema.columns where table_name = 'ai_vendor_profiles' and column_name = 'origin'`,
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: have } = await c.query('select filename from schema_migrations');
  const known = new Set(have.map((r: any) => r.filename));

  const toRecord: string[] = [];
  for (const [file, sql] of Object.entries(EVIDENCE)) {
    if (known.has(file)) { console.log(`${file}  already recorded`); continue; }
    const { rowCount } = await c.query(sql);
    if (rowCount) { console.log(`${file}  in the database, not recorded`); toRecord.push(file); }
    else          { console.log(`${file}  NOT in the database - left alone`); }
  }

  if (!toRecord.length) { console.log('\nnothing to record.'); await c.end(); return; }
  if (!APPLY) { console.log(`\nDRY RUN - would record ${toRecord.length} file(s).`); await c.end(); return; }

  for (const f of toRecord) {
    await c.query('insert into schema_migrations (filename) values ($1) on conflict do nothing', [f]);
  }
  console.log(`\nrecorded: ${toRecord.length}`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
