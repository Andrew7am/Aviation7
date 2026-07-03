/**
 * run-supabase-migrations.ts
 *
 * One command to take a fresh Supabase project from empty to fully seeded with
 * the canonical Aviation vendor workbook. Does NOT require the Supabase CLI or
 * psql — talks straight to Postgres via `pg`.
 *
 * Steps:
 *   1. Runs every file in supabase/migrations/*.sql, in filename order.
 *   2. Loads every CSV in supabase/seed_data/*_rows.csv into its <vendor>_rows
 *      table, wrapped in a vendor_imports row for provenance. Idempotent —
 *      reruns clear each vendor's rows before reloading.
 *
 * Requires DATABASE_URL in the environment (see .env.example). Run:
 *   npx tsx scripts/run-supabase-migrations.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL in .env (see .env.example) — get it from Supabase: Project Settings -> Database -> Connection string -> URI.');
  process.exit(1);
}

const ROOT = resolve(process.cwd(), 'supabase');
const MIGRATIONS_DIR = resolve(ROOT, 'migrations');
const SEED_DIR = resolve(ROOT, 'seed_data');

async function runMigrations(client: Client) {
  await client.query(`
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    );
  `);
  const applied = new Set(
    (await client.query('select filename from schema_migrations')).rows.map(r => r.filename)
  );

  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`migrating ${f} ... already applied, skipping`);
      continue;
    }
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    process.stdout.write(`migrating ${f} ... `);
    await client.query(sql);
    await client.query('insert into schema_migrations (filename) values ($1)', [f]);
    console.log('ok');
  }
}

async function seedVendor(client: Client, vendor: string) {
  const csvPath = resolve(SEED_DIR, `${vendor}_rows.csv`);
  const csv = readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    throw new Error(`${vendor}: CSV parse errors: ${JSON.stringify(parsed.errors.slice(0, 3))}`);
  }
  const rows = parsed.data;
  if (rows.length === 0) {
    console.log(`${vendor}: no rows, skipping`);
    return;
  }
  const columns = Object.keys(rows[0]).filter(c => c !== 'source_row_num');
  const table = `${vendor}_rows`;

  const importResult = await client.query(
    `insert into vendor_imports (vendor_slug, source_file, imported_by, row_count)
     values ($1, $2, $3, $4) returning id`,
    [vendor, 'Aviation 1 (2).xlsx', 'seed', rows.length]
  );
  const vendorImportId = importResult.rows[0].id;

  await client.query(`delete from ${table}`);

  const allCols = ['vendor_import_id', 'source_row_num', ...columns];
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples: string[] = [];
    chunk.forEach((row, idx) => {
      const base = idx * allCols.length;
      const placeholders = allCols.map((_, j) => `$${base + j + 1}`);
      tuples.push(`(${placeholders.join(', ')})`);
      values.push(vendorImportId, Number(row.source_row_num));
      for (const c of columns) values.push(row[c] ?? null);
    });
    const sql = `insert into ${table} (${allCols.join(', ')}) values ${tuples.join(', ')}`;
    await client.query(sql, values);
  }
  console.log(`${vendor}: ${rows.length} rows loaded`);
}

async function runSeed(client: Client) {
  const csvs = readdirSync(SEED_DIR).filter(f => f.endsWith('_rows.csv'));
  const vendors = csvs.map(f => f.replace(/_rows\.csv$/, '')).sort();
  for (const v of vendors) {
    await seedVendor(client, v);
  }
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log('=== running migrations ===');
    await runMigrations(client);
    console.log('=== seeding vendor data ===');
    await runSeed(client);
    console.log('=== done ===');
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
