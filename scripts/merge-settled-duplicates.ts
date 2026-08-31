/**
 * Collapse documents that exist twice — once from the portal (daily tracking)
 * and once from the weekly BSP invoice — onto a single row.
 *
 * The two rows are one sale, so holding both double-counts the money. The
 * invoice supersedes: it alone states the commission and the balance actually
 * payable. So the portal row survives (keeping the issuing vendor, passenger,
 * PNR, route and req number) and takes the invoice's figures; the invoice row
 * is removed.
 *
 * Dry run by default. --apply writes, after saving a rollback snapshot that
 * records both rows in full so the split can be restored.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const SNAPSHOT = 'settled-merge-snapshot.json';
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Row {
  id: string; ticket_no: string; airline_code: string | null; source: string;
  date: string; amount: string; commission: string; total_doc: string;
  status: string | null; req_num: string; pnr: string | null;
  passenger_name: string | null; channel: string | null; serial: number | null;
}

const isSettlement = (s: string) => /^iata/i.test((s || '').trim());

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query<Row>(`
    select id, ticket_no, airline_code, source, date, amount, commission,
           total_doc, status, req_num, pnr, passenger_name, channel, serial
    from tickets where ticket_no ~ '^[0-9]{10}$'`);

  // Group by document: airline + serial + direction. A refund is its own
  // document and must never merge into the issue it reverses.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const dir = Number(r.amount) < 0 ? 'CR' : 'DR';
    const key = `${(r.airline_code || '').trim()}|${r.ticket_no}|${dir}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const merges: { keep: Row; drop: Row }[] = [];
  const oddities: string[] = [];

  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    const settle = g.filter(r => isSettlement(r.source));
    const portal = g.filter(r => !isSettlement(r.source));
    if (settle.length === 0 || portal.length === 0) continue;   // not this case
    if (settle.length > 1 || portal.length > 1) {
      oddities.push(`${key}: ${g.length} rows (${g.map(r => r.source).join(', ')}) — left alone`);
      continue;
    }
    merges.push({ keep: portal[0], drop: settle[0] });
  }

  console.log(`documents held both on a portal and on the invoice: ${merges.length}`);
  if (oddities.length) {
    console.log('\nmore than two rows — needs a human, skipped:');
    oddities.forEach(o => console.log('   ', o));
  }
  if (merges.length === 0) { await c.end(); return; }

  console.table(merges.slice(0, 12).map(m => ({
    serial: m.keep.ticket_no,
    'A/L': m.keep.airline_code,
    'vendor kept': m.keep.source,
    'portal amount': money(Number(m.keep.amount)),
    'invoice amount': money(Number(m.drop.amount)),
    'invoice comm': money(Number(m.drop.commission)),
    'date': m.drop.date || m.keep.date,
  })));

  const before = merges.reduce((s, m) => s + Number(m.keep.amount) + Number(m.drop.amount), 0);
  const after  = merges.reduce((s, m) => s + Number(m.drop.amount), 0);
  const comm   = merges.reduce((s, m) => s + Number(m.drop.commission), 0);
  console.log(`\nrows:            ${merges.length * 2}  ->  ${merges.length}`);
  console.log(`counted value:   ${money(before)}  ->  ${money(after)}`);
  console.log(`over-count removed: ${money(before - after)}`);
  console.log(`commission now recorded on the surviving rows: ${money(comm)}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to merge.');
    await c.end();
    return;
  }

  writeFileSync(SNAPSHOT, JSON.stringify({ takenAt: new Date().toISOString(), merges }, null, 2));
  console.log(`\nrollback snapshot written: ${SNAPSHOT} (${merges.length} pairs, both rows in full)`);

  await c.query('begin');
  try {
    for (const m of merges) {
      await c.query(
        `update tickets set amount=$1, commission=$2, total_doc=$3, date=$4,
                            status=$5, channel=$6, req_num=$7, serial=$8
         where id=$9`,
        [
          m.drop.amount,
          m.drop.commission,
          Number(m.drop.total_doc) || m.keep.total_doc,
          m.drop.date || m.keep.date,
          m.drop.status || m.keep.status,
          m.drop.channel || 'BSP',
          (m.keep.req_num || '').trim() ? m.keep.req_num : m.drop.req_num,
          m.drop.serial ?? m.keep.serial,
          m.keep.id,
        ]);
      await c.query('delete from tickets where id=$1', [m.drop.id]);
    }
    await c.query('commit');
    console.log(`\nAPPLIED: ${merges.length} documents merged, ${merges.length} duplicate rows removed.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
