/**
 * Put two NSA payments back on the day they were received.
 *
 * Both sit in our books at 2026-07-10, which is the day the statement was
 * imported rather than a day anything happened. NSA's own statement carries
 * them with the date cell empty - so at first glance there is nothing to
 * correct them to.
 *
 * There is, though. The statement's running balance walks without a break
 * across all 2,784 steps, so every row's position in it is fixed, and an
 * undated row is therefore bounded by the dated rows either side. Both of
 * these land in a one-day window:
 *
 *   RV-25-10-0730  200,000.00  between 24 and 26 October 2025  -> the 25th
 *   RV-25-11-0041  300,000.00  between 1 and 3 November 2025   -> the 2nd
 *
 * The amounts and the receipt numbers match ours exactly, and correcting them
 * is what makes our October and November agree with the statement's 700,000.00
 * each rather than reading 500,000.00 and 400,000.00 with 500,000.00 stranded
 * eight months later.
 *
 * It matters beyond tidiness: a payment dated after the last statement is
 * money the statement has not seen, so the balance carried forward from it
 * adds them again. September 2026 was reading 1,178,929.46 Cr on an account
 * that closed at 23,704.04 Dr.
 *
 *   npx tsx scripts/investigations/fix-nsa-payment-dates.ts
 *   npx tsx scripts/investigations/fix-nsa-payment-dates.ts --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.find(a => a.startsWith('--snapshot='))?.split('=')[1]
          ?? 'nsa-payment-dates-snapshot.json';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** amount -> the day their statement puts it, and the voucher that says so. */
const KNOWN = [
  { was: '2026-07-10', amount: 200000, now: '2025-10-25', receipt: 'RV-25-10-0730' },
  { was: '2026-07-10', amount: 300000, now: '2025-11-02', receipt: 'RV-25-11-0041' },
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Confirm from the statement itself rather than trusting the table above:
  // the voucher must be there, undated, for that amount, between those days.
  for (const k of KNOWN) {
    const { rows } = await c.query(
      `select source_row_num n, date, credit_sar credit from nsa_rows
        where btrim(doc_no) = $1 or btrim(lpo_number) = $1`, [k.receipt]);
    const ok = rows.length === 1
            && Math.abs(Number(rows[0].credit) - k.amount) < 0.011
            && !String(rows[0].date ?? '').trim();
    console.log(`${k.receipt}: ${ok ? 'confirmed on their statement, undated' : 'NOT AS EXPECTED'}` +
                ` (${rows.length} row(s)${rows.length ? `, credit ${rows[0].credit}, date "${rows[0].date}"` : ''})`);
    if (!ok) { console.error('refusing to write on an assumption that does not hold.'); process.exit(1); }
  }

  const { rows: ours } = await c.query(
    `select id, date, amount::float8 amount, coalesce(note,'') note
       from balance_topups where vendor_name = 'NSA' order by date, amount`);
  console.log(`\nNSA payments recorded: ${ours.length}, ${m(ours.reduce((n: number, r: any) => n + r.amount, 0))}`);

  const fixes: any[] = [];
  const taken = new Set<string>();
  for (const k of KNOWN) {
    const hit = (ours as any[]).find(r => !taken.has(r.id) && r.date === k.was
                                       && Math.abs(r.amount - k.amount) < 0.011);
    if (!hit) { console.log(`   no payment of ${m(k.amount)} at ${k.was} to correct`); continue; }
    taken.add(hit.id);
    fixes.push({ ...k, id: hit.id, note: hit.note });
  }

  console.log(`\nto re-date: ${fixes.length}`);
  console.table(fixes.map(f => ({ amount: m(f.amount), was: f.was, now: f.now, receipt: f.receipt })));

  if (!fixes.length) { await c.end(); return; }
  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  const { rows: before } = await c.query(
    `select id, vendor_name, amount::float8 amount, note, date from balance_topups where id = any($1)`,
    [fixes.map(f => f.id)]);
  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), rows: before }, null, 2));
  console.log(`\nsnapshot: ${SNAP}`);

  await c.query('begin');
  try {
    let n = 0;
    for (const f of fixes) {
      const note = f.note.includes(f.receipt) ? f.note
                 : `${f.note}${f.note ? ' — ' : ''}receipt ${f.receipt}`;
      const r = await c.query(
        `update balance_topups set date = $2, note = $3 where id = $1 and date = $4`,
        [f.id, f.now, note, f.was]);
      n += r.rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`payments re-dated: ${n}`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
