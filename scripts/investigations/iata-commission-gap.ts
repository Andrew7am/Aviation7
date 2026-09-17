/**
 * Our commission against the BSP invoice's, document by document.
 *
 * Commission is the half of a settlement that goes wrong quietly. A ticket
 * imported from a daily sales report carries the commission the GDS expected;
 * the invoice then pays a different one, or none, and nothing catches it
 * because the fare matched.
 *
 * The method matters more than it looks. Comparing "the invoice" against "our
 * rows for the same dates" is the obvious thing and it is wrong twice over:
 *
 *   1. BSP bills by the period it PROCESSES a document, not by the date on it.
 *      A refund dated the 16th of August is billed in the first period of
 *      September, so a date window around the invoice misses it entirely and
 *      reports its commission as money we are owed.
 *
 *   2. A document's source in our ledger is the consolidator we bought it
 *      through, and the same airline's stock reaches us through more than one.
 *      Filtering to source = 'IATA BSP' drops documents this very invoice is
 *      billing us for.
 *
 * So the invoice's own document list is the population, and every one of them
 * is looked up across the whole ledger — every source, every date. What is
 * left after that is a real difference.
 *
 *   npx tsx scripts/investigations/iata-commission-gap.ts [pdf]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

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

interface Txn {
  ticketNo: string; trnc: string; date: string;
  transaction: number; comm: number; payable: number;
}

async function readInvoice(path: string) {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const txns: Txn[] = [];
  let grand: number[] = [];
  let period = '';

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const vh = page.getViewport({ scale: 1 }).height;

    const buckets = new Map<number, { x0: number; x1: number; w: string }[]>();
    for (const it of content.items as any[]) {
      const w = (it.str || '').trim();
      if (!w) continue;
      const x0 = it.transform[4];
      const key = Math.round((vh - it.transform[5]) / 4);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push({ x0, x1: x0 + (it.width || 0), w });
    }

    for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
      const words = buckets.get(key)!.sort((a, b) => a.x0 - b.x0);
      const flat = words.map(x => x.w).join(' ');
      if (!period && flat.includes('Billing Period')) period = flat;
      if (flat.startsWith('GRAND TOTAL')) {
        // The total row does not line up with the transaction columns - its
        // label spans the left-hand ones - so it is read in reading order.
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
        comm: (num(get('std_amt')) ?? 0) + (num(get('supp_amt')) ?? 0),
        payable: num(get('payable')) ?? 0,
      });
    }
  }
  return { txns, grand, period };
}

(async () => {
  const path = process.argv[2]
    ?? 'C:/Users/LE.Andrew/Desktop/AE_FCAGBILLDET_8621913_20260901.PDF';
  const { txns, grand, period } = await readInvoice(path);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Every document the invoice names, looked up across the WHOLE ledger.
  const docs = [...new Set(txns.map(t => t.ticketNo))];
  const ledger = (await c.query(
    `select ticket_no, source, date, amount::float8 amount, status,
            coalesce(commission,0)::float8 commission, coalesce(req_num,'') req
       from tickets where ticket_no = any($1::text[])
         and upper(coalesce(status,'')) <> 'FUND'`, [docs])).rows;

  const isRefund = (s: string) => (s || '').toUpperCase() === 'REFUND';
  const key = (t: string, refund: boolean) => `${t}|${refund ? 'R' : 'I'}`;
  const led = new Map<string, any>();
  for (const r of ledger) led.set(key(r.ticket_no, isRefund(r.status)), r);

  const invComm = r2(txns.reduce((n, t) => n + t.comm, 0));

  console.log('='.repeat(96));
  console.log('COMMISSION ON THIS INVOICE, AGAINST THE WHOLE LEDGER');
  console.log('='.repeat(96));
  console.log(`  ${period || path.split(/[\\/]/).pop()}`);
  console.log(`  documents on the invoice   ${String(txns.length).padStart(6)}`);
  console.log(`  commission it paid         ${m(invComm).padStart(14)}`);

  const matched = txns.map(t => {
    const r = led.get(key(t.ticketNo, t.trnc === 'RFND'));
    return { t, r, ours: r ? r2(Number(r.commission)) : null };
  });

  const found = matched.filter(x => x.r);
  const ourComm = r2(found.reduce((n, x) => n + x.ours!, 0));
  console.log(`  we hold                    ${String(found.length).padStart(6)} of them`);
  console.log(`  our commission on those    ${m(ourComm).padStart(14)}`);
  console.log(`  difference                 ${m(r2(ourComm - invComm)).padStart(14)}`);

  const absent = matched.filter(x => !x.r);
  const differing = found.filter(x => Math.abs(r2(x.ours! - x.t.comm)) >= 0.011);
  const elsewhere = found.filter(x => x.r.source !== 'IATA BSP');

  console.log('\n' + '='.repeat(96));
  console.log('WHAT IS ACTUALLY DIFFERENT');
  console.log('='.repeat(96));

  console.log(`\n1. On the invoice, at a different commission to ours: ${differing.length}`);
  for (const x of differing.slice(0, 30))
    console.log(`   ${x.t.ticketNo.padEnd(12)} ${x.t.trnc}  ours ${m(x.ours!).padStart(10)}`
      + `   invoice ${m(x.t.comm).padStart(10)}   ${m(r2(x.ours! - x.t.comm)).padStart(10)}`);
  console.log(`   they differ by ${m(r2(differing.reduce((n, x) => n + (x.ours! - x.t.comm), 0)))}`);

  console.log(`\n2. Billed to us but nowhere in the ledger at all: ${absent.length}`);
  for (const x of absent.slice(0, 30))
    console.log(`   ${x.t.ticketNo.padEnd(12)} ${x.t.trnc}  ${x.t.date.padEnd(9)}`
      + ` fare ${m(x.t.transaction).padStart(12)}  comm ${m(x.t.comm).padStart(9)}`);
  console.log(`   their commission comes to ${m(r2(absent.reduce((n, x) => n + x.t.comm, 0)))}`);

  console.log(`\n3. Held, but filed under another source than IATA BSP: ${elsewhere.length}`);
  for (const x of elsewhere.slice(0, 30))
    console.log(`   ${x.t.ticketNo.padEnd(12)} ${x.t.trnc}  filed as ${String(x.r.source).padEnd(18)}`
      + ` ${x.r.date}  comm ${m(x.ours!).padStart(9)}   ${x.r.req}`);
  console.log(`   their commission comes to ${m(r2(elsewhere.reduce((n, x) => n + x.ours!, 0)))}`);
  console.log('   These are not errors on their own — a document reaches us through');
  console.log('   whichever consolidator sold it. They matter here only because this');
  console.log('   invoice settles them, so the IATA account has to account for them.');

  // Anything the invoice billed whose date falls outside its own period is the
  // trap the date-window method falls into, so it is named rather than implied.
  const stale = found.filter(x => {
    const mth = period.match(/(\d{2}-[A-Z]{3}-\d{4}) to (\d{2}-[A-Z]{3}-\d{4})/);
    if (!mth) return false;
    const d = new Date(x.r.date).getTime();
    return d < new Date(mth[1]).getTime() || d > new Date(mth[2]).getTime();
  });
  console.log(`\n4. Billed in this period but dated outside it: ${stale.length}`);
  for (const x of stale.slice(0, 20))
    console.log(`   ${x.t.ticketNo.padEnd(12)} ${x.t.trnc}  our date ${x.r.date}`
      + `   comm ${m(x.ours!).padStart(10)}   (${x.r.source})`);
  console.log(`   their commission comes to ${m(r2(stale.reduce((n, x) => n + x.ours!, 0)))}`);
  console.log('   BSP bills by the period it PROCESSES a document, not the date on it.');
  console.log('   Comparing a date window against this invoice reports these as a gap.');

  console.log('\n' + '-'.repeat(96));
  const real = r2(differing.reduce((n, x) => n + (x.ours! - x.t.comm), 0)
                - absent.reduce((n, x) => n + x.t.comm, 0));
  console.log(Math.abs(real) < 0.011
    ? `  Every fils of commission on this invoice is accounted for in the ledger.`
    : `  ${m(real)} of commission is genuinely unaccounted for.`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
