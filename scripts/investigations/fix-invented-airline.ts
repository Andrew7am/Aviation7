/**
 * The one ticket still carrying an airline code taken from its own serial.
 *
 * 4861877852 was keyed by hand before the manual-entry form stopped inventing
 * a code, and it took "486" off the front of the document number. Ibtekar's
 * statement of account bills the same document as 593 - 4861877852, so the
 * carrier is flynas and the code is known rather than guessed.
 *
 *   npx tsx scripts/investigations/fix-invented-airline.ts
 *   npx tsx scripts/investigations/fix-invented-airline.ts --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.find(a => a.startsWith('--snapshot='))?.split('=')[1]
          ?? 'invented-airline-snapshot.json';

/** ticket number -> the code the vendor's own document gives it. */
const KNOWN: Record<string, string> = { '4861877852': '593' };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Every row whose code is the first three digits of its own serial.
  const { rows } = await c.query(
    `select id, ticket_no, airline_code, source, date::text date,
            amount::float8 amount, coalesce(vendor_reference,'') vref
       from tickets
      where airline_code is not null and airline_code <> ''
        and left(regexp_replace(ticket_no, '\\D', '', 'g'), 3) = airline_code
        and length(regexp_replace(ticket_no, '\\D', '', 'g')) = 10`);

  console.log(`rows whose code came out of their own serial: ${rows.length}`);
  console.table(rows.map((r: any) => ({
    ticket: r.ticket_no, source: r.source, was: r.airline_code,
    now: KNOWN[r.ticket_no] ?? '(unknown - left alone)',
    date: r.date, amount: r.amount.toFixed(2), ref: r.vref,
  })));

  const doable = rows.filter((r: any) => KNOWN[r.ticket_no]);
  if (!doable.length) { console.log('nothing to correct.'); await c.end(); return; }
  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), rows: doable }, null, 2));
  console.log(`\nsnapshot: ${SNAP}`);

  await c.query('begin');
  try {
    let n = 0;
    for (const r of doable as any[]) {
      const res = await c.query(
        `update tickets set airline_code = $2 where id = $1 and airline_code = $3`,
        [r.id, KNOWN[r.ticket_no], r.airline_code]);
      n += res.rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`rows updated: ${n}`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
