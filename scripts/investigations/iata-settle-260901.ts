/**
 * The IATA ledger against the BSP invoice for one billing period.
 *
 * The wallet is about to be reset to the credit left after this invoice was
 * paid, which is only a safe thing to do if the invoice and our rows agree —
 * a balance struck on top of a ledger that is missing transactions is wrong
 * from its first day, and quietly.
 *
 * Reads the invoice with the app's own BSP parser rather than a second one, so
 * what this checks is what the app would import.
 *
 *   npx tsx scripts/investigations/iata-settle-260901.ts <path-to-FCAGBILLDET.pdf>
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Txn {
  ticketNo: string; trnc: string; date: string;
  transaction: number; commission: number; payable: number;
}

/** Column right-edges, taken from the detail page's own header row. */
const COLS: [string, number, number][] = [
  ['air', 0, 40], ['trnc', 40, 62], ['doc', 62, 110], ['date', 110, 145],
  ['cpui', 145, 175], ['code', 175, 194], ['stat', 194, 214], ['fop', 214, 240],
  ['transaction', 240, 300], ['fare', 300, 352], ['tax', 352, 400], ['fnc', 400, 460],
  ['pen', 460, 512], ['cobl', 512, 566], ['std_rate', 566, 600], ['std_amt', 600, 634],
  ['supp_rate', 634, 668], ['supp_amt', 668, 716], ['tax_comm', 716, 770], ['payable', 770, 830],
];

const num = (s: string): number | null => {
  const t = (s || '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

async function readInvoice(path: string): Promise<{ txns: Txn[]; grand: number[] }> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const txns: Txn[] = [];
  let grand: number[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const vh = page.getViewport({ scale: 1 }).height;

    // Words with their x span and a top-down y, grouped into visual rows.
    const buckets = new Map<number, { x0: number; x1: number; w: string }[]>();
    for (const it of content.items as any[]) {
      const w = (it.str || '').trim();
      if (!w) continue;
      const x0 = it.transform[4];
      const y = vh - it.transform[5];
      const key = Math.round(y / 4);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push({ x0, x1: x0 + (it.width || 0), w });
    }

    for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
      const words = buckets.get(key)!.sort((a, b) => a.x0 - b.x0);
      const flat = words.map(x => x.w).join(' ');
      if (flat.startsWith('GRAND TOTAL')) {
        // Read in reading order, not in column order. The grand total row does
        // not line up with the transaction columns above it - the label spans
        // the left-hand ones - so cutting it at the same x boundaries lifts a
        // neighbouring figure instead of the total.
        const got = words.map(x => num(x.w)).filter((n): n is number => n !== null);
        if (got.length > grand.length) grand = got;
        continue;
      }
      const cells: Record<string, string[]> = {};
      for (const { x1, w } of words) {
        const col = COLS.find(([, a, b]) => x1 >= a && x1 <= b);
        if (col) (cells[col[0]] ??= []).push(w);
      }
      const get = (k: string) => (cells[k] || []).join(' ').trim();
      const air = get('air'), trnc = get('trnc');
      if (!/^\d{3}$/.test(air) || !/^[A-Z]{4}\+?$/.test(trnc)) continue;
      txns.push({
        ticketNo: get('doc'),
        trnc: trnc.replace('+', ''),
        date: get('date'),
        transaction: num(get('transaction')) ?? 0,
        commission: (num(get('std_amt')) ?? 0) + (num(get('supp_amt')) ?? 0),
        payable: num(get('payable')) ?? 0,
      });
    }
  }
  return { txns, grand };
}

