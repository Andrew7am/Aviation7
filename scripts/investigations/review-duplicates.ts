/**
 * Review: the same DOCUMENT held twice — once from the portal (daily
 * tracking) and once from the weekly BSP invoice.
 *
 * Looks for the overlap three ways, because the two sources do not always
 * agree on how they spell things:
 *   A. same ticket serial, different vendor
 *   B. same PNR + amount, different vendor
 *   C. same passenger + amount + date, different vendor
 * and reports how much money the overlap is double-counting.
 */
import 'dotenv/config';
import { Client } from 'pg';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log('=== A. same ticket serial, different vendor ===');
  const a = await c.query(`
    select ticket_no,
           count(*)::int                                   rows,
           array_agg(distinct source order by source)      sources,
           array_agg(distinct status)                      statuses,
           sum(amount::numeric)::float8                    summed,
           max(amount::numeric)::float8                    largest,
           min(date) mind, max(date) maxd,
           array_agg(distinct coalesce(passenger_name,'')) pax
    from tickets
    where ticket_no ~ '^[0-9]{10}$'
    group by ticket_no
    having count(distinct source) > 1
    order by ticket_no`);
  console.log(`documents held under more than one vendor: ${a.rowCount}`);
  console.table(a.rows.slice(0, 12).map((r: any) => ({
    serial: r.ticket_no, rows: r.rows,
    vendors: r.sources.join(' + '),
    status: r.statuses.join(','),
    'sum of rows': money(r.summed),
    'true value': money(r.largest),
    dates: r.mind === r.maxd ? r.mind : `${r.mind}..${r.maxd}`,
  })));

  const pairSummary = await c.query(`
    with g as (
      select ticket_no, array_agg(distinct source order by source) srcs,
             sum(amount::numeric) summed, max(amount::numeric) largest
      from tickets where ticket_no ~ '^[0-9]{10}$'
      group by ticket_no having count(distinct source) > 1
    )
    select array_to_string(srcs,' + ') pair, count(*)::int docs,
           sum(summed)::float8 summed, sum(largest)::float8 truthy
    from g group by 1 order by docs desc`);
  console.log('\nby vendor pair:');
  console.table(pairSummary.rows.map((r: any) => ({
    'vendor pair': r.pair, documents: r.docs,
    'counted now': money(r.summed), 'should be': money(r.truthy),
    'over-counted by': money(r.summed - r.truthy),
  })));

  console.log('\n=== B. same PNR + amount, different vendor (catches unmatched serials) ===');
  const b = await c.query(`
    select pnr, abs(amount::numeric)::float8 amt,
           count(*)::int rows,
           array_agg(distinct source order by source) sources,
           array_agg(distinct ticket_no) tickets
    from tickets
    where coalesce(pnr,'') <> '' and amount <> 0
    group by pnr, abs(amount::numeric)
    having count(distinct source) > 1
    order by count(*) desc limit 15`);
  console.log(`PNR+amount groups spanning vendors: ${b.rowCount}`);
  console.table(b.rows.map((r: any) => ({
    pnr: r.pnr, amount: money(r.amt), rows: r.rows,
    vendors: r.sources.join(' + '),
    tickets: r.tickets.join(','),
  })));

  console.log('\n=== C. same passenger + amount + date, different vendor ===');
  const cc = await c.query(`
    select passenger_name, abs(amount::numeric)::float8 amt, date,
           count(*)::int rows,
           array_agg(distinct source order by source) sources,
           array_agg(distinct ticket_no) tickets
    from tickets
    where coalesce(passenger_name,'') <> '' and amount <> 0 and date <> ''
    group by passenger_name, abs(amount::numeric), date
    having count(distinct source) > 1
    order by count(*) desc limit 15`);
  console.log(`passenger+amount+date groups spanning vendors: ${cc.rowCount}`);
  console.table(cc.rows.map((r: any) => ({
    passenger: (r.passenger_name || '').slice(0, 22), amount: money(r.amt), date: r.date,
    vendors: r.sources.join(' + '), tickets: r.tickets.join(','),
  })));

  console.log('\n=== D. IATA BSP rows whose serial exists under a portal vendor ===');
  const d = await c.query(`
    select p.source portal, count(*)::int docs,
           sum(b.amount::numeric)::float8 bsp_amount,
           sum(p.amount::numeric)::float8 portal_amount,
           sum(b.commission::numeric)::float8 bsp_comm,
           sum(p.commission::numeric)::float8 portal_comm
    from tickets b
    join tickets p
      on p.ticket_no = b.ticket_no and p.source <> b.source
     and (p.amount < 0) = (b.amount < 0)
    where b.source = 'IATA BSP'
    group by p.source order by docs desc`);
  console.table(d.rows.map((r: any) => ({
    'portal vendor': r.portal, documents: r.docs,
    'portal total': money(r.portal_amount), 'BSP total': money(r.bsp_amount),
    'portal comm': money(r.portal_comm), 'BSP comm': money(r.bsp_comm),
  })));

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
