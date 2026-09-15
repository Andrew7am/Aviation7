/**
 * Where the ledger stands, vendor by vendor, measured rather than remembered.
 *
 * Most of the work so far has been driven by whichever file was uploaded that
 * hour. This asks the same questions of every vendor at once, so the parts
 * nobody has looked at are visible as parts nobody has looked at rather than
 * as silence.
 *
 *   npx tsx scripts/investigations/state-of-the-ledger.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pc = (a: number, b: number) => b ? `${Math.round((a / b) * 100)}%` : '—';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  console.log('='.repeat(96));
  console.log('THE LEDGER, BY VENDOR');
  console.log('='.repeat(96));

  const rows = await q(`
    select source,
           count(*)::int                                                   rows,
           count(*) filter (where date is null or date = '')::int          undated,
           count(*) filter (where date is not null and date <> ''
                              and (date < '2024-01-01' or date > '2027-12-31'))::int impossible,
           count(*) filter (where coalesce(req_num,'') = '')::int          no_req,
           count(*) filter (where coalesce(airline_code,'') = '')::int     no_airline,
           count(*) filter (where coalesce(airline_code,'') <> ''
                              and airline_code !~ '^[0-9]{3}$')::int       odd_airline,
           count(*) filter (where coalesce(vendor_reference,'') !~ '^(INV|RFD|RV|DMA|DN)')::int no_doc,
           count(*) filter (where amount < 0)::int                         refunds,
           count(*) filter (where not closed and status <> 'FUND')::int    open_rows,
           count(distinct currency)::int                                   currencies,
           min(nullif(date,''))                                            first_date,
           max(nullif(date,''))                                            last_date
      from tickets group by source order by count(*) desc`);

  console.table(rows.map((r: any) => ({
    vendor: r.source,
    rows: r.rows,
    undated: r.undated || '',
    'bad date': r.impossible || '',
    'no req': r.no_req || '',
    'no A/L': r.no_airline || '',
    'odd A/L': r.odd_airline || '',
    'no invoice no': `${r.no_doc} (${pc(r.no_doc, r.rows)})`,
    refunds: r.refunds || '',
    'not closed': r.open_rows || '',
    from: r.first_date, to: r.last_date,
  })));

  console.log('\n' + '='.repeat(96));
  console.log('WHAT EACH VENDOR HAS TO CHECK ITSELF AGAINST');
  console.log('='.repeat(96));
  const cover = await q(`
    select v.vendor_name vendor,
           v.initial_balance::float8 initial,
           (select count(*)::int from balance_topups t where t.vendor_name = v.vendor_name) payments,
           (select count(*)::int from vendor_statements s where s.vendor_name = v.vendor_name) statements,
           (select max(period_end)::text from vendor_statements s where s.vendor_name = v.vendor_name) stated_to,
           (select count(*)::int from tickets k where k.source = v.vendor_name) tickets,
           (select max(date) from tickets k where k.source = v.vendor_name and date <> '') ledger_to
      from vendor_balances v order by v.vendor_name`);
  console.table(cover.map((r: any) => ({
    vendor: r.vendor, tickets: r.tickets, payments: r.payments,
    statements: r.statements || 'none',
    'stated to': r.stated_to ?? '—',
    'ledger to': r.ledger_to ?? '—',
    'months behind': r.stated_to && r.ledger_to
      ? Math.max(0, Math.round((Date.parse(r.ledger_to) - Date.parse(r.stated_to)) / 2629800000))
      : '—',
  })));

  console.log('\n' + '='.repeat(96));
  console.log('THINGS THAT ARE STILL WRONG');
  console.log('='.repeat(96));

  const checks: [string, string][] = [
    ['tickets with no date at all',
     `select source || ' — ' || count(*) || ' row(s), ' ||
             to_char(coalesce(sum(amount),0),'FM999,999,990.00') || ' ' || min(currency) d
        from tickets where date is null or date = '' group by source`],
    ['tickets dated outside the years the agency has traded',
     `select source || ' — ' || count(*) || ' row(s): ' || string_agg(distinct date, ', ') d
        from tickets where date is not null and date <> ''
          and (date < '2024-01-01' or date > '2027-12-31') group by source`],
    ['an airline code that is not three digits',
     `select source || ' — ' || airline_code || ' on ' || count(*) || ' row(s)' d
        from tickets where coalesce(airline_code,'') <> '' and airline_code !~ '^[0-9]{3}$'
       group by source, airline_code`],
    ['the same document recorded twice for one vendor',
     `select source || ' — ' || ticket_no || ' x' || count(*) d
        from tickets where amount >= 0 group by source, ticket_no, status having count(*) > 1 limit 12`],
    ['payments dated in the future',
     `select vendor_name || ' — ' || date || ' ' || to_char(amount,'FM999,999,990.00') d
        from balance_topups where date > to_char(now(),'YYYY-MM-DD')`],
    ['a vendor wallet with no opening date, charged for its whole history',
     `select vendor_name d from vendor_balances where opening_date is null`],
  ];
  for (const [label, sql] of checks) {
    const r = await q(sql);
    console.log(`\n${label}: ${r.length}`);
    for (const x of r.slice(0, 14)) console.log(`   ${x.d}`);
    if (r.length > 14) console.log(`   ... and ${r.length - 14} more`);
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
