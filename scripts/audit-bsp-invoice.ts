/**
 * PHASE 2 — READ-ONLY RECONCILIATION AUDIT
 *
 * Independently verifies the BSP invoice against the live ledger.
 *
 * The important property of this script is that it does NOT reuse the
 * importer's arithmetic. BSPInvoiceParser derives commission as
 * fare - payable, so checking "fare - commission == payable" against it would
 * be tautological. Here every money column is read from its own position on
 * the page — the invoice's column headers give x coordinates, and each number
 * is assigned to the column it physically sits under. Standard and
 * supplementary commission are therefore read as printed, and the invoice's
 * stated formula is then checked against values that were never computed from
 * each other.
 *
 * STRICTLY READ-ONLY: every database statement here is a SELECT.
 *
 * Run: npx tsx scripts/audit-bsp-invoice.ts [invoice.pdf]
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { inflateSync } from 'zlib';
import { Client } from 'pg';
import { vendorMatchesSource, calcVendorBalance } from '../src/core/helpers/walletMath';
import type { VendorBalance } from '../src/types';

const PDF = process.argv[2] ?? 'C:/Users/andre/AppData/Local/Temp/AE_FCAGBILLDET_8621913_20260802.PDF';

/* ── independent PDF extraction, with x positions ───────────────────────── */
const ESC: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
const unesc = (t: string) => t
  .replace(/\\([nrtbf()\\])/g, (_, c) => ESC[c])
  .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

interface Run { x: number; t: string }
interface Row { y: number; runs: Run[] }

