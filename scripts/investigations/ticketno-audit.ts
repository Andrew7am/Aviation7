/**
 * Read-only audit of ticket_no vs airline_code.
 * Confirms the ledger holds one canonical spelling: ticket_no is the bare
 * 10-digit serial, the airline lives in airline_code, and a document issued
 * on a portal matches its BSP invoice line.
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const total = await client.query(`select count(*)::int n from tickets`);
  console.log('total tickets:', total.rows[0].n);

  console.log('\n--- ticket_no shape by source ---');
  console.table((await client.query(`
    select source,
           count(*)::int                                            n,
           count(*) filter (where ticket_no ~ '^[0-9]{13}$')::int    len13,
           count(*) filter (where ticket_no ~ '^[0-9]{10}$')::int    len10,
           count(*) filter (where airline_code is not null
                              and airline_code <> '')::int           has_al,
           count(*) filter (where airline_code is not null and airline_code <> ''
                              and ticket_no like airline_code || '%')::int prefixed
    from tickets
    group by source order by n desc
  `)).rows);

  console.log('\n--- ticket_no lengths (numeric identifiers only) ---');
  console.table((await client.query(`
    select length(ticket_no) len, count(*)::int n
    from tickets where ticket_no ~ '^[0-9]+$'
    group by 1 order by 1
  `)).rows);

  console.log('\n--- documents present under more than one vendor ---');
  const shared = await client.query(`
    select ticket_no,
           count(*)::int              n,
           array_agg(distinct source) sources
    from tickets
    where ticket_no ~ '^[0-9]{10}$'
    group by ticket_no
    having count(distinct source) > 1
    order by n desc
  `);
  console.log('matched across vendors:', shared.rowCount);
  console.table(shared.rows.slice(0, 10).map(r => ({
    serial: r.ticket_no, rows: r.n, vendors: r.sources.join(' + '),
  })));

  console.log('\n--- airline_code still scavenged from its own serial ---');
  console.table((await client.query(`
    select airline_code, count(*)::int n, min(ticket_no) example
    from tickets
    where ticket_no ~ '^[0-9]{10}$'
      and airline_code ~ '^[0-9]{3}$'
      and ticket_no like airline_code || '%'
    group by airline_code order by n desc
  `)).rows);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
