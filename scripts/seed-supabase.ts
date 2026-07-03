/**
 * seed-supabase.ts
 *
 * Alternative to running supabase/seed.sql via psql: reads each vendor CSV in
 * supabase/seed_data/ and inserts it via the Supabase REST API using the service
 * role key. Requires:
 *
 *   SUPABASE_URL=https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role_secret>
 *
 * Run:  npx tsx scripts/seed-supabase.ts
 *
 * Assumes the 0001..0012 migrations have already run against the target project.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_DIR = resolve(process.cwd(), 'supabase/seed_data');
const BATCH = 500;

async function seedVendor(vendor: string) {
  const csvPath = resolve(SEED_DIR, `${vendor}_rows.csv`);
  const csv = readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (parsed.errors.length) {
    console.error(`${vendor}: parse errors`, parsed.errors.slice(0, 3));
    return;
  }
  const rows = parsed.data.map(r => ({
    ...r,
    source_row_num: Number(r.source_row_num),
  }));

  const { data: importRow, error: impErr } = await supa
    .from('vendor_imports')
    .insert({
      vendor_slug: vendor,
      source_file: 'Aviation 1 (2).xlsx',
      imported_by: 'seed',
      row_count: rows.length,
    })
    .select('id')
    .single();
  if (impErr || !importRow) throw new Error(`vendor_imports insert failed for ${vendor}: ${impErr?.message}`);
  const vendorImportId = importRow.id;

  const { error: delErr } = await supa.from(`${vendor}_rows`).delete().neq('source_row_num', -1);
  if (delErr) throw new Error(`clear ${vendor}_rows failed: ${delErr.message}`);

  const tagged = rows.map(r => ({ ...r, vendor_import_id: vendorImportId }));
  for (let i = 0; i < tagged.length; i += BATCH) {
    const chunk = tagged.slice(i, i + BATCH);
    const { error } = await supa.from(`${vendor}_rows`).insert(chunk);
    if (error) throw new Error(`insert ${vendor}_rows chunk ${i}: ${error.message}`);
  }
  console.log(`${vendor}: ${rows.length} rows inserted`);
}

async function main() {
  const csvs = readdirSync(SEED_DIR).filter(f => f.endsWith('_rows.csv'));
  const vendors = csvs.map(f => f.replace(/_rows\.csv$/, '')).sort();
  for (const v of vendors) {
    await seedVendor(v);
  }
  console.log('seed complete');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
