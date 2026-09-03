/**
 * Check the ledger against NSA's own statements of account.
 *
 * NSA's Ticketwise statement is the only document that says what THEY think
 * happened, and it carries five kinds of line:
 *
 *   INV  tickets they billed us
 *   RFD  refunds they credited us
 *   RV   receipt vouchers — money we paid them
 *   DMA  debit memos they charged us
 *   DN   debit and credit notes
 *
 * The ledger records tickets and refunds from their ticket export, and
 * payments as wallet top-ups. Nothing has ever compared the two, and the first
 * run found four payments totalling 950,000 SAR that NSA acknowledges
 * receiving and the ledger had never heard of.
 *
 * Reports only. Nothing here writes: a payment the vendor acknowledges still
 * wants checking against the bank before it is entered.
 *
 *   npx tsx scripts/reconcile-nsa-statements.ts --dir=<folder of statements>
 */
import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { Client } from 'pg';

const DIR = process.argv.find(a => a.startsWith('--dir='))?.slice('--dir='.length);
if (!DIR) { console.error('need --dir=<folder of NSA statements>'); process.exit(1); }

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function walk(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  let out: string[] = []; let es: string[] = [];
  try { es = readdirSync(dir); } catch { return []; }
  for (const e of es) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out = out.concat(walk(p, depth + 1));
    else if (/\.xlsx?$/i.test(e) && st.size < 25_000_000) out.push(p);
  }
  return out;
}