function extractRows(file: string): Row[] {
  const buf = readFileSync(file);
  const s = buf.toString('latin1');
  const out: Row[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let content: string;
    try { content = inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { continue; }
    if (!/\bTj\b|\bTJ\b/.test(content)) continue;

    let x = 0, y = 0;
    const runs: (Run & { y: number })[] = [];
    for (const line of content.split(/\r?\n/)) {
      const tm = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+Tm/);
      if (tm) { x = parseFloat(tm[5]); y = parseFloat(tm[6]); }
      else {
        const td = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+Td/);
        if (td) { x += parseFloat(td[1]); y += parseFloat(td[2]); }
      }
      for (const t of line.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) runs.push({ x, y, t: unesc(t[1]) });
      const TJ = line.match(/\[(.*)\]\s*TJ/);
      if (TJ) {
        const j = [...TJ[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(p => unesc(p[1])).join('');
        if (j) runs.push({ x, y, t: j });
      }
    }
    const byY = new Map<number, (Run & { y: number })[]>();
    for (const r of runs) {
      const k = Math.round(r.y * 2) / 2;
      const b = byY.get(k); if (b) b.push(r); else byY.set(k, [r]);
    }
    for (const [y2, arr] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
      out.push({ y: y2, runs: arr.sort((a, b) => a.x - b.x).map(r => ({ x: r.x, t: r.t })) });
    }
  }
  return out;
}

/* Column bands taken from the invoice's own header row positions. */
const BAND = {
  txn:       [250, 300],
  fare:      [300, 360],
  cobl:      [520, 560],
  stdRate:   [560, 600],
  stdAmt:    [600, 635],
  suppRate:  [635, 670],
  suppAmt:   [670, 730],
  taxOnComm: [730, 775],
  payable:   [775, 835],
} as const;

const MONEY = /^-?[\d,]+\.\d{2}$/;
const num = (t: string) => parseFloat(t.replace(/[,\s]/g, ''));
const cents = (n: number) => Math.round(n * 100) / 100;
const inBand = (x: number, b: readonly [number, number]) => x >= b[0] && x < b[1];

const MONTHS: Record<string, string> = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
const isoDate = (d: string) => {
  const m = d.toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  return m && MONTHS[m[2]] ? `20${m[3]}-${MONTHS[m[2]]}-${m[1]}` : '';
};

interface Txn {
  channel: string; section: string; airline: string; trnc: string;
  doc: string; date: string; iso: string;
  txn: number; fare: number; stdComm: number; suppComm: number; taxOnComm: number; payable: number;
}

function parseInvoice(rows: Row[]) {
  const txns: Txn[] = [];
  let channel = 'IATA BSP';
  let section = '';
  let currency = 'AED';

  for (const row of rows) {
    const line = row.runs.map(r => r.t).join(' ').replace(/\s+/g, ' ').trim();

    const cur = line.match(/GRAND TOTAL\s*\(([A-Z]{3})\)/);
    if (cur) currency = cur[1];

    const cat = line.match(/^CATEGORY\s+([A-Z][A-Z0-9\-\s]*?)\s*$/i);
    if (cat) { const n = cat[1].trim().toUpperCase(); channel = n === 'BSP' ? 'IATA BSP' : n; continue; }

    const sec = line.match(/^\*+\s*(ISSUES|REFUNDS|DEBIT MEMOS|CREDIT MEMOS)\b/i);
    if (sec) { section = sec[1].toUpperCase(); continue; }

    const m = line.match(/^(\d{3})\s+(TKTT|RFND|EMDA|EMDS|EMDX|CANX|CANN|RFNC|ADMA|ACMA)\s+(\d{8,})\s+(\d{2}[A-Z]{3}\d{2})\b/i);
    if (!m) continue;

    const pick = (b: readonly [number, number]) => {
      const hit = row.runs.find(r => MONEY.test(r.t.trim()) && inBand(r.x, b));
      return hit ? cents(num(hit.t)) : 0;
    };

    txns.push({
      channel, section, airline: m[1], trnc: m[2].toUpperCase(), doc: m[3],
      date: m[4], iso: isoDate(m[4]),
      txn: pick(BAND.txn), fare: pick(BAND.fare),
      stdComm: pick(BAND.stdAmt), suppComm: pick(BAND.suppAmt),
      taxOnComm: pick(BAND.taxOnComm), payable: pick(BAND.payable),
    });
  }
  return { txns, currency };
}

/* ── report ─────────────────────────────────────────────────────────────── */
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t: string) => console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`);

async function main() {
  if (!existsSync(PDF)) { console.log(`invoice not found: ${PDF}`); process.exit(1); }

  const rows = extractRows(PDF);
  const { txns, currency } = parseInvoice(rows);

  H('A. PDF TOTALS  (columns read by position, commission NOT derived)');
  const bsp = txns.filter(t => t.channel === 'IATA BSP');
  const web = txns.filter(t => t.channel === 'WEBSALES-EDIS');
  console.log(`  transactions       : ${txns.length}`);
  console.log(`  currency           : ${currency}`);
  console.log(`  BSP                : ${bsp.length}`);
  console.log(`  WEBSALES-EDIS      : ${web.length}`);
  const sum = (a: Txn[], f: (t: Txn) => number) => cents(a.reduce((s, t) => s + f(t), 0));
  console.log(`  sum Transaction Amt: ${money(sum(txns, t => t.txn))}`);
  console.log(`  sum Std Comm       : ${money(sum(txns, t => t.stdComm))}`);
  console.log(`  sum Supp Comm      : ${money(sum(txns, t => t.suppComm))}`);
  console.log(`  sum Balance Payable: ${money(sum(txns, t => t.payable))}`);

  H('5. BALANCE PAYABLE — independent verification');
  console.log('  Checking, per row:  Payable == Transaction Amount - Std Comm - Supp Comm');
  console.log('  Commission read from its own column; signs preserved, no Math.abs.\n');
  let okRows = 0; const badRows: Txn[] = [];
  for (const t of txns) {
    const expect = cents(t.txn - t.stdComm - t.suppComm);
    if (Math.abs(expect - t.payable) < 0.011) okRows++; else badRows.push(t);
  }
  console.log(`  rows satisfying the formula : ${okRows}/${txns.length}`);
  if (badRows.length) {
    console.log('  rows NOT satisfying it:');
    for (const t of badRows) {
      console.log(`    ${t.trnc} ${t.doc}  txn=${money(t.txn)} std=${money(t.stdComm)} supp=${money(t.suppComm)} taxOnComm=${money(t.taxOnComm)} payable=${money(t.payable)} expected=${money(cents(t.txn - t.stdComm - t.suppComm))}`);
    }
  }
  const refunds = txns.filter(t => t.txn < 0);
  console.log(`\n  refund rows checked (signed, no abs): ${refunds.length}`);
  for (const t of refunds.slice(0, 4)) {
    console.log(`    ${t.trnc} ${t.doc}  ${money(t.txn)} - ${money(t.stdComm)} - ${money(t.suppComm)} = ${money(cents(t.txn - t.stdComm - t.suppComm))}  (invoice says ${money(t.payable)})`);
  }

  H('B / C. CHANNEL TOTALS');
  for (const [name, list] of [['IATA BSP', bsp], ['WEBSALES-EDIS', web]] as const) {
    console.log(`  ${name}`);
    console.log(`    transactions     : ${list.length}`);
    console.log(`    Transaction Amt  : ${money(sum(list, t => t.txn))}`);
    console.log(`    total commission : ${money(cents(sum(list, t => t.stdComm) + sum(list, t => t.suppComm)))}`);
    console.log(`    Balance Payable  : ${money(sum(list, t => t.payable))}`);
  }

  /* ── against the live ledger (SELECT only) ───────────────────────────── */
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: db } = await c.query(
    `select ticket_no, source, status, date, amount::float8 as amount,
            total_doc::float8 as total_doc, commission::float8 as commission, req_num
     from tickets where ticket_no = any($1)`,
    [txns.map(t => t.doc.replace(/^0+/, '')).concat(txns.map(t => t.doc))]
  );
  const dbBy = new Map<string, typeof db>();
  for (const r of db) {
    const k = r.ticket_no.replace(/[^0-9]/g, '').replace(/^0+/, '');
    const b = dbBy.get(k); if (b) b.push(r); else dbBy.set(k, [r]);
  }
  const findDb = (t: Txn) => {
    const list = dbBy.get(t.doc.replace(/[^0-9]/g, '').replace(/^0+/, '')) ?? [];
    const wantNeg = t.payable < 0;
    return list.find(r => (r.amount < 0) === wantNeg) ?? list[0];
  };

  const missing: Txn[] = [], commMissing: { t: Txn; db: any }[] = [], commDiff: { t: Txn; db: any }[] = [], matched: Txn[] = [];
  for (const t of txns) {
    const d = findDb(t);
    if (!d) { missing.push(t); continue; }
    const invComm = cents(t.stdComm + t.suppComm);
    const sysComm = cents(d.commission);
    if (Math.abs(invComm) > 0.005 && Math.abs(sysComm) < 0.005) commMissing.push({ t, db: d });
    else if (Math.abs(invComm - sysComm) > 0.005) commDiff.push({ t, db: d });
    else matched.push(t);
  }

  H('D. TRANSACTIONS ON THE INVOICE BUT NOT IN THE SYSTEM');
  console.log(`  count: ${missing.length}\n`);
  for (const t of missing) {
    const total = cents(t.stdComm + t.suppComm);
    console.log(`  ${t.channel} | ${t.trnc} | ${t.doc} | ${t.date} (${t.iso}) | ${currency}`);
    console.log(`      Fare / Transaction Amount : ${money(t.txn)}`);
    console.log(`      Standard Commission       : ${money(t.stdComm)}`);
    console.log(`      Supplementary Commission  : ${money(t.suppComm)}`);
    console.log(`      Total Commission          : ${money(total)}`);
    console.log(`      Balance Payable           : ${money(t.payable)}`);
    console.log(`      Matching key              : ticket_no "${t.doc}" (digits, leading zeros stripped) + sign of payable`);
    console.log(`      Why NEW                   : no ticket with that number in the ledger for this money direction`);
    console.log('');
  }

  H('H / I. SPLIT OF THE MISSING TRANSACTIONS');
  const missBsp = missing.filter(t => t.channel === 'IATA BSP');
  const missWeb = missing.filter(t => t.channel === 'WEBSALES-EDIS');
  console.log(`  BSP           : ${missBsp.length} transactions, Balance Payable ${money(sum(missBsp, t => t.payable))}`);
  console.log(`  WEBSALES-EDIS : ${missWeb.length} transactions, Balance Payable ${money(sum(missWeb, t => t.payable))}`);
  console.log(`  TOTAL         : ${money(sum(missing, t => t.payable))}`);

  H('F. COMMISSION MISSING  (invoice charges it, ledger has none)');
  let gap = 0;
  for (const { t, db: d } of commMissing) {
    const total = cents(t.stdComm + t.suppComm);
    gap = cents(gap + Math.abs(total));
    console.log(`  ${t.trnc} ${t.doc} ${t.date}`);
    console.log(`      invoice Std Comm  : ${money(t.stdComm)}   (read from the Std Comm Amt column)`);
    console.log(`      invoice Supp Comm : ${money(t.suppComm)}   (read from the Supp Comm Amt column)`);
    console.log(`      invoice total     : ${money(total)}`);
    console.log(`      ledger commission : ${money(d.commission)}`);
    console.log(`      invoice payable   : ${money(t.payable)}   ledger amount: ${money(d.amount)}   difference: ${money(cents(t.payable - d.amount))}`);
  }
  console.log(`\n  G. TOTAL COMMISSION GAP: ${money(gap)} ${currency}`);

  H('E. COMMISSION DIFFERENCES  (both sides have commission, amounts differ)');
  console.log(`  count: ${commDiff.length}\n`);
  for (const { t, db: d } of commDiff) {
    const total = cents(t.stdComm + t.suppComm);
    console.log(`  ${t.trnc} ${t.doc} ${t.date}  invoice=${money(total)}  ledger=${money(d.commission)}  diff=${money(cents(total - d.commission))}`);
  }

  H('J. WALLET IMPACT');
  const iata: VendorBalance = { id: 'v', vendorName: 'IATA', initialBalance: 0, currentBalance: 0, userId: 'u' };
  const asLedger = txns.map(t => ({ source: t.channel, amount: t.payable, status: t.trnc === 'RFND' ? 'REFUND' : 'ISSUE' }));
  const bspOnlyLedger = asLedger.filter(r => r.source === 'IATA BSP');
  const balAll = calcVendorBalance(iata, asLedger, []);
  const balBsp = calcVendorBalance(iata, bspOnlyLedger, []);
  console.log(`  WEBSALES-EDIS`);
  console.log(`     Included in reconciliation : YES  (${web.length} transactions, ${money(sum(web, t => t.payable))})`);
  console.log(`     Included in IATA wallet    : ${vendorMatchesSource('IATA', 'WEBSALES-EDIS') ? 'YES  <-- PROBLEM' : 'NO'}`);
  console.log(`  BSP`);
  console.log(`     Included in reconciliation : YES  (${bsp.length} transactions)`);
  console.log(`     Attaches to IATA wallet    : ${vendorMatchesSource('IATA', 'IATA BSP') ? 'YES (unchanged)' : 'NO  <-- PROBLEM'}`);
  console.log(`  IATA balance from BSP rows only        : ${money(balBsp)}`);
  console.log(`  IATA balance with web rows also present: ${money(balAll)}`);
  console.log(`  => web sales move the IATA wallet by   : ${money(cents(balAll - balBsp))}`);

  H('L. ANOMALIES');
  const anomalies: string[] = [];
  if (badRows.length) anomalies.push(`${badRows.length} row(s) do not satisfy Payable = Txn - StdComm - SuppComm`);
  const taxOnCommNonZero = txns.filter(t => Math.abs(t.taxOnComm) > 0.005);
  if (taxOnCommNonZero.length) anomalies.push(`${taxOnCommNonZero.length} row(s) carry a non-zero Tax on Commission`);
  const zeroDate = txns.filter(t => !t.iso);
  if (zeroDate.length) anomalies.push(`${zeroDate.length} row(s) have an unparseable date`);
  const dupDocs = new Map<string, number>();
  for (const t of txns) dupDocs.set(t.doc + (t.payable < 0 ? '-' : '+'), (dupDocs.get(t.doc + (t.payable < 0 ? '-' : '+')) ?? 0) + 1);
  const repeats = [...dupDocs.entries()].filter(([, n]) => n > 1);
  if (repeats.length) anomalies.push(`${repeats.length} document number(s) appear twice in the same direction: ${repeats.map(([k]) => k).join(', ')}`);
  const issuedAndRefunded = txns.filter(t => t.trnc === 'RFND').filter(t => txns.some(o => o.doc === t.doc && o.trnc === 'TKTT'));
  if (issuedAndRefunded.length) anomalies.push(`${issuedAndRefunded.length} document(s) both issued and refunded within this invoice: ${issuedAndRefunded.map(t => t.doc).join(', ')}`);
  console.log(anomalies.length ? anomalies.map(a => '  - ' + a).join('\n') : '  none');

  H('SUMMARY');
  console.log(`  invoice transactions : ${txns.length}   (BSP ${bsp.length}, WEBSALES-EDIS ${web.length})`);
  console.log(`  matched              : ${matched.length}`);
  console.log(`  missing from system  : ${missing.length}   (BSP ${money(sum(missBsp, t => t.payable))}, WEB ${money(sum(missWeb, t => t.payable))})`);
  console.log(`  commission missing   : ${commMissing.length}   total ${money(gap)}`);
  console.log(`  commission differs   : ${commDiff.length}`);
  console.log(`  DATABASE WRITES      : 0  (this script issues SELECT statements only)`);

  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
