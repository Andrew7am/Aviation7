/**
 * Read-only audit of ticket_no vs airline_code in production.
 * Answers: how many rows carry the 3-digit airline prefix inside ticket_no,
 * how many don't, and how many pairs are the SAME document stored twice
 * because one side kept the prefix and the other didn't.
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const total = await client.query(`select count(*)::int n from tickets`);
  console.log('total tickets:', total.rows[0].n);

  const bySource = await client.query(`
    select source,
           count(*)::int                                                     n,
           count(*) filter (where ticket_no ~ '^[0-9]{13}$')::int            len13,
           count(*) filter (where ticket_no ~ '^[0-9]{10}$')::int            len10,
           count(*) filter (where ticket_no ~ '^[0-9]{8,15}$')::int          numeric_any,
           count(*) filter (where airline_code is not null
                              and airline_code <> '')::int                   has_al,
           count(*) filter (where airline_code is not null and airline_code <> ''
                              and ticket_no like airline_code || '%')::int   prefixed
    from tickets
    group by source order by n desc
  `);
  console.table(bySource.rows);

  const lens = await client.query(`
    select length(ticket_no) len, count(*)::int n
    from tickets where ticket_no ~ '^[0-9]+$'
    group by 1 order by 1
  `);
  console.table(lens.rows);

  // The collision: same trailing serial, stored under two different ticket_no
  // spellings (one with the airline prefix, one without).
  const collisions = await client.query(`
    with norm as (
      select id, ticket_no, source, airline_code, date, amount, status,
             case when airline_code is not null and airline_code <> ''
                   and ticket_no like airline_code || '%'
                   and length(ticket_no) > length(airline_code)
                  then substr(ticket_no, length(airline_code) + 1)
                  when ticket_no ~ '^[0-9]{13}$' then substr(ticket_no, 4)
                  else ticket_no end as serial
      from tickets
    )
    select serial,
           count(*)::int                          n,
           count(distinct ticket_no)::int         spellings,
           array_agg(distinct ticket_no)          nos,
           array_agg(distinct source)             sources
    from norm
    where serial ~ '^[0-9]{6,}$'
    group by serial
    having count(distinct ticket_no) > 1
    order by n desc
    limit 25
  `);
  console.log('\n--- same serial, different ticket_no spelling ---');
  console.log('groups:', collisions.rowCount);
  console.table(collisions.rows.map(r => ({
    serial: r.serial, n: r.n, spellings: r.spellings,
    nos: r.nos.join(','), sources: r.sources.join(','),
  })));

  const collTotal = await client.query(`
    with norm as (
      select ticket_no, airline_code,
             case when airline_code is not null and airline_code <> ''
                   and ticket_no like airline_code || '%'
                   and length(ticket_no) > length(airline_code)
                  then substr(ticket_no, length(airline_code) + 1)
                  when ticket_no ~ '^[0-9]{13}$' then substr(ticket_no, 4)
                  else ticket_no end as serial
      from tickets
    )
    select count(*)::int groups, sum(n)::int rows_involved from (
      select serial, count(*)::int n from norm
      where serial ~ '^[0-9]{6,}$'
      group by serial having count(distinct ticket_no) > 1
    ) x
  `);
  console.log('collision summary:', collTotal.rows[0]);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
