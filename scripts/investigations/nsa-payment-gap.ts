/** Our record of what we paid NSA, month by month, against their receipts. */
import 'dotenv/config';
import { Client } from 'pg';
const m = (n: number) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: ours } = await c.query(
    `select left(date, 7) mon, sum(amount)::float8 v, count(*)::int n,
            bool_or(note ilike '%recovered%') lump
       from balance_topups where vendor_name = 'NSA' group by 1 order by 1`);
  const { rows: theirs } = await c.query(
    `select period_start::text ps, paid::float8 paid from vendor_statements
      where vendor_name = 'NSA' order by period_start`);
  const map = new Map(theirs.map((r: any) => [String(r.ps).slice(0, 7), Number(r.paid)]));
  for (const o of ours as any[]) if (!map.has(o.mon)) map.set(o.mon, 0);
  const rows = [...map.keys()].sort().map(k => {
    const o = (ours as any[]).find(x => x.mon === k);
    const mine = o ? o.v : 0, their = map.get(k) ?? 0;
    return { month: k, ours: m(mine), theirs: m(their),
             gap: Math.abs(mine - their) < 0.011 ? '—' : m(mine - their),
             note: o?.lump ? 'holds the recovered lump' : '' };
  });
  console.table(rows);
  const to = (ours as any[]).reduce((n, r) => n + r.v, 0);
  const tt = theirs.reduce((n: number, r: any) => n + Number(r.paid), 0);
  console.log(`ours ${m(to)}   theirs ${m(tt)}   difference ${m(to - tt)}`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
