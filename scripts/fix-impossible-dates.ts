/**
 * Correct the two tickets whose date could not be true.
 *
 * One reads 1970-01-01 and one 2070-01-01 — the shapes a failed date parse
 * leaves behind, not dates anyone typed. Both are Ibtekar tickets, and both
 * are stated plainly in the agency's own Aviation 1.xlsx:
 *
 *   4860933003  ZAHRA SALLY SOLIMAN AHMED  GIZ-JED  414.00     24/07/2026
 *   4861438353  ABOUREFAY AMR AHMED        AHB-JED  770.99     20/08/2026
 *
 * Each is corroborated a second way. 4860933003 shares its PNR (7HAFXX) with
 * 4860933014, the return leg, already dated 2026-07-24. 4861438353 is followed
 * immediately by 4861438354 — same passenger, same request — dated
 * 2026-08-20.
 *
 * Written here rather than left to a general rule because two rows identified
 * by hand, each read from a named source, is not a pattern to automate.
 *
 *   npx tsx scripts/fix-impossible-dates.ts [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');

const FIXES = [
  { ticketNo: '4860933003', was: '2070-01-01', now: '2026-07-24',
    source: 'Aviation 1.xlsx, INV262545' },
  { ticketNo: '4861438353', was: '1970-01-01', now: '2026-08-20',
    source: 'Aviation 1.xlsx, INV263387' },
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const rows: any[] = [];
  for (const f of FIXES) {
    const { rows: found } = await c.query(
      `select id, ticket_no, source, date, amount::float8 amount, req_num, passenger_name
       from tickets where ticket_no = $1 and date = $2`, [f.ticketNo, f.was]);
    if (found.length !== 1) {
      console.error(`expected exactly one ${f.ticketNo} dated ${f.was}, found ${found.length}`);
      process.exit(1);
    }
    rows.push({ ...found[0], now: f.now, evidence: f.source });
  }

  console.table(rows.map(r => ({
    ticket: r.ticket_no, passenger: r.passenger_name,
    from: r.date, to: r.now, amount: r.amount, evidence: r.evidence,
  })));

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await c.end(); return; }

  const snap = `impossible-dates-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(snap, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nrollback snapshot written: ${snap}`);

  await c.query('begin');
  try {
    let n = 0;
    for (const r of rows) {
      // Guarded on the old value, so a re-run cannot move a date twice.
      const { rowCount } = await c.query(
        `update tickets set date = $2 where id = $1 and date = $3`, [r.id, r.now, r.date]);
      n += rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`APPLIED: ${n} rows corrected.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }

  console.log('\n--- any impossible dates left ---');
  console.table((await c.query(
    `select ticket_no, source, date from tickets
     where date ~ '^\\d{4}-\\d{2}-\\d{2}$'
       and (date < '2024-01-01' or date > current_date::text)`)).rows);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
