import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select id, ticket_no, airline_code, status, date::text date,
            amount::float8 amount, currency, coalesce(vendor_reference,'') vref,
            coalesce(req_num,'') req, coalesce(passenger_name,'') pax, coalesce(pnr,'') pnr,
            coalesce(route,'') route, closed, source, coalesce(channel,'') channel,
            coalesce(report_name,'') report
       from tickets where source ilike '%ibtekar%' order by date, ticket_no`);
  console.log(`ibtekar rows: ${rows.length}`);
  const byRef: Record<string, number> = {};
  for (const r of rows as any[]) byRef[r.vref || '(blank)'] = (byRef[r.vref || '(blank)'] ?? 0) + 1;
  console.log(Object.entries(byRef).sort((a,b)=>b[1]-a[1]).slice(0,25));
  console.log('sources:', [...new Set(rows.map((r:any)=>r.source))]);
  writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
