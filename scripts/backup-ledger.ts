/**
 * Take a complete, restorable copy of the ledger onto this machine.
 *
 * The data lives in one place — a hosted Postgres — and the only copy the
 * agency held was whatever someone remembered to download. This writes every
 * table, verifies what it wrote, and keeps a rolling history, so losing the
 * database costs a day of work rather than the business.
 *
 * WHERE IT WRITES. A folder on this PC, one per run, named by date and time:
 *
 *     <backup folder>/2026-09-02_1130/
 *         tickets.json          every row, exactly as stored
 *         vendor_balances.json
 *         ... one file per table ...
 *         Aviation-Backup-2026-09-02.xlsx   the readable version
 *         manifest.json         row counts and when it ran
 *
 * The folder is chosen in this order: --out=, then BACKUP_DIR in .env, then
 * Documents\Aviation Backups. Point it at a OneDrive or Google Drive folder
 * and the copy leaves the building for free — a backup sitting on the same
 * disk as nothing else survives the disk dying.
 *
 * This has to run ON the machine that keeps the files. The web app cannot do
 * it: a page in a browser is not allowed to write to a folder unattended, and
 * the Vercel deployment has no disk of its own to write to.
 *
 *   npx tsx scripts/backup-ledger.ts [--out=<folder>] [--keep=30] [--quiet]
 */
import 'dotenv/config';
import { Client, types } from 'pg';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { gzipSync, gunzipSync } from 'zlib';
import * as XLSX from 'xlsx';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const QUIET = process.argv.includes('--quiet');
const KEEP = Number(arg('keep') ?? 30);
const ROOT = arg('out') ?? process.env.BACKUP_DIR ?? join(homedir(), 'Documents', 'Aviation Backups');

const say = (...m: unknown[]) => { if (!QUIET) console.log(...m); };
const fail = (m: string) => { console.error(`BACKUP FAILED: ${m}`); process.exit(1); };

/**
 * Take timestamps as the text Postgres wrote, not as JavaScript Dates.
 *
 * Postgres keeps microseconds; a JS Date keeps milliseconds. Letting the
 * driver convert threw away the last three digits of every timestamp in the
 * database — 23:53:57.824539 came back as 23:53:57.824 — so a restore silently
 * moved every created_at by up to a millisecond. Read as text, they survive
 * exactly, and Postgres parses the same text back on the way in.
 *
 * Numerics are already handed over as strings by this driver, which is what
 * keeps a balance of 10547.010000000002 from becoming a float.
 */
types.setTypeParser(1114, v => v);   // timestamp
types.setTypeParser(1184, v => v);   // timestamptz
types.setTypeParser(1082, v => v);   // date
types.setTypeParser(1083, v => v);   // time

/** 2026-09-02_1130 — sorts chronologically as text, which is what the
 *  retention sweep relies on. */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

(async () => {
  const started = Date.now();
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try { await c.connect(); } catch (e) { fail(`cannot reach the database — ${(e as Error).message}`); }

  const { rows: tableRows } = await c.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const tables = (tableRows as any[]).map(r => r.table_name as string);
  if (!tables.length) fail('the database reports no tables — refusing to write an empty backup');

  const dir = join(ROOT, stamp());
  mkdirSync(dir, { recursive: true });
  say(`writing to ${dir}\n`);

  // Gzipped by default: the audit log alone is 7MB of JSON and compresses
  // about tenfold, which is the difference between 600MB and 60MB of daily
  // history. Windows opens a .gz with any archiver, and --raw writes plain
  // .json when someone wants to grep it directly.
  const RAW = process.argv.includes('--raw');
  const ext = RAW ? 'json' : 'json.gz';

  const counts: Record<string, number> = {};
  const dumped: Record<string, any[]> = {};
  for (const t of tables) {
    const { rows } = await c.query(`select * from "${t}"`);
    counts[t] = rows.length;
    dumped[t] = rows;
    const body = JSON.stringify(rows, null, 2);
    writeFileSync(join(dir, `${t}.${ext}`), RAW ? body : gzipSync(body, { level: 9 }));
    say(`  ${t.padEnd(30)} ${String(rows.length).padStart(7)} rows`);
  }
  await c.end();

  // A spreadsheet for reading. The JSON above is what a restore reads; this is
  // for a human who wants to look without a database.
  const wb = XLSX.utils.book_new();
  const sheet = (name: string, rows: any[]) => {
    if (!rows.length) return;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  };
  sheet('Tickets', dumped.tickets ?? []);
  sheet('Vendor Balances', dumped.vendor_balances ?? []);
  sheet('Top-ups', dumped.balance_topups ?? []);
  sheet('Import History', dumped.import_history ?? []);
  if (wb.SheetNames.length) {
    XLSX.writeFile(wb, join(dir, `Aviation-Backup-${stamp().slice(0, 10)}.xlsx`));
  }

  // Read back what was written. A backup nobody has ever opened is a guess,
  // and a truncated write looks exactly like a good one until the day it is
  // needed.
  let verified = 0;
  for (const t of tables) {
    const path = join(dir, `${t}.${ext}`);
    let back: any[];
    try {
      const buf = readFileSync(path);
      back = JSON.parse(RAW ? buf.toString('utf8') : gunzipSync(buf).toString('utf8'));
    } catch (e) { fail(`${t}.${ext} cannot be read back — ${(e as Error).message}`); return; }
    if (back.length !== counts[t]) fail(`${t}.${ext} holds ${back.length} rows, the database had ${counts[t]}`);
    verified++;
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    takenAt: new Date().toISOString(),
    tables: counts,
    totalRows: total,
    format: RAW ? 'json' : 'json.gz',
    verified: true,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  }, null, 2));

  say(`\nverified ${verified} tables, ${total.toLocaleString('en-US')} rows total`);

  // Keep the last KEEP runs. Only folders this script made are considered, so
  // nothing else living in the backup folder is ever touched.
  const mine = readdirSync(ROOT)
    .filter(n => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n))
    .filter(n => { try { return statSync(join(ROOT, n)).isDirectory(); } catch { return false; } })
    .sort();
  const stale = mine.slice(0, Math.max(0, mine.length - KEEP));
  for (const s of stale) {
    rmSync(join(ROOT, s), { recursive: true, force: true });
    say(`  removed old backup ${s}`);
  }

  say(`\nOK — ${mine.length - stale.length} backups kept in ${ROOT}`);
})().catch(e => fail((e as Error).message));
