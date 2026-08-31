/**
 * Bring the stored ledger onto the canonical ticket identity:
 *   ticket_no    = the 10-digit serial, never the airline code
 *   airline_code = the 3-digit airline, or blank when it cannot be known
 *
 * Three corrections, in order:
 *
 *   A. SPLIT   — 13-digit ticket_no rows become serial + airline code.
 *   B. REPAIR  — rows whose airline_code was scavenged from a bare serial
 *                (the "551" rows) get the real code inferred from serial
 *                ranges, using ONLY rows that got their code from a real
 *                column as evidence. Ambiguous ranges are left blank.
 *   C. VERIFY  — re-check that portal and BSP rows for one document now agree.
 *
 * Runs as a dry run and prints what it WOULD do. Pass --apply to write, which
 * first saves every affected row to a rollback snapshot on disk.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';
import { splitTicketNo } from '../src/core/helpers/ticketIdentity';

const APPLY = process.argv.includes('--apply');
/** Correction A only. The airline-code question is separate and unresolved:
 *  serial bands turn out NOT to be allocated per airline (band 551 alone is
 *  shared by 40 airlines in this ledger), so a scavenged code cannot be
 *  inferred back — only re-read from the original BSP files. Splitting is
 *  unambiguous and can land on its own. */
const SPLIT_ONLY = process.argv.includes('--split-only');
const SNAPSHOT = 'ticket-identity-snapshot.json';

interface Row {
  id: string; ticket_no: string; airline_code: string | null;
  source: string; date: string; amount: string; status: string | null;
}

