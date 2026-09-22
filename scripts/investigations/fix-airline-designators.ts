/**
 * Rows whose airline column holds letters where the ledger keeps digits.
 *
 * A ticket carries its carrier as three digits - 065 is Saudia - and that
 * is what a BSP invoice prints and what every screen here reads: the A/L
 * filter, the document number the tables rebuild, the carrier name beside
 * it. A row holding "SV" is invisible to all of them.
 *
 * Ibtekar's export has a "VC" column carrying the two-letter designator,
 * and the parser passed it straight through until it was taught to
 * translate. Rows imported before that keep the letters, and this puts
 * them right.
 *
 * Only the airline column is touched. A designator the agency's table does
 * not hold is printed and left alone rather than guessed at - a wrong
 * carrier code routes a ticket to an airline that never flew it.
 *
 * Dry run by default.
 *
 *   npx tsx scripts/investigations/fix-airline-designators.ts
 *   npx tsx scripts/investigations/fix-airline-designators.ts --apply
 *   npx tsx scripts/investigations/fix-airline-designators.ts --restore scratch/<file>.json
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { airlineNumeric, airlineName } from '../../src/core/config/airlines';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const flag = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Row {
  id: string; ticket_no: string; al: string; al_raw: string | null; source: string;
  date: string | null; amt: number; cur: string; req: string; pax: string; pnr: string;
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const restore = flag('restore');
  if (restore) {
    const snap = JSON.parse(readFileSync(restore, 'utf8'));
    let back = 0;
    for (const r of snap.rows) {
      const res = await c.query(`update tickets set airline_code = $2 where id = $1`,
        [r.id, r.al ?? null]);
      back += res.rowCount ?? 0;
    }
    console.log(`put ${back} of ${snap.rows.length} airline codes back as they were`);
    await c.end();
    return;
  }

  // Anything in that column that is not three digits and not empty. A blank
  // is correct for a carrier with no IATA code at all, so it is left out.
  const rows: Row[] = (await c.query(
    `select id, ticket_no, coalesce(airline_code,'') al, airline_code al_raw, source,
            date::text, amount::float8 amt, coalesce(currency,'') cur,
            coalesce(req_num,'') req, coalesce(passenger_name,'') pax, coalesce(pnr,'') pnr
       from tickets
      where coalesce(airline_code,'') <> '' and coalesce(airline_code,'') !~ '^[0-9]{3}$'
      order by date, ticket_no`)).rows;

  const fixable = rows.filter(r => airlineNumeric(r.al));
  const unknown = rows.filter(r => !airlineNumeric(r.al));

  console.log('='.repeat(92));
  console.log(`AIRLINE CODES THAT ARE NOT CODES — ${has('apply') ? 'APPLYING' : 'DRY RUN'}`);
  console.log('='.repeat(92));
  console.log(`   rows with letters in the airline column  ${String(rows.length).padStart(4)}`);
  console.log(`   this can translate                       ${String(fixable.length).padStart(4)}`);
  console.log(`   left for a person                        ${String(unknown.length).padStart(4)}`);

  if (fixable.length) {
    console.log('\n   to translate:');
    for (const r of fixable)
      console.log(`      ${r.date}  ${r.source.padEnd(12)} ${r.ticket_no.padEnd(13)}`
        + ` "${r.al}" -> "${airlineNumeric(r.al)}" ${airlineName(airlineNumeric(r.al))}`.padEnd(34)
        + ` ${m(r.amt).padStart(10)} ${r.cur}  req ${r.req.padEnd(11)} ${r.pax}`);
  }
  if (unknown.length) {
    console.log('\n   LEFT ALONE — not a designator the agency\'s table holds:');
    for (const r of unknown)
      console.log(`      ${r.date}  ${r.source.padEnd(12)} ${r.ticket_no.padEnd(13)} "${r.al}"`
        + `   ${m(r.amt).padStart(10)} ${r.cur}  req ${r.req}`);
  }

  if (!fixable.length) { console.log('\nNothing to translate.'); await c.end(); return; }
  if (!has('apply')) {
    console.log('\nDry run. Nothing was written. Add --apply to translate them.');
    await c.end();
    return;
  }

  mkdirSync('scratch', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `scratch/airline-codes-before-${stamp}.json`;
  writeFileSync(file, JSON.stringify({
    takenAt: new Date().toISOString(),
    rows: fixable.map(r => ({ id: r.id, ticket_no: r.ticket_no, al: r.al_raw })),
  }, null, 2));
  console.log(`\n   snapshot  ${file}`);

  let done = 0;
  for (const r of fixable) {
    const res = await c.query(`update tickets set airline_code = $2 where id = $1`,
      [r.id, airlineNumeric(r.al)]);
    done += res.rowCount ?? 0;
  }
  console.log(`   translated ${done} row(s). The database's own trigger has recorded each one.`);
  console.log(`\nTo undo: npx tsx scripts/investigations/fix-airline-designators.ts --restore ${file}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
