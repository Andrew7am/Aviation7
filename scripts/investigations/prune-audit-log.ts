/**
 * Clear audit entries older than a cutoff, after taking a copy of them.
 *
 * The same act the Activity Log's button performs, from the terminal, for a
 * one-off larger than the screen wants to do in a click.
 *
 * The copy is not a nicety. The audit log is the record of who changed what,
 * and it is the one table whose worth comes from nobody being able to edit
 * it; a delete with no file behind it is the only step here that cannot be
 * taken back. So two copies go out first - a spreadsheet to read, and a JSON
 * snapshot that can be inserted straight back - and if either fails nothing
 * is deleted.
 *
 * Dry run by default.
 *
 *   npx tsx scripts/investigations/prune-audit-log.ts --days 30
 *   npx tsx scripts/investigations/prune-audit-log.ts --days 30 --apply
 *   npx tsx scripts/investigations/prune-audit-log.ts --restore scratch/<file>.json
 */
import 'dotenv/config';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const flag = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
const n = (x: number) => x.toLocaleString('en-US');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  /* ── restore ────────────────────────────────────────────────────────── */
  const restore = flag('restore');
  if (restore) {
    const snap = JSON.parse(readFileSync(restore, 'utf8'));
    let back = 0;
    for (const r of snap.rows) {
      const cols = Object.keys(r);
      const marks = cols.map((_, i) => `$${i + 1}`).join(', ');
      // on conflict do nothing: a restore run twice must not fail, and an id
      // already present means that row never needed putting back.
      const res = await c.query(
        `insert into audit_log (${cols.map(k => `"${k}"`).join(', ')}) values (${marks})
         on conflict (id) do nothing`,
        cols.map(k => r[k]));
      back += res.rowCount ?? 0;
    }
    console.log(`restored ${n(back)} of ${n(snap.rows.length)} entries from ${restore}`);
    await c.end();
    return;
  }

  const days = Number(flag('days') ?? 30);
  if (!Number.isFinite(days) || days < 7) {
    console.error('--days must be a number, and never less than 7.');
    process.exit(1);
  }

  const [{ total }] = await q(`select count(*)::int total from audit_log`);
  const rows = await q(
    `select * from audit_log where performed_at < now() - ($1 || ' days')::interval
      order by performed_at`, [days]);

  console.log('='.repeat(88));
  console.log(`AUDIT LOG \u2014 ${has('apply') ? 'CLEARING' : 'DRY RUN'}`);
  console.log('='.repeat(88));
  console.log(`   entries in total       ${n(total).padStart(9)}`);
  console.log(`   older than ${days} days      ${n(rows.length).padStart(9)}`);
  console.log(`   would remain           ${n(total - rows.length).padStart(9)}`);
  if (rows.length) {
    console.log(`   oldest going           ${new Date(rows[0].performed_at).toISOString().slice(0, 10)}`);
    console.log(`   newest going           ${new Date(rows[rows.length - 1].performed_at).toISOString().slice(0, 10)}`);
  }

  console.log('\n   by action:');
  for (const r of await q(
    `select action, count(*)::int k from audit_log
      where performed_at < now() - ($1 || ' days')::interval group by action order by 2 desc`, [days]))
    console.log(`      ${String(r.action).padEnd(20)} ${n(r.k).padStart(7)}`);

  if (!rows.length) { console.log('\nNothing to clear.'); await c.end(); return; }
  if (!has('apply')) {
    console.log('\nDry run. Nothing was written. Add --apply to clear them.');
    await c.end();
    return;
  }

  /* ── the copies, before anything goes ───────────────────────────────── */
  mkdirSync('scratch', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const json = `scratch/audit-pruned-${stamp}.json`;
  writeFileSync(json, JSON.stringify({ takenAt: new Date().toISOString(), days, rows }, null, 2));

  const xlsxPath = `C:/Users/LE.Andrew/Downloads/Audit log cleared ${stamp.slice(0, 10)}.xlsx`;
  const ws = XLSX.utils.json_to_sheet(rows.map((r: any) => ({
    'When': new Date(r.performed_at).toISOString().slice(0, 19).replace('T', ' '),
    'Who': r.actor_email ?? '', 'Action': r.action, 'Type': r.entity_type ?? '',
    'Entity': r.entity ?? '', 'What changed': r.detail ?? '',
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cleared audit entries');
  XLSX.writeFile(wb, xlsxPath);

  console.log(`\n   snapshot   ${json}`);
  console.log(`   spreadsheet ${xlsxPath}`);

  const res = await c.query(
    `delete from audit_log where performed_at < now() - ($1 || ' days')::interval`, [days]);
  const [{ left }] = await q(`select count(*)::int left from audit_log`);

  console.log(`\n   deleted ${n(res.rowCount ?? 0)}, ${n(left)} entries remain.`);
  console.log(`\nTo put them back: npx tsx scripts/investigations/prune-audit-log.ts --restore ${json}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