/** "16/07/2025" -> "2025-07-16" */
const iso = (d: unknown) => {
  const m = String(d ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

/** The header sits under a block of client details, so it is found by its
 *  columns rather than by counting rows. */
function findHeader(grid: string[][]) {
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const cells = (grid[i] ?? []).map(c => String(c ?? '').trim().toLowerCase());
    if (cells.includes('ticket') && cells.includes('debit')) {
      return { at: i, doc: cells.indexOf('doc no'), date: cells.indexOf('date'),
               debit: cells.indexOf('debit'), credit: cells.indexOf('credit'),
               pax: cells.indexOf('passenger') };
    }
  }
  return null;
}

interface Line { date: string; debit: number; credit: number; pax: string }

(async () => {
  const files = walk(DIR);
  // Each weekly statement repeats the running history, so a document number
  // appears many times. One row per document, first sighting wins.
  const docs = new Map<string, Line>();
  let from = '9999-99-99', to = '0000-00-00', sheets = 0;

  for (const f of files) {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.read(readFileSync(f), { type: 'buffer' }); } catch { continue; }
    for (const s of wb.SheetNames) {
      let grid: string[][];
      try { grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[s], { header: 1, raw: false, defval: '' }); }
      catch { continue; }
      const h = findHeader(grid);
      if (!h) continue;
      sheets++;
      for (const r of grid.slice(h.at + 1)) {
        const cells = (r ?? []).map(c => String(c ?? '').trim());
        const d = iso(cells[h.date]);
        if (d) { if (d < from) from = d; if (d > to) to = d; }
        const doc = cells[h.doc] ?? '';
        if (!/^[A-Z]{2,4}-/.test(doc) || docs.has(doc)) continue;
        const num = (i: number) => Number(String(cells[i] ?? '').replace(/[^0-9.-]/g, '')) || 0;
        docs.set(doc, { date: d, debit: num(h.debit), credit: num(h.credit),
                        pax: h.pax >= 0 ? (cells[h.pax] ?? '') : '' });
      }
    }
  }

  console.log(`${files.length} files, ${sheets} statements`);
  console.log(`covering ${from} to ${to}\n`);
  console.log('Anything dated outside that window cannot be checked here.\n');

  const kinds = new Map<string, { n: number; debit: number; credit: number }>();
  for (const [doc, v] of docs) {
    const k = (doc.match(/^[A-Z]+/) ?? ['?'])[0];
    const rec = kinds.get(k) ?? { n: 0, debit: 0, credit: 0 };
    rec.n++; rec.debit += v.debit; rec.credit += v.credit;
    kinds.set(k, rec);
  }
  const MEANING: Record<string, string> = {
    INV: 'tickets they billed us', RFD: 'refunds they credited us',
    RV: 'payments we made to them', DMA: 'debit memos they charged us',
    DN: 'debit / credit notes',
  };
  console.log('--- what their statements contain ---');
  console.table([...kinds.entries()].sort((a, b) => b[1].n - a[1].n).map(([kind, v]) => ({
    kind, documents: v.n, debit: money(v.debit), credit: money(v.credit),
    meaning: MEANING[kind] ?? '',
  })));

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: tu } = await c.query(
    `select tu.id, tu.date, tu.amount::float8 amount, tu.note
     from balance_topups tu join vendor_balances v on v.id = tu.vendor_id
     where v.vendor_name = 'NSA' order by tu.date`);

  // Matched on amount within eight days: a statement dates a payment when it
  // posts it, which is not always the day it left the bank.
  const used = new Set<string>();
  const theirs: any[] = [];
  let matched = 0;
  for (const [doc, v] of [...docs.entries()]
      .filter(([d]) => d.startsWith('RV-'))
      .sort((a, b) => a[1].date.localeCompare(b[1].date))) {
    const hit = (tu as any[]).find(t => !used.has(t.id)
      && Math.abs(t.amount - v.credit) < 0.005
      && Math.abs(Date.parse(t.date) - Date.parse(v.date)) <= 8 * 86400000);
    if (hit) { used.add(hit.id); matched++; }
    else theirs.push({ document: doc, date: v.date, amount: money(v.credit) });
  }

  console.log(`\n--- payments ---`);
  console.log(`matched on both sides: ${matched}`);
  console.log(`\nON THEIR STATEMENT, NOT IN OUR LEDGER:`);
  console.table(theirs.length ? theirs : [{ result: 'none' }]);
  if (theirs.length) {
    const total = theirs.reduce((s, t) => s + Number(String(t.amount).replace(/,/g, '')), 0);
    console.log(`  ${theirs.length} payment(s), ${money(total)} — our balance understates our credit by this much.`);
  }

  const spare = (tu as any[]).filter(t => !used.has(t.id));
  console.log(`\nIN OUR LEDGER, WITH NO RECEIPT ON THEIR STATEMENTS:`);
  console.table(spare.length
    ? spare.map(t => ({
        date: t.date, amount: money(t.amount), note: t.note,
        why: t.date < from ? 'before the statements begin'
           : t.date > to ? 'after the statements end'
           : 'inside the covered window — worth chasing',
      }))
    : [{ result: 'none' }]);

  // Memos are small but they are money, and a credit note nobody recorded is
  // money the vendor already agrees it owes.
  const memos = [...docs.entries()].filter(([d]) => /^(DMA|DN|ACM|ADM)-/.test(d));
  const { rows: led } = await c.query(
    `select ticket_no, coalesce(route,'') route, coalesce(req_num,'') req_num,
            coalesce(vendor_reference,'') ref from tickets where source = 'NSA'`);
  const held = (doc: string) => (led as any[]).some(t =>
    [t.ticket_no, t.route, t.req_num, t.ref].some(v => String(v).toUpperCase().includes(doc.toUpperCase())));

  console.log(`\n--- memos and notes ---`);
  console.table(memos.map(([doc, v]) => ({
    document: doc, date: v.date,
    'they charged': money(v.debit), 'they credited': money(v.credit),
    'in our ledger': held(doc) ? 'yes' : 'NO',
  })));
  const owedToUs = memos.filter(([d]) => !held(d)).reduce((s, [, v]) => s + v.credit - v.debit, 0);
  if (owedToUs !== 0) {
    console.log(`  credits on their statements that our ledger does not hold: ${money(owedToUs)}`);
  }

  console.log('\n--- what the ledger says the NSA balance is ---');
  console.table((await c.query(
    `select v.vendor_name, v.initial_balance::float8 opening,
            (select coalesce(sum(amount::numeric),0) from balance_topups where vendor_id = v.id)::float8 topups,
            (select coalesce(sum(amount::numeric),0) from tickets
             where source = 'NSA' and status <> 'FUND')::float8 issued
     from vendor_balances v where v.vendor_name = 'NSA'`)).rows
    .map((r: any) => ({
      opening: money(r.opening), 'paid in': money(r.topups), 'drawn down': money(r.issued),
      balance: money(r.opening + r.topups - r.issued),
    })));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
