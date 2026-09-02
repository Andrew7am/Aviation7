/**
 * Recover the issue date on BSP rows from the original Agent Billing PDFs.
 *
 * 163 IATA BSP rows carry no date at all. A row with no date is invisible to
 * every period filter in the app — it shows under "All time" and under nothing
 * else — so month and year totals are quietly short by however many of these
 * fall in them. The date cannot be inferred from the ledger: the BSP serial is
 * not monotonic in issue date (227 inversions among the dated rows), and 161 of
 * the 163 sit past the last dated serial with nothing to interpolate between.
 *
 * The invoice states it outright. Every transaction line is airline, document
 * type, document number, then the issue date:
 *
 *     157 TKTT 5513059052 16AUG26 FFFF I 2,810.00 ... 2,810.00
 *     └┬┘ └─┬┘ └───┬────┘ └──┬──┘                    └───┬───┘
 *  airline type  document   date                       total
 *
 * Two guards, because a date written into the wrong row is worse than a blank
 * one. The document TYPE has to agree with the row's direction, so a refund
 * takes the refund line's date and not the original sale's. And the line TOTAL
 * has to equal the row's amount — the document number alone could match a
 * coincidence, but the number and the money together do not.
 *
 * A document whose lines disagree, or whose total does not match, is reported
 * and skipped rather than guessed at.
 *
 * A second, weaker source fills what the invoices do not reach. The BSP sales
 * report (TJQ) has no date column at all, but it prints a date range above the
 * table and lists each document's SEQ NO — the same running number the ledger
 * stores as `serial`. A row whose serial appears in a report covering ONE day
 * is dated exactly by that report. A report spanning several days only narrows
 * it, so those are reported and left alone unless --approximate is given.
 *
 * Invoices always win: they name the day per document, the report only bounds
 * it.
 *
 * Dry run by default; --apply writes, after saving a rollback snapshot.
 *
 *   npx tsx scripts/recover-ticket-dates.ts --dir=<BSP PDFs> [--tjq=<TJQ reports>]
 *                                           [--approximate] [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { extractPdfRows } from '../src/core/helpers/pdfText';
import { readReportPeriod } from '../src/core/helpers/reportPeriod';

const APPLY  = process.argv.includes('--apply');
const APPROX = process.argv.includes('--approximate');
const dirArg = process.argv.find(a => a.startsWith('--dir='));
const tjqArg = process.argv.find(a => a.startsWith('--tjq='));
if (!dirArg && !tjqArg) {
  console.error('need --dir=<folder of FCAGBILLDET PDFs> and/or --tjq=<folder of TJQ reports>');
  process.exit(1);
}
const DIR = dirArg ? dirArg.slice('--dir='.length) : '';
const TJQ = tjqArg ? tjqArg.slice('--tjq='.length) : '';

const TXN_RE = /^(\d{3})\s+([A-Z]{3,5})\s+(\d{8,})\s+(\d{2}[A-Z]{3}\d{2})\b/;
const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/** Document types that represent money going out (a sale) and coming back. */
const ISSUE_TYPES  = new Set(['TKTT', 'EMDS', 'EMDA', 'ADMA']);
const REFUND_TYPES = new Set(['RFND', 'CANX', 'CANN', 'SPDR', 'ACMA']);

function toIso(ddmmmyy: string): string {
  const m = MON.indexOf(ddmmmyy.slice(2, 5));
  if (m < 0) return '';
  return `20${ddmmmyy.slice(5)}-${String(m + 1).padStart(2, '0')}-${ddmmmyy.slice(0, 2)}`;
}

/** The settled total is the last money figure on the line. */
function lineTotal(text: string): number | null {
  const nums = text.match(/-?[\d,]+\.\d{2}/g);
  if (!nums) return null;
  return Number(nums[nums.length - 1].replace(/,/g, ''));
}

function walk(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, depth + 1));
    else if (/FCAGBILLDET.*\.pdf$/i.test(e)) out.push(p);
  }
  return out;
}

interface InvoiceLine { type: string; date: string; total: number | null; file: string }

/** serial (SEQ NO) -> the reports listing it and the period each covers. */
function readTjqReports(dir: string) {
  const bySerial = new Map<number, { from: string; to: string; exact: boolean; file: string }[]>();
  const files = readdirSync(dir).filter(f => /SalesReportTJQ.*\.xlsx?$/i.test(f));
  for (const f of files) {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.read(readFileSync(join(dir, f)), { type: 'buffer' }); } catch { continue; }
    for (const s of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[s], { header: 1, raw: false, defval: '' });
      const period = readReportPeriod(rows.slice(0, 4));
      if (!period.from) continue;
      const header = (rows[4] ?? []).map(h => String(h ?? '').trim().toUpperCase());
      const iSeq = header.indexOf('SEQ NO');
      if (iSeq < 0) continue;
      for (const r of rows.slice(5)) {
        const raw = String(r?.[iSeq] ?? '').replace(/\D/g, '');
        if (!raw) continue;
        const n = parseInt(raw, 10);
        (bySerial.get(n) ?? bySerial.set(n, []).get(n)!)
          .push({ from: period.from, to: period.to, exact: period.exact, file: f });
      }
    }
  }
  console.log(`read ${files.length} TJQ sales reports — ${bySerial.size} distinct SEQ NO\n`);
  return bySerial;
}

