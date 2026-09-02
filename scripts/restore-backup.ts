/**
 * Put a backup back.
 *
 * The companion to backup-ledger.ts, and the reason that script can be
 * trusted: a backup nobody has ever restored is a guess about the future. This
 * reads a backup folder, says exactly what it would replace, and only writes
 * when told twice.
 *
 * ORDER MATTERS. Fifteen foreign keys tie these tables together — every
 * vendor's raw rows hang off vendor_imports, which hangs off vendors. The
 * order is worked out from the database's own constraints at run time rather
 * than written down here, so it stays right when the schema changes: parents
 * are filled first, and emptied last.
 *
 * Everything happens in ONE transaction. A restore that fails halfway would
 * leave the ledger in a state that never existed, which is worse than the
 * problem it was trying to fix.
 *
 *   npx tsx scripts/restore-backup.ts                        # newest backup, dry run
 *   npx tsx scripts/restore-backup.ts --from=<folder>
 *   npx tsx scripts/restore-backup.ts --tables=tickets
 *   npx tsx scripts/restore-backup.ts --apply --i-know-this-replaces-live-data
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { gunzipSync } from 'zlib';

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes('--apply');
const CONFIRMED = process.argv.includes('--i-know-this-replaces-live-data');
const ROOT = process.env.BACKUP_DIR ?? join(homedir(), 'Documents', 'Aviation Backups');
const ONLY = arg('tables')?.split(',').map(s => s.trim()).filter(Boolean);

const fail = (m: string) => { console.error(`RESTORE FAILED: ${m}`); process.exit(1); };

/** Newest backup folder, when none was named. */
function newestBackup(): string {
  if (!existsSync(ROOT)) fail(`no backup folder at ${ROOT}`);
  const dirs = readdirSync(ROOT)
    .filter(n => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n))
    .filter(n => statSync(join(ROOT, n)).isDirectory())
    .sort();
  if (!dirs.length) fail(`no backups found in ${ROOT}`);
  return join(ROOT, dirs[dirs.length - 1]);
}

export function readTable(dir: string, table: string): any[] | null {
  for (const ext of ['json.gz', 'json']) {
    const p = join(dir, `${table}.${ext}`);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    return JSON.parse(ext === 'json.gz' ? gunzipSync(buf).toString('utf8') : buf.toString('utf8'));
  }
  return null;
}

/** Parents before children, from the live constraint graph. */
export function dependencyOrder(tables: string[], edges: { child: string; parent: string }[]): string[] {
  const deps = new Map(tables.map(t => [t, new Set<string>()]));
  for (const e of edges) {
    if (e.child === e.parent) continue;              // self-reference imposes no order
    deps.get(e.child)?.add(e.parent);
  }
  const out: string[] = [];
  const done = new Set<string>();
  let guard = tables.length + 1;
  while (out.length < tables.length && guard-- > 0) {
    for (const t of tables) {
      if (done.has(t)) continue;
      const need = deps.get(t)!;
      if ([...need].every(p => done.has(p) || !deps.has(p))) { out.push(t); done.add(t); }
    }
  }
  // A cycle would leave some out; append them so nothing is silently dropped.
  for (const t of tables) if (!done.has(t)) out.push(t);
  return out;
}

/**
 * Write rows back into a table, batched.
 *
 * Column names come from the backup itself rather than a list written here, so
 * a table that gained a column since the script was written still round-trips.
 * Batched because one statement per row is slow and one statement for fifteen
 * thousand rows exceeds what the driver will bind.
 */
export async function insertRows(c: Client, table: string, rows: any[], batch = 500): Promise<number> {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const quoted = cols.map(k => `"${k}"`).join(', ');
  let written = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const values: any[] = [];
    const tuples = slice.map((_, ri) =>
      `(${cols.map((__, ci) => `$${ri * cols.length + ci + 1}`).join(', ')})`);
    for (const r of slice) for (const k of cols) values.push(r[k]);
    const res = await c.query(`insert into "${table}" (${quoted}) values ${tuples.join(', ')}`, values);
    written += res.rowCount ?? 0;
  }
  return written;
}

