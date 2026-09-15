/** The 32,940.30 between the wallet and the statement, taken apart. */
import 'dotenv/config';
import { Client } from 'pg';
const m = (n: number) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const w = (await q(`select initial_balance::float8 v from vendor_balances where vendor_name='NSA'`))[0];
  const openingBF = -92163.77;
  console.log('1. THE OPENING BALANCE');
  console.log(`   our wallet's initial     ${m(w.v).padStart(14)}`);
  console.log(`   their statement's B/F    ${m(openingBF).padStart(14)}`);
  console.log(`   difference               ${m(w.v - openingBF).padStart(14)}`);

  console.log('\n2. UNDATED NSA TICKETS — in the wallet, in no period');
  const und = await q(`select ticket_no, amount::float8 amount, status, coalesce(req_num,'') req,
                              coalesce(passenger_name,'') pax, coalesce(vendor_reference,'') ref
                         from tickets where source='NSA' and (date is null or date='')`);
  console.table(und.map((r: any) => ({ ticket: r.ticket_no, amount: m(r.amount), status: r.status,
    req: r.req, pax: r.pax.slice(0, 22), ref: r.ref })));
  // Are they on NSA's statement, and when?
  for (const r of und as any[]) {
    const serial = String(r.ticket_no).replace(/\D/g, '').slice(-10);
    const hit = await q(
      `select source_row_num n, date, doc_no, debit_sar d, credit_sar cr from nsa_rows
        where regexp_replace(coalesce(doc_no,''), '\D', '', 'g') like '%' || $1 || '%'`, [serial]);
    console.log(`   ${r.ticket_no}: ${hit.length} row(s) on their statement` +
      (hit.length ? ` → ${hit.map((h: any) => `${String(h.date).slice(0,10) || '(undated)'} d=${h.d} c=${h.cr}`).join(' | ')}` : ''));
  }

  console.log('\n3. THE 7,887.00 IN AUGUST 2025');
  const aug = await q(
    `select source_row_num n, date, doc_no, description, debit_sar d, credit_sar cr
       from nsa_rows where date like '2025-08%' and (debit_sar ~ '7887' or credit_sar ~ '7887')`);
  console.table(aug.map((r: any) => ({ row: r.n, date: String(r.date).slice(0,10),
    doc: r.doc_no, desc: String(r.description ?? '').slice(0,24), debit: r.d, credit: r.cr })));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
