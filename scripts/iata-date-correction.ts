/**
 * IATA DATE CORRECTION — from BSP invoices, IATA records only.
 *
 * IATA tickets currently carry the FILE UPLOAD date as their transaction date
 * (verified: 1,153 tickets all dated 2026-07-03, the day they were imported).
 * The BSP invoices carry the real issue/refund date on every line, so they are
 * the authoritative source.
 *
 * SAFETY, by construction:
 *   - Every SQL statement filters on source = 'IATA BSP'. A ticket number that
 *     also exists under NSA, Ibtekar or RTS is never seen, let alone touched.
 *   - PREVIEW BY DEFAULT. Writes only with --apply.
 *   - Only the `date` column is ever written. Amounts, commission, req nums,
 *     channel and status are read for matching and left alone.
 *   - A blank invoice date never overwrites an existing date.
 *   - Idempotent: a row already holding the invoice date is reported as
 *     ALREADY CORRECT and not rewritten, so re-running changes nothing.
 *
 * Usage:
 *   npx tsx scripts/iata-date-correction.ts <dir-of-invoices>            # preview
 *   npx tsx scripts/iata-date-correction.ts <dir-of-invoices> --apply    # write
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { inflateSync } from 'zlib';
import path from 'path';
import { Client } from 'pg';

const IATA_VENDOR = 'IATA BSP';
const APPLY = process.argv.includes('--apply');
const DIR = process.argv[2];

/* ── invoice reading (self-contained; mirrors the app parser) ───────────── */
const ESC: Record<string, string> = { n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', '(':'(', ')':')', '\\':'\\' };
const unesc = (t: string) => t
  .replace(/\\([nrtbf()\\])/g, (_, c) => ESC[c])
  .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

function pdfLines(file: string): string[] {
  const buf = readFileSync(file);
  const s = buf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let c: string;
    try { c = inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { continue; }
    if (!/\bTj\b|\bTJ\b/.test(c)) continue;
    let x = 0, y = 0;
    const runs: { x: number; y: number; t: string }[] = [];
    for (const line of c.split(/\r?\n/)) {
      const tm = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+Tm/);
      if (tm) { x = parseFloat(tm[5]); y = parseFloat(tm[6]); }
      else { const td = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+Td/); if (td) { x += parseFloat(td[1]); y += parseFloat(td[2]); } }
      for (const t of line.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) runs.push({ x, y, t: unesc(t[1]) });
      const TJ = line.match(/\[(.*)\]\s*TJ/);
      if (TJ) { const j = [...TJ[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(p => unesc(p[1])).join(''); if (j) runs.push({ x, y, t: j }); }
    }
    const byY = new Map<number, typeof runs>();
    for (const r of runs) { const k = Math.round(r.y * 2) / 2; const b = byY.get(k); if (b) b.push(r); else byY.set(k, [r]); }
    for (const [, arr] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
      out.push(arr.sort((a, b) => a.x - b.x).map(r => r.t).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

const MONTHS: Record<string, string> = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
const bspDate = (d: string) => {
  const m = d.toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  return m && MONTHS[m[2]] ? `20${m[3]}-${MONTHS[m[2]]}-${m[1]}` : '';
};
const MONEY = /-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}/g;
const TXN = /^(\d{3})\s+([A-Z]{3,5})\s+(\d{8,})\s+(\d{2}[A-Z]{3}\d{2})\b(.*)$/i;
const REFUNDY = new Set(['RFND', 'RFNC']);

interface InvTxn { doc: string; trnc: string; date: string; channel: string; payable: number; period: string; file: string }

function readInvoice(file: string): InvTxn[] {
  const out: InvTxn[] = [];
  let channel = 'BSP';
  let section = '';
  let period = '';
  for (const line of pdfLines(file)) {
    const per = line.match(/Billing Period:\s*(\d+)/i);
    if (per) period = per[1];
    const cat = line.match(/^CATEGORY\s+([A-Z][A-Z0-9\-\s]*?)\s*$/i);
    if (cat) { channel = cat[1].trim().toUpperCase(); continue; }
    const sec = line.match(/^\*+\s*(ISSUES|REFUNDS|DEBIT MEMOS|CREDIT MEMOS)\b/i);
    if (sec) { section = sec[1].toUpperCase(); continue; }
    const m = line.match(TXN);
    if (!m) continue;
    const nums = (m[5].match(MONEY) || []).map(v => parseFloat(v.replace(/,/g, '')));
    const payable = nums.length ? Math.round(nums[nums.length - 1] * 100) / 100 : 0;
    const trnc = m[2].toUpperCase();
    out.push({
      doc: m[3], trnc, date: bspDate(m[4]), channel, payable,
      period, file: path.basename(file),
    });
    void section;
  }
  return out;
}

/* ── matching ───────────────────────────────────────────────────────────── */
/** Document numbers are compared on digits with leading zeros stripped; the
 *  original is kept for display. Direction (money sign) is part of the key so
 *  a refund never matches the issue of the same document. */
const normDoc = (d: string) => d.replace(/[^0-9]/g, '').replace(/^0+/, '');
const dirOf = (trnc: string, payable: number) =>
  REFUNDY.has(trnc) || payable < 0 ? '-' : '+';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  if (!DIR || !existsSync(DIR)) {
    console.log('usage: tsx scripts/iata-date-correction.ts <dir-of-invoices> [--apply]');
    process.exit(1);
  }
  const files = readdirSync(DIR).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f)).sort();
  console.log(`invoices: ${files.length}`);

  const invoice: InvTxn[] = [];
  for (const f of files) invoice.push(...readInvoice(path.join(DIR, f)));
  console.log(`invoice transactions: ${invoice.length}`);

  // Where one document+direction appears in several periods, the EARLIEST
  // date is the issue date; later appearances are re-billings of the same
  // document and must not overwrite it.
  const best = new Map<string, InvTxn>();
  for (const t of invoice) {
    if (!t.date) continue;
    const k = `${normDoc(t.doc)}|${dirOf(t.trnc, t.payable)}`;
    const prev = best.get(k);
    if (!prev || t.date < prev.date) best.set(k, t);
  }
  console.log(`distinct document+direction keys with a date: ${best.size}`);

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // === IATA ONLY. Every read and write below carries this filter. ===
  const { rows: iata } = await c.query(
    `select id, ticket_no, status, date, amount::float8 as amount, import_time::date::text as uploaded
     from tickets where source = $1`, [IATA_VENDOR]);
  console.log(`IATA tickets in ledger: ${iata.length}\n`);

  const updates: any[] = [], already: any[] = [], noMatch: InvTxn[] = [], unmatchedTickets: any[] = [];
  const seen = new Set<string>();

  for (const t of iata) {
    const k = `${normDoc(t.ticket_no)}|${t.amount < 0 ? '-' : '+'}`;
    const inv = best.get(k);
    if (!inv) { unmatchedTickets.push(t); continue; }
    seen.add(k);
    if (t.date === inv.date) { already.push({ t, inv }); continue; }
    updates.push({ t, inv });
  }
  for (const [k, inv] of best) if (!seen.has(k)) noMatch.push(inv);

  console.log('='.repeat(96));
  console.log('IATA DATE CORRECTION PREVIEW   (vendor = IATA BSP only)');
  console.log('='.repeat(96));
  console.log('Vendor | Ticket        | Type  | Current Date | Invoice Date | Source       | Action');
  console.log('-'.repeat(96));
  for (const u of updates.slice(0, 40)) {
    console.log(`IATA   | ${u.t.ticket_no.padEnd(13)} | ${u.inv.trnc.padEnd(5)} | ${(u.t.date || '—').padEnd(12)} | ${u.inv.date.padEnd(12)} | BSP Invoice  | UPDATE`);
  }
  if (updates.length > 40) console.log(`       ... +${updates.length - 40} more`);
  for (const n of noMatch.slice(0, 10)) {
    console.log(`IATA   | ${n.doc.padEnd(13)} | ${n.trnc.padEnd(5)} | ${'—'.padEnd(12)} | ${n.date.padEnd(12)} | BSP Invoice  | MISSING FROM SYSTEM`);
  }
  if (noMatch.length > 10) console.log(`       ... +${noMatch.length - 10} more missing`);

  console.log('-'.repeat(96));
  console.log(`  UPDATE (date corrected)      : ${updates.length}`);
  console.log(`  ALREADY CORRECT (no write)   : ${already.length}`);
  console.log(`  MISSING FROM SYSTEM          : ${noMatch.length}   (not created — out of scope this phase)`);
  console.log(`  IATA tickets with no invoice : ${unmatchedTickets.length}   (left untouched)`);

  const fromUpload = updates.filter(u => u.t.date === u.t.uploaded).length;
  console.log(`\n  of the updates, ${fromUpload} currently hold their UPLOAD date`);
  const blanks = updates.filter(u => !u.t.date).length;
  console.log(`  of the updates, ${blanks} currently hold NO date`);

  if (!APPLY) {
    console.log('\nPREVIEW ONLY — no database writes. Re-run with --apply to write.');
    await c.end();
    return;
  }

  // ── apply: IATA only, date column only ──
  const before = await c.query(
    `select source, count(*)::int as n, coalesce(sum(amount),0)::float8 as net,
            count(*) filter (where date <> '' and date is not null)::int as dated
     from tickets group by source order by source`);

  let written = 0;
  await c.query('begin');
  try {
    for (const u of updates) {
      const r = await c.query(
        `update tickets set date = $1 where id = $2 and source = $3`,
        [u.inv.date, u.t.id, IATA_VENDOR]);
      written += r.rowCount ?? 0;
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; }

  const after = await c.query(
    `select source, count(*)::int as n, coalesce(sum(amount),0)::float8 as net,
            count(*) filter (where date <> '' and date is not null)::int as dated
     from tickets group by source order by source`);

  console.log(`\nAPPLIED — ${written} IATA date(s) written.\n`);
  console.log('vendor            rows    net             dated   verdict');
  for (const b of before.rows) {
    const a = after.rows.find((r: any) => r.source === b.source)!;
    const isIata = b.source === IATA_VENDOR;
    const untouched = a.n === b.n && Math.abs(Number(a.net) - Number(b.net)) < 0.005 && a.dated === b.dated;
    const verdict = isIata
      ? `IATA — dated ${b.dated} -> ${a.dated}`
      : (untouched ? 'unchanged' : '*** CHANGED — SCOPE VIOLATION ***');
    console.log(`${String(b.source).padEnd(17)} ${String(a.n).padStart(5)}  ${Number(a.net).toFixed(2).padStart(14)}  ${String(a.dated).padStart(5)}   ${verdict}`);
  }
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
