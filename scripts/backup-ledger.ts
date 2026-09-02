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
 * Documents\Aviation Backups.
 *
 * MORE THAN ONE PLACE. Separate folders with a semicolon and every one gets a
 * copy:
 *
 *     BACKUP_DIR=C:\Users\me\Documents\Aviation Backups;G:\My Drive\Aviation Backups
 *
 * The first is where the backup is written and verified, so it should be a
 * local disk that is always there. The others are copies of that finished,
 * checked folder — put a cloud-synced folder among them and the backup leaves
 * the building on its own, because a copy on the same disk as nothing else
 * does not survive that disk failing.
 *
 * A cloud folder that is offline fails only itself. The run still counts as a
 * success if the primary was written, because a backup on one disk beats no
 * backup at all — but the failure is reported and logged, never swallowed.
 *
 * This has to run ON the machine that keeps the files. The web app cannot do
 * it: a page in a browser is not allowed to write to a folder unattended, and
 * the Vercel deployment has no disk of its own to write to.
 *
 *   npx tsx scripts/backup-ledger.ts [--out=<folder>] [--keep=30] [--quiet]
 */
import 'dotenv/config';
import { Client, types } from 'pg';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, cpSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { gzipSync, gunzipSync } from 'zlib';
import * as XLSX from 'xlsx';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const QUIET = process.argv.includes('--quiet');
const KEEP = Number(arg('keep') ?? 30);
/** Every destination, in order. The first is written and verified; the rest
 *  receive a copy of it. Blank entries and stray spaces are ignored so a
 *  trailing semicolon in .env is not an error. */
const DESTS = (arg('out') ?? process.env.BACKUP_DIR ?? join(homedir(), 'Documents', 'Aviation Backups'))
  .split(';').map(s => s.trim()).filter(Boolean);
const ROOT = DESTS[0];
const MIRRORS = DESTS.slice(1);

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

async function main() {
  const started = Date.now();
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try { await c.connect(); } catch (e) { fail(`cannot reach the database — ${(e as Error).message}`); }

  const { rows: tableRows } = await c.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const tables = (tableRows as any[]).map(r => r.table_name as string);
  if (!tables.length) fail('the database reports no tables — refusing to write an empty backup');

  // One stamp for the whole run, so every copy carries the same folder name.
  const stampUsed = stamp();
  const dir = join(ROOT, stampUsed);
  try { mkdirSync(dir, { recursive: true }); }
  catch (e) { fail(`cannot write to ${ROOT} — ${(e as Error).message}`); }
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

  // Copy the finished, checked folder everywhere else. Verification already
  // happened once on the primary, so a mirror is a plain file copy.
  const mirrored: string[] = [];
  for (const m of MIRRORS) {
    try {
      mkdirSync(m, { recursive: true });
      cpSync(dir, join(m, stampUsed), { recursive: true });
      mirrored.push(m);
      say(`  copied to ${m}`);
    } catch (e) {
      // One unreachable copy — a cloud drive not running, a disconnected
      // disk — must not throw away a backup that already succeeded. Say so
      // loudly and carry on.
      console.error(`  ! could not copy to ${m} — ${(e as Error).message}`);
    }
  }

  /** Keep the last KEEP runs. Only folders this script made are considered, so
   *  nothing else living alongside them is ever touched. */
  const sweep = (root: string) => {
    let mine: string[];
    try {
      mine = readdirSync(root)
        .filter(n => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n))
        .filter(n => { try { return statSync(join(root, n)).isDirectory(); } catch { return false; } })
        .sort();
    } catch { return 0; }
    for (const s of mine.slice(0, Math.max(0, mine.length - KEEP))) {
      try { rmSync(join(root, s), { recursive: true, force: true }); say(`  removed old backup ${s} from ${root}`); }
      catch { /* a locked folder is not worth failing a good backup over */ }
    }
    return Math.min(mine.length, KEEP);
  };

  say('');
  for (const root of [ROOT, ...mirrored]) {
    say(`OK — ${sweep(root)} backups kept in ${root}`);
  }
  if (mirrored.length < MIRRORS.length) {
    console.error(`WARNING: ${MIRRORS.length - mirrored.length} of ${MIRRORS.length} copies did not go through.`);
  }
}

main().catch(e => fail((e as Error).message));
