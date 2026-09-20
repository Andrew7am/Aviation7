/**
 * Put the passenger and route from invoice 1559 onto the two rows it bills.
 *
 * Both tickets came in from the movement sheet, which carries neither, and
 * the tax invoice that does carry them was not matched to the ledger until
 * now. Nothing about the money changes: these are the two fields that make a
 * row findable by a person rather than by a number.
 *
 * Written only where the field is empty. An import fills gaps; it must never
 * replace something already recorded, and least of all from a script run once
 * by hand.
 *
 *   npx tsx scripts/investigations/fill-1559-details.ts
 *   npx tsx scripts/investigations/fill-1559-details.ts --apply
 *   npx tsx scripts/investigations/fill-1559-details.ts --revert scratch/<file>.json
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';

/** Straight off Invoice_1559 - ALSAFAR.pdf, as the document prints them. */
const FROM_INVOICE: Record<string, { passenger: string; route: string }> = {
  '4860316810': { passenger: 'ALBARADIE/RAIDAH S', route: 'DMM/AHB/DMM' },
  '4860449325': { passenger: 'ALBARADIE/RAIDAH',   route: 'DMM/AHB/DMM' },
};

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const flag = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const revert = flag('revert');
  if (revert) {
    const snap = JSON.parse(readFileSync(revert, 'utf8'));
    for (const r of snap.rows)
      await q(`update tickets set passenger_name = $1, route = $2 where id = $3`,
        [r.passenger_name, r.route, r.id]);
    console.log(`restored ${snap.rows.length} row(s) from ${revert}`);
    await c.end();
    return;
  }

  // Every row carrying either ticket number - the refund included. A refund
  // is the same passenger on the same journey, and leaving it blank beside a
  // named sale is the state this is meant to end.
  const rows = await q(
    `select id, ticket_no, date, amount::float8 amount, status,
            coalesce(passenger_name,'') passenger_name, coalesce(route,'') route,
            coalesce(vendor_reference,'') vref
       from tickets where ticket_no = any($1::text[]) and source = 'Ibtekar'
      order by ticket_no, amount desc`,
    [Object.keys(FROM_INVOICE)]);

  console.log('='.repeat(92));
  console.log(`INVOICE 1559 DETAILS ONTO ${rows.length} LEDGER ROW(S) — ${has('apply') ? 'APPLYING' : 'DRY RUN'}`);
  console.log('='.repeat(92));

  const writes: { id: string; passenger: string; route: string }[] = [];
  for (const r of rows) {
    const want = FROM_INVOICE[r.ticket_no];
    const passenger = r.passenger_name.trim() || want.passenger;
    const route = r.route.trim() || want.route;
    const changing = passenger !== r.passenger_name || route !== r.route;

    console.log(`\n   ${r.ticket_no}  ${r.date}  ${r.status}  ${r.amount.toFixed(2)}  ref "${r.vref}"`);
    console.log(`      passenger  ${(r.passenger_name || '(empty)').padEnd(22)} -> ${passenger}`
      + (r.passenger_name.trim() ? '   (already set, left alone)' : ''));
    console.log(`      route      ${(r.route || '(empty)').padEnd(22)} -> ${route}`
      + (r.route.trim() ? '   (already set, left alone)' : ''));
    if (changing) writes.push({ id: r.id, passenger, route });
  }

  console.log(`\n   ${writes.length} row(s) would change. No amount, date or reference is touched.`);

  if (!has('apply')) {
    console.log('\nDry run. Nothing was written. Add --apply to make the change.');
    await c.end();
    return;
  }

  mkdirSync('scratch', { recursive: true });
  const path = `scratch/inv1559-details-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(path, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nSnapshot written to ${path}`);

  for (const w of writes)
    await q(`update tickets set passenger_name = $1, route = $2 where id = $3`,
      [w.passenger, w.route, w.id]);

  console.log(`\nApplied to ${writes.length} row(s):`);
  for (const r of await q(
    `select ticket_no, status, coalesce(passenger_name,'') pax, coalesce(route,'') route
       from tickets where ticket_no = any($1::text[]) and source = 'Ibtekar'
      order by ticket_no, amount desc`, [Object.keys(FROM_INVOICE)]))
    console.log(`   ${r.ticket_no}  ${String(r.status).padEnd(7)} ${r.pax.padEnd(22)} ${r.route}`);
  console.log(`\nTo undo: npx tsx scripts/investigations/fill-1559-details.ts --revert ${path}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
