/**
 * Recover the airline code on BSP rows from the original Agent Billing PDFs.
 *
 * ~1,446 IATA BSP rows carry an airline code that was never read from the
 * report: the old parser derived it from the ticket digits, and on a bare
 * 10-digit serial that returns the serial's own first three digits (hence
 * 1,372 rows stamped "551", which is not an airline). The code cannot be
 * inferred back from the data — serial bands are shared across airlines — so
 * it has to be re-read from the source.
 *
 * The invoice states it outright. Every transaction line begins with the
 * airline, then the document type, then the document number:
 *
 *     077 TKTT 5513059026 09AUG26 ...
 *     └┬┘      └────┬────┘
 *  airline       serial
 *
 * This reads every FCAGBILLDET PDF, collects those pairs, and updates the
 * ledger. Dry run by default; --apply writes, after saving a rollback
 * snapshot. A serial claimed by two different airlines across the invoices is
 * reported and skipped rather than guessed at.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { extractPdfRows } from '../src/core/helpers/pdfText';

const APPLY = process.argv.includes('--apply');
const dirArg = process.argv.find(a => a.startsWith('--dir='));
const DIR = dirArg ? dirArg.slice('--dir='.length) : '';
const SNAPSHOT = 'airline-code-snapshot.json';

/** Transaction line: airline, document type, document number, issue date. */
const TXN_RE = /^(\d{3})\s+([A-Z]{3,5})\s+(\d{8,})\s+(\d{2}[A-Z]{3}\d{2})\b/;

async function buildMap(dir: string) {
  const files = readdirSync(dir).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f));
  console.log(`reading ${files.length} Agent Billing detail PDFs from ${dir}\n`);

  // serial -> airline -> how many invoice lines said so
  const claims = new Map<string, Map<string, number>>();
  let lines = 0;

  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    // extractPdfRows returns PdfRow[] — { text, runs } — not string arrays.
    // Only the reading-order text is needed here: the airline and the document
    // number are the first two tokens, so no column geometry is involved.
    let rows: { text: string }[];
    try {
      rows = await extractPdfRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    } catch (e) {
      console.log(`  !! ${f}: ${(e as Error).message}`);
      continue;
    }
    let hits = 0;
    for (const row of rows) {
      const text = String(row.text ?? '').trim();
      const m = text.match(TXN_RE);
      if (!m) continue;
      const [, airline, , doc] = m;
      // The ledger stores the 10-digit serial; invoices print it bare already,
      // but take the last 10 so a joined 13-digit line normalises too.
      const serial = doc.length > 10 ? doc.slice(-10) : doc;
      const seen = claims.get(serial) ?? new Map<string, number>();
      seen.set(airline, (seen.get(airline) ?? 0) + 1);
      claims.set(serial, seen);
      hits++; lines++;
    }
    console.log(`  ${f}: ${hits} transaction lines`);
  }

  const map = new Map<string, string>();
  const conflicts: string[] = [];
  for (const [serial, seen] of claims) {
    if (seen.size === 1) map.set(serial, [...seen.keys()][0]);
    else conflicts.push(`${serial}: ${[...seen].map(([a, n]) => `${a}x${n}`).join(' ')}`);
  }
  console.log(`\n${lines} transaction lines -> ${map.size} serials with a single stated airline`);
  if (conflicts.length) {
    console.log(`${conflicts.length} serial(s) claimed by more than one airline (skipped):`);
    conflicts.slice(0, 10).forEach(c => console.log('   ', c));
  }
  return map;
}

async function main() {
  if (!DIR) {
    console.error('usage: tsx scripts/recover-airline-codes.ts --dir=<folder of FCAGBILLDET pdfs> [--apply]');
    process.exit(1);
  }
  const map = await buildMap(DIR);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // The rows needing repair: a bare 10-digit serial wearing its own first
  // three digits as an airline code.
  const { rows: suspect } = await c.query(`
    select id, ticket_no, airline_code, source, date, currency
    from tickets
    where ticket_no ~ '^[0-9]{10}$'
      and airline_code ~ '^[0-9]{3}$'
      and ticket_no like airline_code || '%'
    order by ticket_no`);

  console.log(`\nrows with a scavenged airline code: ${suspect.length}`);

  const fixes: { id: string; tk: string; from: string; to: string }[] = [];
  const confirmed: string[] = [];
  const unmatched: any[] = [];
  for (const r of suspect) {
    const real = map.get(r.ticket_no);
    if (!real) { unmatched.push(r); continue; }
    if (real === r.airline_code) confirmed.push(r.ticket_no);
    else fixes.push({ id: r.id, tk: r.ticket_no, from: r.airline_code, to: real });
  }

  console.log(`  found in the invoices : ${fixes.length + confirmed.length}`);
  console.log(`  wrong, will be fixed  : ${fixes.length}`);
  console.log(`  already correct       : ${confirmed.length}`);
  console.log(`  not in these invoices : ${unmatched.length}`);

  if (fixes.length) {
    const by: Record<string, any> = {};
    for (const f of fixes) {
      const k = `${f.from} -> ${f.to}`;
      by[k] ??= { 'stored (wrong)': f.from, 'invoice says': f.to, rows: 0, example: f.tk };
      by[k].rows++;
    }
    console.log('\n--- corrections ---');
    console.table(Object.values(by).sort((a: any, b: any) => b.rows - a.rows));
  }

  if (unmatched.length) {
    const by: Record<string, any> = {};
    for (const u of unmatched) {
      by[u.airline_code] ??= { code: u.airline_code, rows: 0, example: u.ticket_no, currency: u.currency };
      by[u.airline_code].rows++;
    }
    console.log('\n--- still unresolved (document not in the supplied invoices) ---');
    console.table(Object.values(by));
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit these corrections.');
    await c.end();
    return;
  }
  if (!fixes.length) {
    console.log('\nnothing to write.');
    await c.end();
    return;
  }

  writeFileSync(SNAPSHOT, JSON.stringify({
    takenAt: new Date().toISOString(),
    rows: fixes.map(f => ({ id: f.id, ticket_no: f.tk, airline_code: f.from })),
  }, null, 2));
  console.log(`\nrollback snapshot written: ${SNAPSHOT} (${fixes.length} rows)`);

  await c.query('begin');
  try {
    for (const f of fixes) {
      await c.query('update tickets set airline_code=$1 where id=$2', [f.to, f.id]);
    }
    await c.query('commit');
    console.log(`APPLIED: ${fixes.length} airline codes corrected from the invoices.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }
  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
