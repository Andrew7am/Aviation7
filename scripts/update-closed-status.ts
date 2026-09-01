/**
 * Update Closed / Not Closed from the accounting workbook.
 *
 * One sheet per vendor, each naming its tickets differently — some by ticket
 * number, some only by PNR — so every sheet is mapped explicitly rather than
 * guessed at. Matching is scoped to that sheet's vendor, so a PNR that two
 * airlines both happen to use cannot reach across.
 *
 * Three sheets are deliberately skipped, and the reasons matter:
 *   RTS IBTKAR / RTS DXB / NSA  — no status column at all.
 *   FlyAdeal DXB                — its "Status" holds event names and a stray
 *                                 booking code, not a closure state.
 *   FlyAdeal KSA                — its "status" is the AIRLINE's (CONFIRMED),
 *                                 which says nothing about the agency's books.
 *
 * A blank status means the sheet has no opinion, so the ticket is left alone
 * rather than being marked open. Values like "fund" and "dxb" are notes, not
 * states, and are ignored the same way.
 *
 *   npx tsx scripts/update-closed-status.ts "<workbook.xlsx>" [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { ticketMatchKey } from '../src/core/helpers/ticketIdentity';

const FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');

/** How each sheet names its tickets, and which vendor its rows belong to. */
const SHEETS: {
  sheet: string; source: string; idCol: string; idKind: 'ticket' | 'pnr'; statusCol: string;
}[] = [
  { sheet: 'IATA',        source: 'IATA BSP',         idCol: 'ticket number',      idKind: 'ticket', statusCol: 'Status' },
  { sheet: 'FLYDubai',    source: 'FlyDubai',         idCol: 'Booking reference',  idKind: 'pnr',    statusCol: 'Status' },
  { sheet: 'Air Arabia ', source: 'AirArabia',        idCol: 'Ticket Number',      idKind: 'ticket', statusCol: 'Status' },
  { sheet: 'FlyNas',      source: 'Flynas',           idCol: 'PNR2',               idKind: 'pnr',    statusCol: 'Status' },
  { sheet: 'ibtekar',     source: 'Ibtekar',          idCol: 'PNR',                idKind: 'pnr',    statusCol: 'Status' },
  { sheet: 'goldmedal',   source: 'Gold Medal',       idCol: 'Ticket Number',      idKind: 'ticket', statusCol: 'Status' },
];

/** Only an explicit closure state counts. Anything else means "no opinion". */
function readClosed(raw: string): boolean | null {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'closed') return true;
  if (s === 'not closed' || s === 'notclosed') return false;
  return null;
}

/**
 * "4815040418(1 PAX)" -> "4815040418", and a 13-digit form -> its serial.
 *
 * The parenthetical is dropped BEFORE the digits are taken: "(1 PAX)" carries
 * a 1, so stripping non-digits first turns that ticket into 48150404181 and it
 * matches nothing — which is exactly how every Gold Medal row went unmatched.
 */