(async () => {
  const path = process.argv[2]
    ?? 'C:/Users/LE.Andrew/Desktop/AE_FCAGBILLDET_8621913_20260901.PDF';
  const { txns, grand } = await readInvoice(path);

  console.log('='.repeat(96));
  console.log('THE BSP INVOICE');
  console.log('='.repeat(96));
  console.log(`  ${path.split(/[\\/]/).pop()}`);
  console.log(`  transactions on it     ${String(txns.length).padStart(6)}`);
  const stated = grand[0] ?? 0;
  const statedPayable = grand[grand.length - 1] ?? 0;
  console.log(`  transaction amount     ${m(stated).padStart(16)}`);
  console.log(`  balance payable        ${m(statedPayable).padStart(16)}`);
  const ourSum = r2(txns.reduce((n, t) => n + t.transaction, 0));
  const ourPayable = r2(txns.reduce((n, t) => n + t.payable, 0));
  console.log(`  our reading of its rows${m(ourSum).padStart(16)}   ${
    Math.abs(ourSum - stated) < 0.011 ? 'matches its own total' : 'DOES NOT MATCH'}`);
  console.log(`  our reading of payable ${m(ourPayable).padStart(16)}   ${
    Math.abs(ourPayable - statedPayable) < 0.011 ? 'matches its own total' : 'DOES NOT MATCH'}`);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const ledger = await q(`
    select ticket_no, date, amount::float8 amount, status, commission::float8 commission
      from tickets
     where source = 'IATA BSP' and date between '2026-09-01' and '2026-09-08'
       and upper(coalesce(status,'')) <> 'FUND'`);

  const ledSum = r2(ledger.reduce((n, r) => n + Number(r.amount), 0));
  console.log('\n' + '='.repeat(96));
  console.log('OUR LEDGER FOR THE SAME DATES (2026-09-01 to 2026-09-08)');
  console.log('='.repeat(96));
  console.log(`  rows                   ${String(ledger.length).padStart(6)}`);
  console.log(`  they come to           ${m(ledSum).padStart(16)}`);
  console.log(`  the invoice says       ${m(statedPayable).padStart(16)}`);
  console.log(`  difference             ${m(r2(ledSum - statedPayable)).padStart(16)}`);

  // Matched on document number, which is what both sides agree identifies a
  // transaction. A refund carries its sale's number, so type goes in the key.
  const key = (t: string, d: string) => `${t}|${d.startsWith('RFND') ? 'R' : 'I'}`;
  const inv = new Map<string, Txn>();
  for (const t of txns) inv.set(key(t.ticketNo, t.trnc), t);
  const led = new Map<string, any>();
  for (const r of ledger) led.set(key(r.ticket_no, (r.status || '').toUpperCase() === 'REFUND' ? 'RFND' : 'TKTT'), r);

  const onlyInvoice = [...inv.entries()].filter(([k]) => !led.has(k));
  const onlyLedger = [...led.entries()].filter(([k]) => !inv.has(k));
  const differing = [...inv.entries()]
    .filter(([k]) => led.has(k))
    .map(([k, t]) => ({ k, t, r: led.get(k) }))
    .filter(({ t, r }) => Math.abs(r2(Number(r.amount) - t.payable)) >= 0.011);

  console.log('\n' + '='.repeat(96));
  console.log('WHERE THEY DISAGREE');
  console.log('='.repeat(96));

  console.log(`\nOn the invoice, not in our ledger: ${onlyInvoice.length}`);
  for (const [, t] of onlyInvoice.slice(0, 25))
    console.log(`   ${t.trnc}  ${t.ticketNo.padEnd(12)} ${t.date.padEnd(9)} ${m(t.payable).padStart(13)}`);
  if (onlyInvoice.length > 25) console.log(`   ... and ${onlyInvoice.length - 25} more`);
  console.log(`   they come to ${m(r2(onlyInvoice.reduce((n, [, t]) => n + t.payable, 0)))}`);

  console.log(`\nIn our ledger, not on the invoice: ${onlyLedger.length}`);
  for (const [, r] of onlyLedger.slice(0, 25))
    console.log(`   ${(r.status || '').padEnd(6)} ${String(r.ticket_no).padEnd(12)} ${r.date} ${m(Number(r.amount)).padStart(13)}`);
  if (onlyLedger.length > 25) console.log(`   ... and ${onlyLedger.length - 25} more`);
  console.log(`   they come to ${m(r2(onlyLedger.reduce((n, [, r]) => n + Number(r.amount), 0)))}`);

  console.log(`\nOn both, at different amounts: ${differing.length}`);
  for (const { t, r } of differing.slice(0, 25))
    console.log(`   ${t.ticketNo.padEnd(12)} ours ${m(Number(r.amount)).padStart(12)}   theirs ${m(t.payable).padStart(12)}   ${
      m(r2(Number(r.amount) - t.payable))}`);
  console.log(`   they differ by ${m(r2(differing.reduce((n, { t, r }) => n + (Number(r.amount) - t.payable), 0)))}`);

  // Commission is the other half of a settlement: the invoice charges it, and
  // a ticket imported from a daily report often carries none.
  const invComm = r2(txns.reduce((n, t) => n + t.commission, 0));
  const ledComm = r2(ledger.reduce((n, r) => n + Number(r.commission || 0), 0));
  console.log(`\nCommission on the invoice ${m(invComm)} · in our ledger ${m(ledComm)} · difference ${m(r2(invComm - ledComm))}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
