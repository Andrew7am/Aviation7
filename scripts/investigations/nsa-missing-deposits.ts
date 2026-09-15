/** The deposits on NSA's statement that our own payment record has no row for. */
import 'dotenv/config';
import { Client } from 'pg';
const m = (n: number) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => { const s = String(v ?? '').trim().replace(/,/g, ''); const n = Number(s); return s && Number.isFinite(n) ? n : 0; };
const iso = (v: unknown) => { const s = String(v ?? '').trim(); const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return x ? x[0] : ''; };
const isDeposit = (r: any) => {
  const doc = String(r.doc_no ?? '').trim(), lpo = String(r.lpo ?? '').trim();
  return /^RV-/i.test(doc) || /^RV-/i.test(lpo) || /payment/i.test(String(r.description ?? '')) || (!doc && !lpo);
};
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select source_row_num n, date, doc_no, description, lpo_number lpo, credit_sar credit
       from nsa_rows where credit_sar ~ '[0-9]' order by source_row_num`);
  const dep = (rows as any[]).filter(r => num(r.credit) > 0 && isDeposit(r));
  const { rows: ours } = await c.query(
    `select date, amount::float8 amount, coalesce(note,'') note from balance_topups
      where vendor_name = 'NSA' order by date`);
  const taken = new Set<number>();
  const unmatched: any[] = [];
  for (const d of dep) {
    const day = iso(d.date);
    const hit = (ours as any[]).findIndex((o, i) => !taken.has(i) && o.date === day
      && Math.abs(o.amount - num(d.credit)) < 0.011);
    if (hit >= 0) { taken.add(hit); continue; }
    unmatched.push(d);
  }
  console.log(`deposits on their statement : ${dep.length}, ${m(dep.reduce((a, r) => a + num(r.credit), 0))}`);
  console.log(`matched to one of ours      : ${dep.length - unmatched.length}`);
  console.log(`no payment of ours on that day: ${unmatched.length}, ${m(unmatched.reduce((a, r) => a + num(r.credit), 0))}\n`);
  console.table(unmatched.map(r => ({
    row: r.n, date: iso(r.date) || '(none)',
    doc: String(r.doc_no ?? '').trim() || '(blank)',
    lpo: String(r.lpo ?? '').trim() || '(blank)',
    desc: String(r.description ?? '').trim().slice(0, 24) || '(blank)',
    credit: m(num(r.credit)),
  })));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
