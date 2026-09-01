/**
 * Align the stored `currency` column with the vendor that billed the ticket.
 *
 * The app has always DISPLAYED currency per vendor — sourceToCurrency() — in
 * the ticket table, the summary bar and every export. The stored column is a
 * different answer, and on 1,944 rows it is the wrong one: a parser fell back
 * to whatever the import screen defaulted to because the report named no
 * currency. IATA BSP is the clearest case, 1,815 tickets saved as SAR when
 * that BSP settles in AED and its own invoices print "GRAND TOTAL (AED)".
 *
 * This changes no figure and no on-screen total: the screen was already
 * reading the vendor. It makes the data say what the screen says, so anything
 * reading the column directly — a report, an export, an analysis — stops
 * disagreeing with the app.
 *
 * Every disagreement is corrected to the vendor's currency. The one row this
 * script originally refused to touch — 2,777.20 stored as USD on FlyAdeal DXB,
 * a vendor that bills in AED — was put to the agency rather than guessed at,
 * and confirmed as AED. There is no longer an exception to carve out.
 *
 *   npx tsx scripts/fix-stored-currency.ts [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';
import { sourceToCurrency } from '../src/core/helpers/sourceCurrency';

const APPLY = process.argv.includes('--apply');
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select id, ticket_no, source, currency, amount::float8 amount, status from tickets`);

  const fix: any[] = [];
  for (const r of rows as any[]) {
    const want = sourceToCurrency(r.source || '');
    if (r.currency !== want) fix.push({ ...r, want });
  }

  const by: Record<string, any> = {};
  for (const r of fix) {
    const k = `${r.source}|${r.currency}`;
    by[k] ??= { source: r.source, from: r.currency, to: r.want, rows: 0, value: 0 };
    by[k].rows++;
    by[k].value += r.amount;
  }
  console.log('--- rows whose stored currency disagrees with their vendor ---');
  console.table(Object.values(by).map((x: any) => ({ ...x, value: money(x.value) })));
  console.log(`total to correct: ${fix.length}`);

  const before = (await c.query(
    `select currency, count(*)::int n, sum(amount::numeric)::float8 net
     from tickets where status <> 'FUND' group by currency order by n desc`)).rows;
  console.log('\n--- stored totals, before ---');
  console.table((before as any[]).map(b => ({ currency: b.currency, tickets: b.n, net: money(Number(b.net)) })));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await c.end(); return;
  }
  if (fix.length === 0) { console.log('\nnothing to change.'); await c.end(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snap = `currency-fix-snapshot-${stamp}.json`;
  writeFileSync(snap, JSON.stringify({
    takenAt: new Date().toISOString(),
    rows: fix.map(r => ({ id: r.id, ticket_no: r.ticket_no, source: r.source, currency: r.currency })),
  }, null, 2));
  console.log(`\nrollback snapshot written: ${snap} (${fix.length} rows)`);

  await c.query('begin');
  try {
    let n = 0;
    // Grouped by target so this stays correct if a vendor is ever added that
    // settles in something other than AED.
    const targets = [...new Set(fix.map(r => r.want))];
    for (const want of targets) {
      const ids = fix.filter(r => r.want === want).map(r => r.id);
      const { rowCount } = await c.query(
        `update tickets set currency = $2 where id = any($1)`, [ids, want]);
      console.log(`  ${rowCount} rows -> ${want}`);
      n += rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`APPLIED: ${n} rows corrected.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }

  console.log('\n--- stored totals, after ---');
  console.table(((await c.query(
    `select currency, count(*)::int n, sum(amount::numeric)::float8 net
     from tickets where status <> 'FUND' group by currency order by n desc`)).rows as any[])
    .map(b => ({ currency: b.currency, tickets: b.n, net: money(Number(b.net)) })));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