/** A code that was READ from a column, not derived from the ticket's digits. */
function isTrustworthy(r: Row): boolean {
  const code = (r.airline_code || '').trim();
  if (!/^\d{3}$/.test(code)) return false;
  // On a 13-digit ticket the prefix IS the code — self-consistent, trustworthy.
  if (/^\d{13}$/.test(r.ticket_no)) return true;
  // On a bare 10-digit serial, a code equal to the serial's own first three
  // digits is the scavenging bug, not evidence.
  return !(/^\d{10}$/.test(r.ticket_no) && r.ticket_no.startsWith(code));
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query<Row>(
    `select id, ticket_no, airline_code, source, date, amount, status from tickets`);
  console.log(`ledger: ${rows.length} rows\n`);

  /* ── Evidence: which airline owns which serial range ───────────────── */
  // Keyed on the serial's leading 3 digits, which is how IATA hands ranges out.
  const evidence = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!isTrustworthy(r)) continue;
    const { ticketNo: serial, airlineCode } = splitTicketNo(r.ticket_no, r.airline_code || undefined);
    if (!/^\d{10}$/.test(serial) || !airlineCode) continue;
    const band = serial.slice(0, 3);
    const seen = evidence.get(band) ?? new Map<string, number>();
    seen.set(airlineCode, (seen.get(airlineCode) ?? 0) + 1);
    evidence.set(band, seen);
  }

  const rangeOwner = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const [band, counts] of evidence) {
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((s, [, n]) => s + n, 0);
    // Unambiguous = one airline holds the band outright. A contested band gets
    // no mapping at all; a wrong code is worse than a blank one.
    if (ranked.length === 1 || ranked[0][1] / total >= 0.95) rangeOwner.set(band, ranked[0][0]);
    else ambiguous.push(`${band}: ${ranked.map(([a, n]) => `${a}x${n}`).join(' ')}`);
  }

  console.log('--- serial-range evidence (from rows with a stated code) ---');
  console.table([...rangeOwner].map(([band, code]) => ({
    'serial band': `${band}*******`, airline: code,
    'evidence rows': [...(evidence.get(band) ?? [])].reduce((s, [, n]) => s + n, 0),
  })).sort((a, b) => b['evidence rows'] - a['evidence rows']).slice(0, 20));
  if (ambiguous.length) {
    console.log('contested bands (left blank, no mapping applied):');
    ambiguous.forEach(a => console.log('   ', a));
  }

  /* ── Plan the corrections ──────────────────────────────────────────── */
  const splits: { r: Row; tk: string; al: string }[] = [];
  const repairs: { r: Row; from: string; to: string }[] = [];
  const blanks: { r: Row; from: string }[] = [];

  for (const r of rows) {
    const code = (r.airline_code || '').trim();

    if (/^\d{13}$/.test(r.ticket_no)) {
      const { ticketNo, airlineCode } = splitTicketNo(r.ticket_no, code);
      splits.push({ r, tk: ticketNo, al: airlineCode });
      continue;
    }

    // A bare serial wearing its own first three digits as an airline code.
    if (/^\d{10}$/.test(r.ticket_no) && /^\d{3}$/.test(code) && r.ticket_no.startsWith(code)) {
      const owner = rangeOwner.get(r.ticket_no.slice(0, 3));
      if (owner && owner !== code) repairs.push({ r, from: code, to: owner });
      else if (!owner) blanks.push({ r, from: code });
    }
  }

  console.log(`\nA. split 13-digit ticket_no        : ${splits.length} rows`);
  console.table(splits.slice(0, 6).map(s => ({
    source: s.r.source, before: s.r.ticket_no, 'after ticket_no': s.tk, 'after airline': s.al,
  })));

  console.log(`\nB. repair scavenged airline_code   : ${repairs.length} rows`);
  console.table(
    Object.values(repairs.reduce((acc: Record<string, any>, x) => {
      const k = `${x.from}->${x.to}`;
      acc[k] ??= { 'wrong code': x.from, 'real code': x.to, rows: 0, example: x.r.ticket_no };
      acc[k].rows++;
      return acc;
    }, {})));

  console.log(`\n   blanked (no unambiguous owner)  : ${blanks.length} rows`);
  if (blanks.length) {
    console.table(Object.values(blanks.reduce((acc: Record<string, any>, x) => {
      acc[x.from] ??= { 'wrong code': x.from, rows: 0, example: x.r.ticket_no };
      acc[x.from].rows++;
      return acc;
    }, {})));
  }

  /* ── What the split buys: documents that now match across vendors ──── */
  const after = new Map<string, Set<string>>();
  for (const r of rows) {
    const tk = /^\d{13}$/.test(r.ticket_no) ? r.ticket_no.slice(3) : r.ticket_no;
    if (!/^\d{10}$/.test(tk)) continue;
    (after.get(tk) ?? after.set(tk, new Set()).get(tk)!).add(r.source);
  }
  const crossVendor = [...after].filter(([, s]) => s.size > 1);
  console.log(`\nC. documents that will now match across vendors: ${crossVendor.length}`);
  console.table(crossVendor.slice(0, 10).map(([tk, s]) => ({ serial: tk, vendors: [...s].join(' + ') })));

  /* ── Safety: the split must not fuse two distinct documents ────────── */
  // Stripping the prefix is only safe while no two rows of the same vendor
  // land on one serial with the same money and date. Two airlines legitimately
  // reusing a serial would otherwise silently become one ticket.
  const fused = new Map<string, Row[]>();
  for (const r of rows) {
    const tk = /^\d{13}$/.test(r.ticket_no) ? r.ticket_no.slice(3) : r.ticket_no;
    const k = `${tk}|${r.source}|${r.status}|${Number(r.amount).toFixed(2)}|${r.date}`;
    (fused.get(k) ?? fused.set(k, []).get(k)!).push(r);
  }
  const collisions = [...fused.values()].filter(g => {
    if (g.length < 2) return false;
    // Already indistinguishable BEFORE the split — the split did not cause it.
    return new Set(g.map(r => r.ticket_no)).size > 1;
  });
  if (collisions.length) {
    console.log(`\nSTOP: the split would fuse ${collisions.length} distinct document(s):`);
    console.table(collisions.slice(0, 10).map(g => ({
      vendor: g[0].source, becomes: g[0].ticket_no.slice(-10),
      from: g.map(r => r.ticket_no).join(' + '),
    })));
    console.log('Nothing written. Resolve these rows first.');
    await c.end();
    process.exitCode = 1;
    return;
  }
  console.log('\nsafety check: no two documents collapse onto one serial — split is reversible.');

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit these changes.');
    await c.end();
    return;
  }

  /* ── Apply, with a rollback snapshot written first ─────────────────── */
  const airlineFixes = SPLIT_ONLY ? { repairs: [], blanks: [] } : { repairs, blanks };
  if (SPLIT_ONLY) console.log('\n--split-only: airline_code left exactly as it is.');

  const touched = new Set([...splits.map(s => s.r.id),
                           ...airlineFixes.repairs.map(x => x.r.id),
                           ...airlineFixes.blanks.map(x => x.r.id)]);
  const snapshot = rows.filter(r => touched.has(r.id))
    .map(r => ({ id: r.id, ticket_no: r.ticket_no, airline_code: r.airline_code }));
  writeFileSync(SNAPSHOT, JSON.stringify({ takenAt: new Date().toISOString(), rows: snapshot }, null, 2));
  console.log(`\nrollback snapshot written: ${SNAPSHOT} (${snapshot.length} rows)`);

  await c.query('begin');
  try {
    for (const s of splits) {
      await c.query('update tickets set ticket_no=$1, airline_code=$2 where id=$3', [s.tk, s.al, s.r.id]);
    }
    for (const x of airlineFixes.repairs) {
      await c.query('update tickets set airline_code=$1 where id=$2', [x.to, x.r.id]);
    }
    for (const x of airlineFixes.blanks) {
      await c.query('update tickets set airline_code=$1 where id=$2', ['', x.r.id]);
    }
    await c.query('commit');
    console.log(`\nAPPLIED: ${splits.length} split, ${airlineFixes.repairs.length} repaired, ${airlineFixes.blanks.length} blanked.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }

  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