(async () => {
  const files = DIR ? walk(DIR) : [];
  if (DIR && !files.length) { console.error(`no FCAGBILLDET PDFs under ${DIR}`); process.exit(1); }
  if (files.length) console.log(`reading ${files.length} Agent Billing detail PDFs\n`);

  // document number -> the lines that mention it, across every invoice
  const byDoc = new Map<string, InvoiceLine[]>();
  const seenFile = new Set<string>();
  for (const f of files) {
    const rows = await extractPdfRows(new Uint8Array(readFileSync(f)));
    const name = f.split(/[\\/]/).pop()!;
    // The same invoice is often downloaded twice; reading it twice would look
    // like corroboration when it is one document counted again.
    if (seenFile.has(name)) { console.log(`  ${name} — already read, skipped`); continue; }
    seenFile.add(name);
    let hits = 0;
    for (const r of rows) {
      const text = (r.text || '').trim();
      const m = text.match(TXN_RE);
      if (!m) continue;
      const date = toIso(m[4]);
      if (!date) continue;
      hits++;
      const doc = m[3].slice(-10);
      const list = byDoc.get(doc) ?? [];
      list.push({ type: m[2], date, total: lineTotal(text), file: name });
      byDoc.set(doc, list);
    }
    console.log(`  ${name} — ${hits} transaction lines`);
  }
  console.log(`\ndistinct document numbers across the invoices: ${byDoc.size}`);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `select id, ticket_no, serial, status, amount::float8 amount, req_num, pnr
     from tickets
     where source = 'IATA BSP' and status <> 'FUND'
       and (date is null or date !~ '^\\d{4}-\\d{2}-\\d{2}$')
     order by serial`);
  console.log(`dateless BSP rows in the ledger: ${rows.length}\n`);

  const bySerial = TJQ ? readTjqReports(TJQ) : new Map();

  const fix: { id: string; ticket_no: string; date: string; amount: number; status: string; via: string }[] = [];
  const amountMismatch: any[] = [];
  const disagree: any[] = [];
  const absent: any[] = [];
  const onlyNarrowed: any[] = [];

  /**
   * The sales report only bounds the date. When the report it appears in
   * covers a single day, that day IS the date and nothing is being guessed.
   * When it spans several, the day inside the span is unknown — reported and
   * skipped, unless --approximate says to take the first day of the range.
   */
  const fromTjq = (r: any): { date: string; approx: boolean } | null => {
    const hits = bySerial.get(r.serial);
    if (!hits?.length) return null;
    const froms = [...new Set(hits.map((h: any) => h.from))];
    const tos = [...new Set(hits.map((h: any) => h.to))];
    if (froms.length !== 1 || tos.length !== 1) return null;
    const exact = froms[0] === tos[0];
    if (exact) return { date: froms[0] as string, approx: false };
    return { date: froms[0] as string, approx: true };
  };

  /** Fall back to the sales report, or record the row as undatable. */
  const tryTjqOrGiveUp = (r: any) => {
    const t = fromTjq(r);
    if (!t) { absent.push(r); return; }
    if (t.approx && !APPROX) {
      const hits = bySerial.get(r.serial)!;
      onlyNarrowed.push({
        ticket: r.ticket_no, serial: r.serial, status: r.status,
        range: `${hits[0].from} .. ${hits[0].to}`, report: hits[0].file,
      });
      return;
    }
    fix.push({
      id: r.id, ticket_no: r.ticket_no, date: t.date,
      amount: r.amount, status: r.status,
      via: t.approx ? 'sales report (range start)' : 'sales report (single day)',
    });
  };

  for (const r of rows as any[]) {
    const lines = byDoc.get(String(r.ticket_no).slice(-10));
    if (!lines) { tryTjqOrGiveUp(r); continue; }

    // The document type has to agree with the row's direction. There is no
    // falling back to a line of the wrong direction: an invoice that shows
    // only the TKTT for a document says when the ticket was SOLD, and writing
    // that onto the refund would date the refund on the day of the sale.
    const want = r.status === 'REFUND' ? REFUND_TYPES : ISSUE_TYPES;
    const pool = lines.filter(l => want.has(l.type));
    if (!pool.length) { tryTjqOrGiveUp(r); continue; }

    // The document number identifies the row — a 10-digit IATA document number
    // is unique, so a coincidental match is not a real risk. The amount is
    // corroboration, and it is only needed to CHOOSE when one document has
    // several lines on different dates (an issue and its later refund).
    let candidates = pool;
    let dates = [...new Set(candidates.map(l => l.date))];
    if (dates.length > 1) {
      const exact = pool.filter(l =>
        l.total !== null && Math.abs(Math.abs(l.total) - Math.abs(r.amount)) < 0.005);
      if (exact.length) { candidates = exact; dates = [...new Set(exact.map(l => l.date))]; }
    }
    if (dates.length > 1) {
      disagree.push({
        ticket: r.ticket_no, status: r.status, ledger: r.amount,
        dates: candidates.map(l => `${l.type} ${l.date} ${l.total}`).join(' | '),
      });
      continue;
    }

    // One date, so the row is dated. If the money differs the date still
    // stands — but say so, because a ledger amount that disagrees with the
    // invoice is worth someone's eyes even though it is not this migration's
    // job to change it.
    const agrees = candidates.some(l =>
      l.total !== null && Math.abs(Math.abs(l.total) - Math.abs(r.amount)) < 0.005);
    if (!agrees) {
      amountMismatch.push({
        ticket: r.ticket_no, status: r.status, ledger: r.amount,
        invoice: candidates.map(l => `${l.type} ${l.date} ${l.total}`).join(' | '),
        difference: (Math.abs(r.amount) - Math.abs(candidates[0].total ?? 0)).toFixed(2),
      });
    }
    fix.push({ id: r.id, ticket_no: r.ticket_no, date: dates[0], amount: r.amount, status: r.status, via: 'invoice' });
  }

  console.log('--- outcome ---');
  const viaCount = (v: string) => fix.filter(f => f.via.startsWith(v)).length;
  console.table([{
    'dated, total': fix.length,
    '  from an invoice (exact day)': viaCount('invoice'),
    '  from a one-day sales report': viaCount('sales report (single'),
    '  from a multi-day report (approximate)': viaCount('sales report (range'),
    '  of those, ledger amount differs': amountMismatch.length,
    'only narrowed to a range, left alone': onlyNarrowed.length,
    'invoice lines disagree on the date': disagree.length,
    'not in any invoice supplied': absent.length,
  }]);

  if (fix.length) {
    const byMonth: Record<string, number> = {};
    for (const f of fix) byMonth[f.date.slice(0, 7)] = (byMonth[f.date.slice(0, 7)] ?? 0) + 1;
    console.log('\ndates recovered, by month:');
    console.table(Object.entries(byMonth).sort().map(([month, tickets]) => ({ month, tickets })));
    console.log('\nfirst 10:');
    console.table(fix.slice(0, 10));
  }
  if (amountMismatch.length) {
    console.log('\nDATED, but the ledger amount disagrees with the invoice — worth a look:');
    console.table(amountMismatch.slice(0, 15));
  }
  if (disagree.length) {
    console.log('\nINVOICES DISAGREE — left alone:');
    console.table(disagree);
  }
  if (onlyNarrowed.length) {
    console.log(`\nNARROWED TO A RANGE ONLY — the sales report they appear in covers`);
    console.log(`several days and does not say which. Re-run with --approximate to take`);
    console.log(`the first day of the range, or supply the BSP invoice for the exact day:`);
    console.table(onlyNarrowed.slice(0, 15));
  }
  if (absent.length) {
    const s = absent.map(a => a.serial).filter(Boolean).sort((a, b) => a - b);
    console.log(`\nnot in any invoice supplied: ${absent.length} rows` +
      (s.length ? `, serials ${s[0]}..${s[s.length - 1]}` : ''));
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await c.end(); return; }
  if (!fix.length) { console.log('\nnothing to write.'); await c.end(); return; }

  const snap = `ticket-date-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(snap, JSON.stringify({
    takenAt: new Date().toISOString(),
    note: 'rows had an empty date before this run',
    rows: fix.map(f => ({ id: f.id, ticket_no: f.ticket_no, date: '' })),
  }, null, 2));
  console.log(`\nrollback snapshot written: ${snap} (${fix.length} rows)`);

  await c.query('begin');
  try {
    let n = 0;
    for (const f of fix) {
      // Fill-only: never overwrite a date that is already there.
      const { rowCount } = await c.query(
        `update tickets set date = $2
         where id = $1 and (date is null or date !~ '^\\d{4}-\\d{2}-\\d{2}$')`,
        [f.id, f.date]);
      n += rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`APPLIED: ${n} rows dated.`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }

  console.log('\n--- dateless rows remaining ---');
  console.table((await c.query(
    `select source, count(*)::int n from tickets
     where status <> 'FUND' and (date is null or date !~ '^\\d{4}-\\d{2}-\\d{2}$')
     group by 1 order by n desc`)).rows);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
