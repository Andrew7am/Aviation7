/**
 * Fill the cabin and the route from NSA's own Ticketwise statements.
 *
 * NSA is by far the largest vendor in this ledger and had a cabin recorded on
 * 3% of its tickets, because the agency's internal export barely covers it.
 * NSA's own statement of account does: every line carries a Class column
 * ("Economy Class", "Business Class", "First Class") and a Sector column that
 * is the itinerary.
 *
 * The header is not at the top. Each sheet opens with a block of client
 * details — address, VAT number, date range — and the real header sits a dozen
 * rows down, so it is found by looking for the row that has both Ticket and
 * Class rather than by counting rows, which would break the moment a statement
 * carried one extra line of preamble.
 *
 * Fill-only, always: a cabin or a route already in the ledger is never
 * replaced. A ticket that two statements disagree about is reported and left
 * alone.
 *
 *   npx tsx scripts/backfill-from-nsa-statements.ts --dir=<folder> [--apply]
 */
import 'dotenv/config';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { Client } from 'pg';
import { toCabin } from '../src/core/helpers/cabinClass';
import { extractRoute } from '../src/core/helpers/extractRoute';

const APPLY = process.argv.includes('--apply');
const DIR = process.argv.find(a => a.startsWith('--dir='))?.slice('--dir='.length);
if (!DIR) { console.error('need --dir=<folder of NSA statements>'); process.exit(1); }

function walk(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out = out.concat(walk(p, depth + 1));
    else if (/\.xlsx?$/i.test(e) && st.size < 25_000_000) out.push(p);
  }
  return out;
}

/** The header row, found by its columns rather than its position. */
function findHeader(grid: string[][]) {
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const cells = (grid[i] ?? []).map(c => String(c ?? '').trim().toLowerCase());
    if (!cells.includes('ticket') || !cells.includes('class')) continue;
    return {
      at: i,
      ticket: cells.indexOf('ticket'),
      cls:    cells.indexOf('class'),
      sector: cells.indexOf('sector'),
    };
  }
  return null;
}

/** "176 - 3000541761" -> "3000541761", matching how the ledger stores it. */
const serialOf = (cell: unknown) => {
  const d = String(cell ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

(async () => {
  const files = walk(DIR);
  console.log(`${files.length} spreadsheets under ${DIR}`);

  // ticket -> everything the statements claim about it
  const claims = new Map<string, { cls: Set<string>; sector: Set<string> }>();
  let usable = 0;
  for (const f of files) {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.read(readFileSync(f), { type: 'buffer' }); } catch { continue; }
    for (const s of wb.SheetNames) {
      let grid: string[][];
      try {
        grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[s], { header: 1, raw: false, defval: '' });
      } catch { continue; }
      const h = findHeader(grid);
      if (!h) continue;
      usable++;
      for (const r of grid.slice(h.at + 1)) {
        const tk = serialOf(r?.[h.ticket]);
        if (!tk) continue;
        const rec = claims.get(tk) ?? { cls: new Set<string>(), sector: new Set<string>() };
        const cls = String(r?.[h.cls] ?? '').trim();
        if (cls) rec.cls.add(cls);
        if (h.sector >= 0) {
          const sec = extractRoute(String(r?.[h.sector] ?? ''));
          if (sec) rec.sector.add(sec);
        }
        claims.set(tk, rec);
      }
    }
  }
  console.log(`${usable} statements had a Ticket + Class header`);
  console.log(`distinct tickets in them: ${claims.size}\n`);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: led } = await c.query(
    `select id, ticket_no, source, coalesce(cabin_class,'') cabin_class,
            coalesce(route,'') route from tickets`);
  const byTk = new Map<string, any[]>();
  for (const t of led as any[]) {
    const k = String(t.ticket_no);
    (byTk.get(k) ?? byTk.set(k, []).get(k)!).push(t);
  }

  const fix: { id: string; ticket_no: string; cabin?: string; raw?: string; route?: string }[] = [];
  const cabinConflicts: any[] = [];
  const routeConflicts: any[] = [];
  let notInLedger = 0, cabins = 0, routes = 0;

  for (const [tk, v] of claims) {
    const held = byTk.get(tk);
    if (!held) { notInLedger++; continue; }

    let cabin = '', raw = '';
    const readings = [...new Set([...v.cls].map(toCabin).filter(Boolean))];
    if (readings.length > 1) cabinConflicts.push({ ticket: tk, claims: [...v.cls].join(' | ') });
    else if (readings.length === 1) { cabin = readings[0]; raw = [...v.cls][0]; }

    let route = '';
    if (v.sector.size > 1) routeConflicts.push({ ticket: tk, claims: [...v.sector].join(' | ') });
    else if (v.sector.size === 1) route = [...v.sector][0];

    for (const t of held) {
      const wantCabin = cabin && !t.cabin_class;
      const wantRoute = route && !t.route;
      if (!wantCabin && !wantRoute) continue;
      fix.push({
        id: t.id, ticket_no: t.ticket_no,
        ...(wantCabin ? { cabin, raw } : {}),
        ...(wantRoute ? { route } : {}),
      });
      if (wantCabin) cabins++;
      if (wantRoute) routes++;
    }
  }

  console.log('--- outcome ---');
  console.table([{
    'rows to touch': fix.length,
    'cabins to fill': cabins,
    'routes to fill': routes,
    'ticket not in the ledger': notInLedger,
    'statements disagree on the cabin': cabinConflicts.length,
    'statements disagree on the route': routeConflicts.length,
  }]);

  if (cabinConflicts.length) {
    console.log('\nTWO STATEMENTS CLAIM DIFFERENT CABINS — left alone:');
    console.table(cabinConflicts.slice(0, 10));
  }
  if (routeConflicts.length) {
    console.log('\nTWO STATEMENTS CLAIM DIFFERENT ROUTES — left alone:');
    console.table(routeConflicts.slice(0, 10));
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await c.end(); return; }
  if (!fix.length) { console.log('\nnothing to write.'); await c.end(); return; }

  const snap = `nsa-statement-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(snap, JSON.stringify({
    takenAt: new Date().toISOString(),
    note: 'cabin_class / route were empty on these rows before this run',
    rows: fix.map(f => ({ id: f.id, ticket_no: f.ticket_no, filled: Object.keys(f) })),
  }, null, 2));
  console.log(`\nrollback snapshot written: ${snap} (${fix.length} rows)`);

  await c.query('begin');
  try {
    let n = 0;
    for (const f of fix) {
      // Each column guarded on its own emptiness, so a row already holding a
      // route still gains its cabin and neither is overwritten.
      const { rowCount } = await c.query(
        `update tickets set
           cabin_class = case when cabin_class is null and $2::text is not null then $2 else cabin_class end,
           cabin_raw   = case when cabin_class is null and $2::text is not null then $3 else cabin_raw end,
           route       = case when coalesce(route,'') = '' and $4::text is not null then $4 else route end
         where id = $1`,
        [f.id, f.cabin ?? null, f.raw ?? null, f.route ?? null]);
      n += rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`APPLIED: ${n} rows updated.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }

  console.log('\n--- cabin coverage now ---');
  console.table((await c.query(
    `select coalesce(cabin_class,'(none)') cabin, count(*)::int tickets
     from tickets where status <> 'FUND' group by 1 order by tickets desc`)).rows);
  console.log('\n--- tickets still with no route ---');
  console.table((await c.query(
    `select count(*)::int n from tickets
     where status <> 'FUND' and coalesce(route,'') = ''`)).rows);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