function normaliseTicket(raw: string): string {
  const digits = (raw || '').replace(/\(.*$/, '').replace(/[^0-9]/g, '');
  return digits ? ticketMatchKey(digits) : '';
}

(async () => {
  if (!FILE) { console.error('usage: tsx scripts/update-closed-status.ts "<workbook.xlsx>" [--apply]'); process.exit(1); }

  const wb = XLSX.read(readFileSync(FILE), { type: 'buffer' });
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: dbRows } = await c.query(
    `select id, ticket_no, pnr, source, closed, date, amount::float8 amount from tickets`);

  const byTicket = new Map<string, any[]>();
  const byPnr = new Map<string, any[]>();
  for (const r of dbRows as any[]) {
    const tk = `${r.source}|${ticketMatchKey(String(r.ticket_no || ''))}`;
    const pn = `${r.source}|${String(r.pnr || '').trim().toUpperCase()}`;
    (byTicket.get(tk) ?? byTicket.set(tk, []).get(tk)!).push(r);
    if (r.pnr) (byPnr.get(pn) ?? byPnr.set(pn, []).get(pn)!).push(r);
  }

  // Keyed by ledger row id, so a ticket the sheet lists twice — an issue line
  // and its refund line — is counted once per LEDGER row rather than once per
  // pairing. Safe to collapse: no id in this workbook carries two different
  // statuses, which was checked across every sheet before writing this.
  const changes = new Map<string, { id: string; from: boolean; to: boolean; sheet: string; key: string }>();
  const report: any[] = [];

  for (const cfg of SHEETS) {
    const ws = wb.Sheets[cfg.sheet];
    if (!ws) { report.push({ sheet: cfg.sheet, note: 'SHEET NOT FOUND' }); continue; }

    const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
    const hi = grid.findIndex(r => r.filter(x => String(x).trim()).length >= 4);
    const head = grid[hi].map(x => String(x).trim());
    const body = grid.slice(hi + 1).filter(r => r.some(x => String(x).trim()));

    const norm = (s: string) => s.trim().toLowerCase();
    const iId = head.findIndex(h => norm(h) === norm(cfg.idCol));
    const iSt = head.findIndex(h => norm(h) === norm(cfg.statusCol));
    if (iId === -1 || iSt === -1) {
      report.push({ sheet: cfg.sheet, note: `column missing (id=${iId} status=${iSt})` });
      continue;
    }

    let stated = 0, matched = 0, already = 0, changed = 0, unmatched = 0, ambiguous = 0;
    for (const r of body) {
      const closed = readClosed(String(r[iSt] ?? ''));
      if (closed === null) continue;
      stated++;

      const rawId = String(r[iId] ?? '').trim();
      const key = cfg.idKind === 'ticket'
        ? `${cfg.source}|${normaliseTicket(rawId)}`
        : `${cfg.source}|${rawId.toUpperCase()}`;
      const hits = (cfg.idKind === 'ticket' ? byTicket : byPnr).get(key) ?? [];

      if (hits.length === 0) { unmatched++; continue; }
      if (hits.length > 1) ambiguous++;
      matched += hits.length;

      for (const h of hits) {
        if (Boolean(h.closed) === closed) { already++; continue; }
        if (!changes.has(h.id)) {
          changes.set(h.id, { id: h.id, from: Boolean(h.closed), to: closed, sheet: cfg.sheet, key: rawId });
          changed++;
        }
      }
    }
    report.push({
      sheet: cfg.sheet, vendor: cfg.source, 'rows in sheet': body.length,
      'states a status': stated, 'ledger rows matched': matched,
      'already correct': already, 'would change': changed,
      unmatched, 'one id, many tickets': ambiguous,
    });
  }

  console.log('=== per sheet ===');
  console.table(report);

  const all = [...changes.values()];
  const toClosed = all.filter(x => x.to).length;
  const toOpen = all.filter(x => !x.to).length;
  console.log(`\ndistinct ledger rows changing: ${all.length}   -> Closed: ${toClosed}   -> Not Closed: ${toOpen}`);

  const { rows: before } = await c.query(
    `select count(*) filter (where closed)::int c, count(*) filter (where not closed)::int o from tickets`);
  console.log(`ledger now:   ${before[0].c} closed / ${before[0].o} not closed`);
  console.log(`ledger after: ${before[0].c + toClosed - toOpen} closed / ${before[0].o - toClosed + toOpen} not closed`);

  console.log('\n--- a sample of what would change ---');
  console.table(all.slice(0, 10).map(x => ({
    sheet: x.sheet, id: x.key, from: x.from ? 'Closed' : 'Not Closed', to: x.to ? 'Closed' : 'Not Closed',
  })));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await c.end(); return;
  }
  if (all.length === 0) { console.log('\nnothing to change.'); await c.end(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snap = `closed-status-snapshot-${stamp}.json`;
  writeFileSync(snap, JSON.stringify({ takenAt: new Date().toISOString(), file: FILE, changes: all }, null, 2));
  console.log(`\nrollback snapshot written: ${snap}`);

  await c.query('begin');
  try {
    for (const grp of [true, false]) {
      const ids = all.filter(x => x.to === grp).map(x => x.id);
      if (ids.length) await c.query('update tickets set closed = $1 where id = any($2)', [grp, ids]);
    }
    await c.query('commit');
    console.log(`APPLIED: ${toClosed} marked Closed, ${toOpen} marked Not Closed.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
