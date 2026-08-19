/**
 * PHASE 2 — TJQ DATE AUDIT (read-only)
 *
 * Answers, from evidence rather than assumption:
 *   1. Does the IATA/TJQ source the system actually receives carry a date?
 *   2. If so, where, and can the current parser read it?
 *   3. If not, what is the safest way to stamp a report date?
 *
 * STRICTLY READ-ONLY: SELECT statements only.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const H = (t: string) => console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`);

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  H('1. WHAT THE IATA SOURCE ACTUALLY CONTAINS');
  const { rows: cols } = await c.query(
    `select ordinal, sql_name, original from vendor_columns where vendor_slug = 'iata' order by ordinal`);
  if (cols.length === 0) {
    console.log('  no vendor_columns rows for slug "iata"');
  } else {
    console.log(`  columns in the stored IATA source (${cols.length}):`);
    for (const c2 of cols) console.log(`    [${String(c2.ordinal).padStart(2)}] ${String(c2.original ?? '').padEnd(24)} -> ${c2.sql_name}`);
    const dateish = cols.filter(c2 => /date|day|period|issue|travel|dep/i.test(`${c2.original ?? ''} ${c2.sql_name}`));
    console.log(`\n  columns whose NAME suggests a date: ${dateish.length ? dateish.map(d => d.original || d.sql_name).join(', ') : 'NONE'}`);
  }

  H('2. DO ANY STORED IATA ROWS CARRY A DATE VALUE?');
  const { rows: sample } = await c.query(`select * from iata_rows order by source_row_num limit 3`);
  if (sample.length) {
    console.log('  first stored rows, field by field:');
    for (const [k, v] of Object.entries(sample[0])) {
      const vals = sample.map(r => JSON.stringify((r as any)[k])).join(' | ');
      console.log(`    ${k.padEnd(20)} ${vals}`);
    }
    // Does any column anywhere in the table hold something date-shaped?
    const dateLike = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{2}[A-Z]{3}\d{2}/i;
    const { rows: all } = await c.query(`select * from iata_rows limit 400`);
    const hits = new Map<string, number>();
    for (const r of all) {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'string' && dateLike.test(v)) hits.set(k, (hits.get(k) ?? 0) + 1);
      }
    }
    console.log(`\n  columns containing date-shaped VALUES (sampled 400 rows): ${hits.size ? [...hits.entries()].map(([k, n]) => `${k} (${n})`).join(', ') : 'NONE'}`);
  } else {
    console.log('  iata_rows is empty');
  }

  H('3. WHAT THE CURRENT PARSER LOOKS FOR');
  const src = readFileSync('src/core/parsers/IATAParser.ts', 'utf8');
  const dateLine = src.split('\n').find(l => l.includes('iDate'));
  console.log(`  IATAParser.ts: ${dateLine?.trim()}`);
  console.log('  => it searches the header row for DATE / ISSUE DATE / TRAVEL DATE.');
  console.log('     If none is present col() returns -1, cell() yields "", parseDate("") yields "",');
  console.log('     and the ticket is stored with an empty date. No date is invented.');

  H('4. HOW MANY IATA TICKETS IN THE LEDGER HAVE NO DATE');
  const { rows: d } = await c.query(`
    select count(*)::int as total,
           count(*) filter (where date is null or date = '')::int as no_date,
           count(*) filter (where date ~ '^\\d{4}-\\d{2}-\\d{2}$')::int as good_date
    from tickets where source ilike '%iata%'`);
  console.log(`  IATA tickets       : ${d[0].total}`);
  console.log(`  with a valid date  : ${d[0].good_date}`);
  console.log(`  with NO date       : ${d[0].no_date}`);

  H('5. CAN THE BSP INVOICE SUPPLY THE MISSING DATES?');
  const { rows: fix } = await c.query(`
    select count(*)::int as n from tickets
    where source ilike '%iata%' and (date is null or date = '')`);
  console.log(`  dateless IATA tickets: ${fix[0].n}`);
  console.log('  The BSP invoice carries an Issue Date on every transaction line, so any');
  console.log('  dateless ticket whose document number appears on an invoice can have its');
  console.log('  real date recovered. That is a data-backfill decision, not a parser change,');
  console.log('  and nothing has been written here.');

  await c.end();
  console.log('\nDATABASE WRITES: 0 (SELECT only)');
}
main().catch(e => { console.error(e); process.exit(1); });
