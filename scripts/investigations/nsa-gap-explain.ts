/** Where the 32,940.30 between the two NSA balances comes from. */
import 'dotenv/config';
import { Client } from 'pg';
const m = (n: number) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const END = '2026-06-30';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows[0];
  const w = await q(`select initial_balance::float8 v from vendor_balances where vendor_name='NSA'`);
  const payBefore = await q(`select coalesce(sum(amount),0)::float8 v, count(*)::int n from balance_topups
     where vendor_name='NSA' and date <> '' and date <= $1`, [END]);
  const tkBefore = await q(`select coalesce(sum(amount),0)::float8 v, count(*)::int n from tickets
     where source='NSA' and date is not null and date <> '' and date <= $1`, [END]);
  const tkUndated = await q(`select coalesce(sum(amount),0)::float8 v, count(*)::int n from tickets
     where source='NSA' and (date is null or date = '')`);
  const payUndated = await q(`select coalesce(sum(amount),0)::float8 v, count(*)::int n from balance_topups
     where vendor_name='NSA' and (date is null or date = '')`);
  const theirClosing = -23704.04;

  const ours = w.v + payBefore.v - tkBefore.v;
  console.log(`our own rows up to ${END}`);
  console.log(`   initial                 ${m(w.v).padStart(16)}`);
  console.log(`   + payments              ${m(payBefore.v).padStart(16)}  (${payBefore.n})`);
  console.log(`   - tickets               ${m(tkBefore.v).padStart(16)}  (${tkBefore.n})`);
  console.log(`   = our balance           ${m(ours).padStart(16)}`);
  console.log(`   their stated balance    ${m(theirClosing).padStart(16)}`);
  console.log(`   difference              ${m(ours - theirClosing).padStart(16)}\n`);
  console.log(`undated NSA tickets        ${m(tkUndated.v).padStart(16)}  (${tkUndated.n})`);
  console.log(`undated NSA payments       ${m(payUndated.v).padStart(16)}  (${payUndated.n})`);

  const their = await q(`select coalesce(sum(billed),0)::float8 b, coalesce(sum(paid),0)::float8 p
     from vendor_statements where vendor_name='NSA'`);
  console.log(`\ntheir statements: billed ${m(their.b)}, paid ${m(their.p)}`);
  console.log(`our rows in the same window: billed ${m(tkBefore.v - (await q(`select coalesce(sum(amount),0)::float8 v from tickets where source='NSA' and date < '2025-06-01' and date <> ''`)).v)}`);
  const early = await q(`select coalesce(sum(amount),0)::float8 v, count(*)::int n from tickets
     where source='NSA' and date <> '' and date < '2025-06-01'`);
  console.log(`our NSA tickets before the first statement: ${m(early.v)} (${early.n})`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
