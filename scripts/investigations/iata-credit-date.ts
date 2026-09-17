/**
 * Which day the new IATA credit figure is true as of.
 *
 * An opening balance is a statement about a moment, so "set the credit to X"
 * is only half an instruction: the other half is the day X was true, and every
 * ticket on the wrong side of that day is either charged twice or not at all.
 *
 * This prints what the wallet would read today for each candidate day, and
 * separately checks whether the new figure is one our own rows could have
 * produced from the old one — if it is, that day is almost certainly the one
 * the figure came from.
 *
 *   npx tsx scripts/investigations/iata-credit-date.ts [newBalance]
 */
import 'dotenv/config';
import { Client } from 'pg';

const TARGET = Number(process.argv[2] ?? 261594.46);
const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const [w] = await q(`select * from vendor_balances where vendor_name = 'IATA'`);
  const old = Number(w.initial_balance);

  const rows = await q(`
    select date, count(*)::int rows, sum(amount)::float8 total
      from tickets
     where source = 'IATA BSP' and upper(coalesce(status,'')) <> 'FUND'
       and date >= '2026-08-25' and date <> '' and date is not null
     group by date order by date`);

  const today = new Date().toISOString().slice(0, 10);
  const [{ last }] = await q(
    `select max(date) last from tickets where source = 'IATA BSP' and date <> ''`);

  console.log('='.repeat(92));
  console.log(`IF THE NEW CREDIT OF ${m(TARGET)} IS TRUE AS OF ...`);
  console.log('='.repeat(92));
  console.log(`  today is ${today}; the last IATA BSP row we hold is dated ${last}\n`);

  // Issues on or after each candidate day, which is exactly what the wallet
  // would charge if that day were the opening date.
  const table = rows.map((r, i) => {
    const after = rows.slice(i).reduce((n, x) => n + Number(x.total), 0);
    return {
      'opening date': r.date,
      'rows it would charge': rows.slice(i).reduce((n, x) => n + x.rows, 0),
      'they come to': m(after),
      'wallet would read today': m(TARGET - after),
      'old figure less them': m(old - after),
    };
  });
  // The day after the last row is also a candidate: nothing is charged yet.
  table.push({
    'opening date': `${today} (today)`,
    'rows it would charge': 0,
    'they come to': m(0),
    'wallet would read today': m(TARGET),
    'old figure less them': m(old),
  });
  console.table(table);

  console.log('Reading the table:');
  console.log('  "wallet would read today" is what the screen shows the moment this is applied.');
  console.log('  Pick the row where that equals the figure IATA actually states.\n');

  const hit = table.find(r => Math.abs(Number(r['old figure less them'].replace(/,/g, '')) - TARGET) < 0.011);
  console.log(hit
    ? `The old balance less the rows from ${hit['opening date']} comes to exactly ${m(TARGET)} —\n`
      + `  so the new figure is our own arithmetic carried to that day, not a new deposit.`
    : `No day makes ${m(old)} less our own rows come to ${m(TARGET)}.\n`
      + `  So the figure is not our arithmetic carried forward — it is a balance stated\n`
      + `  elsewhere (IATA's portal, or a payment we have not recorded), and the day it\n`
      + `  was stated has to come from that source rather than from the ledger.`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