async function main() {
  const dir = arg('from') ?? newestBackup();
  if (!existsSync(dir)) fail(`no such backup folder: ${dir}`);

  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`${dir} has no manifest.json — not a backup made by backup-ledger.ts`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(`backup: ${dir}`);
  console.log(`taken:  ${manifest.takenAt}`);
  console.log(`holds:  ${Object.keys(manifest.tables).length} tables, ${manifest.totalRows.toLocaleString('en-US')} rows\n`);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: liveTables } = await c.query(
    `select table_name from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE' order by 1`);
  const live = (liveTables as any[]).map(r => r.table_name as string);

  const wanted = (ONLY ?? Object.keys(manifest.tables)).filter(t => {
    if (!live.includes(t)) { console.log(`  skipping ${t} — no such table in the database now`); return false; }
    return true;
  });
  if (!wanted.length) fail('nothing to restore');

  const { rows: fkRows } = await c.query(
    `select tc.table_name as child, ccu.table_name as parent
     from information_schema.table_constraints tc
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name
     where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'`);
  const order = dependencyOrder(wanted, fkRows as any[]);

  console.log('--- what this would replace ---');
  const plan: { table: string; inBackup: number; liveNow: number }[] = [];
  for (const t of order) {
    const rows = readTable(dir, t);
    if (rows === null) { console.log(`  ${t}: MISSING from the backup — skipped`); continue; }
    const { rows: [{ n }] } = await c.query(`select count(*)::int n from "${t}"`);
    plan.push({ table: t, inBackup: rows.length, liveNow: n });
  }
  console.table(plan.map(p => ({
    table: p.table, 'in backup': p.inBackup, 'live now': p.liveNow,
    change: p.inBackup - p.liveNow > 0 ? `+${p.inBackup - p.liveNow}` : String(p.inBackup - p.liveNow),
  })));

  if (!APPLY || !CONFIRMED) {
    console.log('\nDRY RUN — nothing written.');
    console.log('To restore, re-run with:  --apply --i-know-this-replaces-live-data');
    console.log('Every row in the tables above is DELETED and replaced by the backup.');
    await c.end();
    return;
  }

  console.log('\nrestoring inside one transaction...');
  await c.query('begin');
  try {
    // Audit triggers must not fire during a restore. `tickets` and
    // `vendor_balances` both write an audit row on delete, so putting the
    // ledger back would append thousands of entries saying every ticket was
    // deleted — a history of the repair, written over the history being
    // repaired. Replica mode also suspends foreign key checks; the dependency
    // ordering below is kept anyway, so the restore still works where this
    // setting is not permitted.
    let quiet = true;
    try { await c.query(`set local session_replication_role = 'replica'`); }
    catch { quiet = false; }
    if (!quiet) {
      console.log('  ! could not suspend triggers — the audit log will record this restore');
    }

    // Children emptied first, parents last — the reverse of the fill order.
    for (const t of [...order].reverse()) {
      if (!plan.some(p => p.table === t)) continue;
      await c.query(`delete from "${t}"`);
    }
    for (const t of order) {
      const rows = readTable(dir, t);
      if (!rows?.length) continue;
      await insertRows(c, t, rows);
      console.log(`  ${t.padEnd(30)} ${String(rows.length).padStart(7)} rows restored`);
    }
    await c.query('commit');
    console.log('\nRESTORED.');
  } catch (e) {
    await c.query('rollback');
    fail(`rolled back, the database is untouched — ${(e as Error).message}`);
  }
  await c.end();
}

// Only run when invoked directly — the helpers above are imported by the test.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('restore-backup.ts')) {
  main().catch(e => fail((e as Error).message));
}
