/**
 * Fill in the cabin each ticket was sold in, from the agency's own export.
 *
 * The export lists a Cabin Class column beside a Ticket Number column, and
 * that ticket column is free text people have typed for years. One cell can
 * hold two documents, or six; the separators seen are | / // + , - and plain
 * newlines; some cells hold an EMD alongside the ticket; some hold a PNR and
 * no ticket at all; and ninety cells were opened in Excel at some point and
 * now read "1.57551E+12", the number destroyed beyond recovery.
 *
 * So every run of ten or more digits is treated as a document number and
 * everything else in the cell is ignored. That reads the two-ticket cells and
 * the EMD cells correctly and skips the rest rather than inventing a match.
 *
 * A document listed twice with different cabins is only a conflict when both
 * sides claim to know: "Economy" against "Class couldn't be determined" is one
 * row that knew and one that did not. Real disagreements are reported and left
 * alone — there are nine.
 *
 * Dry run by default; --apply writes, after a rollback snapshot. Fill-only: a
 * cabin already recorded is never overwritten.
 *
 *   npx tsx scripts/backfill-cabin-class.ts --file="...TICKETS (7).csv" [--apply]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import Papa from 'papaparse';
import { Client } from 'pg';
import { toCabin, isUnreadableCabin, isMixedCabin } from '../src/core/helpers/cabinClass';

const APPLY = process.argv.includes('--apply');
const FILE = process.argv.find(a => a.startsWith('--file='))?.slice('--file='.length);
if (!FILE) { console.error('need --file=<the export CSV>'); process.exit(1); }

const UNKNOWN_TEXT = /couldn'?t be determined|not determined|unknown/i;

/** Every run of 10+ digits in the cell, as bare 10-digit document numbers. */
export function documentsIn(cell: string): string[] {
  return (cell.match(/\d[\d-]{9,}/g) ?? [])
    .map(s => s.replace(/\D/g, ''))
    .filter(d => d.length >= 10)
    .map(d => d.slice(-10));
}

(async () => {
  const grid = Papa.parse<string[]>(readFileSync(FILE, 'utf8'), { skipEmptyLines: true }).data;
  const head = grid[0].map(h => h.trim());
  const iTk = head.indexOf('Ticket Number');
  const iCabin = head.findIndex(h => /cabin/i.test(h));
  if (iTk < 0 || iCabin < 0) {
    console.error(`need a "Ticket Number" and a cabin column; found: ${head.join(' | ')}`);
    process.exit(1);
  }
  const rows = grid.slice(1).filter(r => r.length === head.length);
  console.log(`${rows.length} rows in the export\n`);

  // document -> every cabin text claimed for it
  const claims = new Map<string, Set<string>>();
  let noDocument = 0;
  for (const r of rows) {
    const docs = documentsIn(r[iTk] ?? '');
    if (!docs.length) { noDocument++; continue; }
    const cab = (r[iCabin] ?? '').trim();
    for (const d of docs) (claims.get(d) ?? claims.set(d, new Set()).get(d)!).add(cab);
  }
  console.log(`rows with no readable document number: ${noDocument}`);
  console.log(`distinct documents found: ${claims.size}\n`);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: led } = await c.query(
    `select id, ticket_no, airline_code, source, status,
            coalesce(cabin_class,'') cabin_class, coalesce(cabin_raw,'') cabin_raw
     from tickets`);
  const byDoc = new Map<string, any[]>();
  for (const t of led as any[]) {
    const k = String(t.ticket_no);
    (byDoc.get(k) ?? byDoc.set(k, []).get(k)!).push(t);
  }

  const fix: { id: string; ticket_no: string; cabin: string; raw: string }[] = [];
  const conflicts: { doc: string; values: string[] }[] = [];
  const unreadable = new Map<string, number>();
  let notInLedger = 0, alreadySet = 0, saidUnknown = 0, mixed = 0;

  for (const [doc, set] of claims) {
    const held = byDoc.get(doc);
    if (!held) { notInLedger++; continue; }

    // A row that did not know is not disagreeing with a row that did.
    const known = [...set].filter(v => v && !UNKNOWN_TEXT.test(v));
    if (known.length > 1 && new Set(known.map(toCabin)).size > 1) {
      conflicts.push({ doc, values: [...set] });
      continue;
    }
    const raw = known[0] ?? '';
    if (!raw) { saidUnknown++; continue; }

    const cabin = toCabin(raw);
    if (!cabin) {
      unreadable.set(raw, (unreadable.get(raw) ?? 0) + held.length);
      continue;
    }
    if (isMixedCabin(raw)) mixed++;

    for (const t of held) {
      if (t.cabin_class) { alreadySet++; continue; }
      fix.push({ id: t.id, ticket_no: t.ticket_no, cabin, raw });
    }
  }

  console.log('--- outcome ---');
  console.table([{
    'tickets to fill': fix.length,
    'document not in the ledger': notInLedger,
    'export said it could not tell': saidUnknown,
    'cabin name not recognised': [...unreadable.values()].reduce((s, n) => s + n, 0),
    'two rows genuinely disagree': conflicts.length,
    'already had a cabin': alreadySet,
  }]);

  const byCabin: Record<string, number> = {};
  for (const f of fix) byCabin[f.cabin] = (byCabin[f.cabin] ?? 0) + 1;
  console.log('\nwhat would be written:');
  console.table(Object.entries(byCabin).sort((a, b) => b[1] - a[1])
    .map(([cabin, tickets]) => ({ cabin, tickets })));
  console.log(`of those, ${mixed} are journeys that ran through more than one cabin`);

  if (unreadable.size) {
    console.log('\nCABIN NAMES NOBODY HAS MAPPED — left blank, raw text kept:');
    console.table([...unreadable.entries()].sort((a, b) => b[1] - a[1])
      .map(([name, tickets]) => ({ 'as written': name, tickets })));
  }
  if (conflicts.length) {
    console.log('\nTWO ROWS CLAIM DIFFERENT CABINS — left blank:');
    console.table(conflicts.map(x => ({ document: x.doc, claims: x.values.join('  |  ') })));
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await c.end(); return; }
  if (!fix.length) { console.log('\nnothing to write.'); await c.end(); return; }

  const snap = `cabin-class-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(snap, JSON.stringify({
    takenAt: new Date().toISOString(),
    note: 'cabin_class and cabin_raw were empty on these rows before this run',
    rows: fix.map(f => ({ id: f.id, ticket_no: f.ticket_no })),
  }, null, 2));
  console.log(`\nrollback snapshot written: ${snap} (${fix.length} rows)`);

  await c.query('begin');
  try {
    let n = 0;
    for (const f of fix) {
      const { rowCount } = await c.query(
        `update tickets set cabin_class = $2, cabin_raw = $3
         where id = $1 and cabin_class is null`,
        [f.id, f.cabin, f.raw]);
      n += rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`APPLIED: ${n} tickets given a cabin.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }

  console.log('\n--- the ledger now ---');
  console.table((await c.query(
    `select coalesce(cabin_class,'(none)') cabin, count(*)::int tickets
     from tickets where status <> 'FUND' group by 1 order by tickets desc`)).rows);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
