/**
 * Requests that are part closed: some rows finished, some not.
 *
 * The state nobody can see by scrolling. A request with seventy-two closed
 * rows and two open ones looks finished from every angle except this one, and
 * the two that are left are the ones somebody is still owed an answer about.
 *
 *   npx tsx scripts/investigations/half-closed-requests.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const reqs = await q(`
    select req_num,
           count(*)::int rows,
           count(*) filter (where closed)::int closed,
           count(*) filter (where not closed)::int open,
           string_agg(distinct source, ', ') sources
      from tickets
     where coalesce(req_num,'') <> '' and upper(coalesce(status,'')) <> 'FUND'
     group by req_num
    having count(*) filter (where closed) > 0 and count(*) filter (where not closed) > 0
     order by count(*) filter (where not closed) desc, count(*) desc`);

  console.log('='.repeat(92));
  console.log(`PART-CLOSED REQUESTS: ${reqs.length}`);
  console.log('='.repeat(92));

  let grand = 0;
  for (const r of reqs) {
    const open = await q(
      `select ticket_no, airline_code, source, status, date, amount::float8 amount,
              currency, coalesce(passenger_name,'') pax, coalesce(vendor_reference,'') vref
         from tickets
        where req_num = $1 and not closed and upper(coalesce(status,'')) <> 'FUND'
        order by date`, [r.req_num]);

    console.log(`\n${r.req_num}`);
    console.log(`   ${r.closed} of ${r.rows} closed · ${r.open} still open · ${r.sources}`);
    for (const t of open) {
      grand++;
      // The invoice reference is worth printing beside every open row: on the
      // ones checked so far it is where the reason lives.
      const odd = t.vref && t.vref.toUpperCase() !== String(r.req_num).toUpperCase()
        ? `   <-- invoice says ${t.vref}` : '';
      console.log(`      ${t.date}  ${t.airline_code}-${t.ticket_no}  ${String(t.source).padEnd(9)}`
        + ` ${String(t.status).padEnd(6)} ${m(t.amount).padStart(12)} ${t.currency}`
        + `  ${t.pax.slice(0, 28).padEnd(28)}${odd}`);
    }
  }

  console.log('\n' + '='.repeat(92));
  console.log(`${grand} open row(s) across ${reqs.length} part-closed request(s).`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
