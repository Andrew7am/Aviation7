/**
 * Where the IATA wallet stands before its opening balance is reset.
 *
 * A wallet's opening balance is a statement about a moment — "as of this day
 * we hold this much" — so changing it means changing the day too, and every
 * ticket either side of that day changes meaning with it. This prints both
 * sides so the move can be seen before it is made rather than after.
 *
 *   npx tsx scripts/investigations/iata-credit-position.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const [w] = await q(`select * from vendor_balances where vendor_name = 'IATA'`);
  console.log('='.repeat(88));
  console.log('THE IATA WALLET AS IT STANDS');
  console.log('='.repeat(88));
  console.log(`  initial_balance   ${m(w.initial_balance).padStart(16)}`);
  console.log(`  current_balance   ${m(w.current_balance).padStart(16)}`);
  console.log(`  opening_date      ${w.opening_date ? new Date(w.opening_date).toISOString().slice(0, 10) : '(none)'}`);
  console.log(`  id                ${w.id}`);

  const opened = w.opening_date
    ? new Date(w.opening_date).toISOString().slice(0, 10) : null;

  // Which ledger rows this wallet matches. IATA's alias list decides it, and
  // it is worth printing: a wallet that silently covers a second source would
  // be charged for it too.
  const sources = await q(`
    select source, count(*)::int rows, min(date) first_date, max(date) last_date,
           sum(amount)::float8 total
      from tickets where source ilike '%iata%' group by source order by count(*) desc`);
  console.log('\nSOURCES THIS WALLET DRAWS ON');
  console.table(sources.map(r => ({
    source: r.source, rows: r.rows, from: r.first_date, to: r.last_date, total: m(r.total),
  })));

  const [all] = await q(`
    select count(*)::int rows, coalesce(sum(amount),0)::float8 total
      from tickets where source = 'IATA BSP' and upper(coalesce(status,'')) <> 'FUND'`);
  console.log(`\nevery IATA BSP row ever      ${String(all.rows).padStart(6)}  ${m(all.total).padStart(16)}`);

  if (opened) {
    const [after] = await q(`
      select count(*)::int rows, coalesce(sum(amount),0)::float8 total
        from tickets where source = 'IATA BSP' and upper(coalesce(status,'')) <> 'FUND'
          and date >= $1 and date <> ''`, [opened]);
    const [before] = await q(`
      select count(*)::int rows, coalesce(sum(amount),0)::float8 total
        from tickets where source = 'IATA BSP' and upper(coalesce(status,'')) <> 'FUND'
          and (date < $1 or date = '' or date is null)`, [opened]);
    console.log(`  charged to the wallet      ${String(after.rows).padStart(6)}  ${m(after.total).padStart(16)}   (on or after ${opened})`);
    console.log(`  settled before it opened   ${String(before.rows).padStart(6)}  ${m(before.total).padStart(16)}`);
    console.log(`\n  ${m(w.initial_balance)} − ${m(after.total)} = ${m(Number(w.initial_balance) - after.total)}`);
  }

  const tops = await q(
    `select date::text, amount::float8, note from balance_topups where vendor_id = $1 order by date`,
    [w.id]);
  console.log(`\ntop-ups on this wallet: ${tops.length}`);
  for (const t of tops) console.log(`   ${t.date}  ${m(t.amount).padStart(14)}  ${t.note ?? ''}`);

  // What sits in the days a new opening date would have to be chosen around.
  console.log('\nRECENT IATA BSP ACTIVITY');
  const recent = await q(`
    select date, count(*)::int rows, sum(amount)::float8 total
      from tickets where source = 'IATA BSP' and date >= '2026-08-01'
     group by date order by date`);
  console.table(recent.map(r => ({ date: r.date, rows: r.rows, total: m(r.total) })));

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
