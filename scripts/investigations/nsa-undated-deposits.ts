/** An undated row in a running-balance statement sits between its neighbours,
 *  so its date is bounded even when the vendor left the cell empty. */
import 'dotenv/config';
import { Client } from 'pg';
const m = (n: number) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => { const s = String(v ?? '').trim().replace(/,/g, ''); const n = Number(s); return s && Number.isFinite(n) ? n : 0; };
const iso = (v: unknown) => { const s = String(v ?? '').trim(); const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return x ? x[0] : ''; };
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select source_row_num n, date, doc_no, description, lpo_number lpo,
            debit_sar debit, credit_sar credit, c_0utstanding_balances balance
       from nsa_rows order by source_row_num`);
  const R = rows as any[];
  console.log('every row with no date:');
  for (let i = 0; i < R.length; i++) {
    if (iso(R[i].date)) continue;
    let before = '', after = '';
    for (let j = i - 1; j >= 0; j--) { const d = iso(R[j].date); if (d) { before = d; break; } }
    for (let j = i + 1; j < R.length; j++) { const d = iso(R[j].date); if (d) { after = d; break; } }
    console.log(`  row ${String(R[i].n).padStart(5)}  doc ${String(R[i].doc_no ?? '').padEnd(18).slice(0,18)}` +
      ` debit ${m(num(R[i].debit)).padStart(12)} credit ${m(num(R[i].credit)).padStart(12)}` +
      `   sits between ${before || '(start)'} and ${after || '(end)'}`);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
