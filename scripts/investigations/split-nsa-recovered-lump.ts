/**
 * Break the recovered lump back into the four payments it was made of.
 *
 * One row in our payment record reads 700,031.50 on 2026-07-11, noted
 * "Recovered from misclassified PAYMENT/FUND/INCREASE rows". That is not a
 * payment made on that day; it is the residue of an earlier cleanup, given the
 * date the cleanup ran.
 *
 * NSA's statement shows exactly four deposits that our record has no row for,
 * and they come to 700,000.00:
 *
 *   2025-07-15                   300,000.00
 *   2026-02-24  RV-26-02-0627    150,000.00
 *   2026-03-12  RV-26-03-0314    150,000.00
 *   2026-04-26  RV-26-04-0593    100,000.00
 *
 * So the lump is those four, and it is dated eight months after the last of
 * them - which is why the balance carried forward from the last statement
 * added 700,000.00 the statement had already accounted for.
 *
 * The 31.50 that is left over is NOT distributed. Nothing says which payment
 * it belongs to, and spreading an unexplained remainder across four real
 * figures to make them add up is how an unexplained remainder stops being
 * visible. It stays as its own row, on the original date, saying what it is.
 * The total is therefore unchanged to the piastre.
 *
 *   npx tsx scripts/investigations/split-nsa-recovered-lump.ts
 *   npx tsx scripts/investigations/split-nsa-recovered-lump.ts --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.find(a => a.startsWith('--snapshot='))?.split('=')[1]
          ?? 'nsa-lump-snapshot.json';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The statement rows the lump stands for: row number, date, receipt, amount. */
const PARTS = [
  { row: 148,  date: '2025-07-15', receipt: '',              amount: 300000 },
  { row: 2579, date: '2026-02-24', receipt: 'RV-26-02-0627', amount: 150000 },
  { row: 2617, date: '2026-03-12', receipt: 'RV-26-03-0314', amount: 150000 },
  { row: 2763, date: '2026-04-26', receipt: 'RV-26-04-0593', amount: 100000 },
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Every part must still be on their statement, for that money, on that day,
  // and must still have no payment of ours against it. Checked here rather
  // than assumed, because this writes 700,000.00 of payment records.
  for (const p of PARTS) {
    const { rows } = await c.query(
      `select date, credit_sar credit, coalesce(lpo_number,'') lpo from nsa_rows where source_row_num = $1`,
      [p.row]);
    const ok = rows.length === 1
            && Math.abs(Number(rows[0].credit) - p.amount) < 0.011
            && String(rows[0].date ?? '').startsWith(p.date)
            && (!p.receipt || String(rows[0].lpo).trim() === p.receipt);
    console.log(`row ${String(p.row).padStart(4)} ${p.date} ${m(p.amount).padStart(12)}` +
                `  ${ok ? 'confirmed on their statement' : 'NOT AS EXPECTED'}`);
    if (!ok) { console.error('refusing to write on an assumption that does not hold.'); process.exit(1); }

    const { rows: mine } = await c.query(
      `select id from balance_topups where vendor_name = 'NSA' and date = $1
         and abs(amount - $2) < 0.011`, [p.date, p.amount]);
    if (mine.length) { console.error(`we already hold a payment of ${m(p.amount)} on ${p.date}.`); process.exit(1); }
  }

  const { rows: lump } = await c.query(
    `select id, date, amount::float8 amount, coalesce(note,'') note, vendor_id, user_id
       from balance_topups where vendor_name = 'NSA' and note ilike '%recovered%'`);
  if (lump.length !== 1) { console.error(`expected one recovered row, found ${lump.length}.`); process.exit(1); }
  const L = lump[0] as any;

  const split = PARTS.reduce((n, p) => n + p.amount, 0);
  const remainder = Math.round((L.amount - split) * 100) / 100;
  console.log(`\nthe lump      ${m(L.amount).padStart(14)}  ${L.date}`);
  console.log(`the four      ${m(split).padStart(14)}`);
  console.log(`left over     ${m(remainder).padStart(14)}  kept as its own row, not spread across the four`);

  const { rows: totalBefore } = await c.query(
    `select coalesce(sum(amount),0)::float8 v, count(*)::int n from balance_topups where vendor_name = 'NSA'`);
  console.log(`\nNSA payments before: ${totalBefore[0].n} row(s), ${m(totalBefore[0].v)}`);
  console.table([...PARTS.map(p => ({ date: p.date, amount: m(p.amount), receipt: p.receipt || '(no voucher printed)' })),
                 { date: L.date, amount: m(remainder), receipt: 'unexplained remainder of the recovered lump' }]);

  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), rows: lump }, null, 2));
  console.log(`\nsnapshot: ${SNAP}`);

  await c.query('begin');
  try {
    const stamp = Date.now();
    let i = 0;
    for (const p of PARTS) {
      await c.query(
        `insert into balance_topups (id, user_id, vendor_id, vendor_name, amount, note, date)
         values ($1, $2, $3, 'NSA', $4, $5, $6)`,
        [`topup_${stamp}_nsa${i++}`, L.user_id, L.vendor_id, p.amount,
         `Payment on NSA's statement${p.receipt ? ` — receipt ${p.receipt}` : ''}` +
         ` (split from the recovered lump of ${m(L.amount)})`, p.date]);
    }
    if (Math.abs(remainder) > 0.001) {
      await c.query(
        `insert into balance_topups (id, user_id, vendor_id, vendor_name, amount, note, date)
         values ($1, $2, $3, 'NSA', $4, $5, $6)`,
        [`topup_${stamp}_nsarem`, L.user_id, L.vendor_id, remainder,
         `Unexplained remainder of the recovered lump of ${m(L.amount)} — ` +
         `the four payments it stands for come to ${m(split)}`, L.date]);
    }
    await c.query(`delete from balance_topups where id = $1`, [L.id]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exit(1);
  }

  const { rows: after } = await c.query(
    `select coalesce(sum(amount),0)::float8 v, count(*)::int n from balance_topups where vendor_name = 'NSA'`);
  console.log(`NSA payments after : ${after[0].n} row(s), ${m(after[0].v)}`);
  console.log(`total moved by     : ${m(after[0].v - totalBefore[0].v)}`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
