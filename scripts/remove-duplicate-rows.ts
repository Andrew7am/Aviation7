/**
 * Remove rows that are the same transaction stored twice.
 *
 * "The same" is deliberately strict: identical vendor, identical document
 * number, identical direction, identical money AND identical date. Anything
 * less is not a duplicate in this ledger.
 *
 * The direction is part of that key for a specific reason. A ticket and its
 * refund carry the SAME document number — that is how a refund is linked to
 * the sale it reverses — so a rule that matched on the document number alone
 * would delete one leg of every refunded ticket and silently rewrite the
 * accounts. Grouping on status keeps an ISSUE and a REFUND in separate groups
 * no matter what, and the script refuses to run if a group ever contains more
 * than one direction.
 *
 * These pairs were invisible until the dates were recovered: one copy had no
 * date, so it did not match the other on any key the system checks. Filling the
 * dates is what made them findable.
 *
 * Of each group the richest row is kept — the one carrying the vendor's serial,
 * PNR and reference — and the thinner copies go. The whole row is written to a
 * snapshot first, so a deletion can be undone in full.
 *
 *   npx tsx scripts/remove-duplicate-rows.ts [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** How much a row actually tells us — the copy that knows most is the keeper. */
function richness(r: any): number {
  return (r.serial != null ? 4 : 0)
       + (r.pnr ? 2 : 0)
       + (r.req_num ? 1 : 0)
       + (r.passenger_name ? 1 : 0)
       + (r.route ? 1 : 0)
       + (r.vendor_reference ? 1 : 0)
       + (r.airline_code ? 1 : 0);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select * from tickets
     where status <> 'FUND'
       and (ticket_no, source, status, amount, date) in (
         select ticket_no, source, status, amount, date from tickets
         where status <> 'FUND'
         group by 1,2,3,4,5 having count(*) > 1)
     order by ticket_no, source, status, amount, date`);

  const groups = new Map<string, any[]>();
  for (const r of rows as any[]) {
    const k = `${r.ticket_no}|${r.source}|${r.status}|${r.amount}|${r.date}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  console.log(`groups of identical rows: ${groups.size}\n`);
  if (!groups.size) { console.log('nothing to do.'); await c.end(); return; }

  const doomed: any[] = [];
  for (const [k, g] of groups) {
    // Belt and braces on top of grouping by status: never touch a group that
    // somehow holds both a sale and a refund.
    const directions = new Set(g.map(r => r.status));
    if (directions.size > 1) {
      console.error(`REFUSING: ${k} holds more than one direction (${[...directions].join(', ')})`);
      process.exit(1);
    }
    const sorted = [...g].sort((a, b) => richness(b) - richness(a));
    const keep = sorted[0];
    const drop = sorted.slice(1);

    console.log(`${keep.ticket_no} | ${keep.source} | ${keep.status} | ${money(Number(keep.amount))} | ${keep.date}`);
    console.log(`   KEEP  serial ${keep.serial ?? '—'} pnr ${keep.pnr || '—'} req ${keep.req_num || '—'} imported ${keep.import_time}`);
    for (const d of drop) {
      console.log(`   DROP  serial ${d.serial ?? '—'} pnr ${d.pnr || '—'} req ${d.req_num || '—'} imported ${d.import_time}`);
      doomed.push(d);
    }
  }

  const byStatus: Record<string, { rows: number; value: number }> = {};
  for (const d of doomed) {
    byStatus[d.status] ??= { rows: 0, value: 0 };
    byStatus[d.status].rows++;
    byStatus[d.status].value += Number(d.amount);
  }
  console.log('\n--- what removing these changes ---');
  console.table(Object.entries(byStatus).map(([status, v]) =>
    ({ status, rows: v.rows, 'value removed': money(v.value) })));
  console.log(`total rows to delete: ${doomed.length}`);

  if (!APPLY) { console.log('\nDRY RUN — nothing deleted. Re-run with --apply.'); await c.end(); return; }

  const snap = `duplicate-rows-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(snap, JSON.stringify({ takenAt: new Date().toISOString(), rows: doomed }, null, 2));
  console.log(`\nfull rows written to ${snap} — restorable in their entirety`);

  await c.query('begin');
  try {
    const { rowCount } = await c.query(
      'delete from tickets where id = any($1)', [doomed.map(d => d.id)]);
    await c.query('commit');
    console.log(`APPLIED: ${rowCount} rows deleted.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing deleted:', e);
    process.exitCode = 1;
  }

  const left = await c.query(
    `select count(*)::int n from (
       select 1 from tickets where status <> 'FUND'
       group by ticket_no, source, status, amount, date having count(*) > 1) x`);
  console.log(`identical groups remaining: ${left.rows[0].n}`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
