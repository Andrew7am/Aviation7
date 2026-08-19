/**
 * PHASE 6 — commission audit. STRICTLY READ-ONLY.
 *
 * Runs the fixed parser over the invoices, compares each printed commission
 * against what the ledger holds, and classifies every difference. It changes
 * nothing: the point is to say exactly what a future correction would touch,
 * and what it would cost, before anyone decides to run one.
 *
 * Database access is SELECT only, and vendor totals are captured before and
 * after so the read-only claim is demonstrated rather than asserted.
 *
 * Run: npx tsx scripts/audit-iata-commission.ts <dir-of-invoices> [out.json]
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { Client } from 'pg';
import { runParser } from '../src/core/parsers';
import { extractPdfRows, pdfRowsToCsv } from '../src/core/helpers/pdfText';
import { normDoc, dirOf, type InvoiceTxn } from '../src/core/helpers/iataReconcile';

const IATA_VENDOR = 'IATA BSP';
const DIR = process.argv[2];
const OUT = process.argv[3] ?? 'iata-commission-audit.json';

const GROUP_B = ['5511323216', '5511323218', '5511323220'];
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t: string) => console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);

/** What a future correction would have to do to a row, if anything. */
type Category =
  | 'A genuine missing'
  | 'B already net'
  | 'G rounding'
  | 'CC card row'
  | 'other';

interface Case {
  doc: string; type: string; date: string; channel: string;
  invFare: number; invComm: number; invPayable: number;
  ledFare: number; ledComm: number; ledPayable: number;
  commDiff: number; payableDiff: number;
  cat: Category; payablePolicy: string; note: string;
  ledgerId: string; phase4: boolean;
}

async function main() {
  if (!DIR || !existsSync(DIR)) {
    console.log('usage: tsx scripts/audit-iata-commission.ts <dir-of-invoices> [out.json]');
    process.exit(1);
  }

  const files = readdirSync(DIR).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f)).sort();
  const invoice: InvoiceTxn[] = [];
  let parseErrors = 0;
  for (const f of files) {
    const buf = readFileSync(path.join(DIR, f));
    const rows = await extractPdfRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const grid = Papa.parse(pdfRowsToCsv(rows), { skipEmptyLines: true }).data as string[][];
    const r = runParser(grid, undefined, 'AED', f);
    parseErrors += r.errors.length;
    for (const x of r.rows) {
      invoice.push({
        ticketNo: x.ticketNo, rawType: x.rawType || '', status: x.status || '', date: x.date,
        channel: x.channel || 'BSP', fare: x.totalDoc ?? 0, commission: x.commission ?? 0,
        payable: x.amount, currency: x.currency || 'AED', file: f,
      });
    }
  }

  H('PARSER OUTPUT — commission now read from the Std and Supp columns');
  console.log(`  invoices           : ${files.length}`);
  console.log(`  transactions       : ${invoice.length}`);
  console.log(`  parse errors       : ${parseErrors}`);
  console.log(`  total printed commission across every invoice: ${money(invoice.reduce((s, t) => s + t.commission, 0))} AED`);
  const cardRows = invoice.filter(t => t.status !== 'VOID' && t.payable === 0 && t.fare !== 0);
  console.log(`  card rows (payable 0.00 against a non-zero fare): ${cardRows.length}`);
  console.log(`  commission carried by those rows               : ${money(cardRows.reduce((s, t) => s + t.commission, 0))} AED`);

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const snapshot = async () => (await c.query(`
    select source, count(*)::int as n, coalesce(sum(amount),0)::float8 as net,
           coalesce(sum(commission),0)::float8 as comm, coalesce(sum(total_doc),0)::float8 as fare
    from tickets group by source order by source`)).rows;
  const wallets = async () => (await c.query(
    `select vendor_name, initial_balance::float8 as ib, current_balance::float8 as cb
     from vendor_balances order by vendor_name`)).rows;
  const before = await snapshot();
  const walletsBefore = await wallets();

  const { rows: db } = await c.query(
    `select id, ticket_no, status, transaction_type, date, channel, import_batch_id, req_num,
            amount::float8 as amount, total_doc::float8 as fare, commission::float8 as comm
     from tickets where source = $1`, [IATA_VENDOR]);

  const dbByKey = new Map<string, any[]>();
  for (const r of db) {
    const k = `${normDoc(r.ticket_no)}|${r.amount < 0 ? '-' : '+'}`;
    const b = dbByKey.get(k); if (b) b.push(r); else dbByKey.set(k, [r]);
  }
  const invByKey = new Map<string, InvoiceTxn[]>();
  for (const t of invoice) {
    const k = `${normDoc(t.ticketNo)}|${dirOf(t.rawType, t.payable)}`;
    const b = invByKey.get(k); if (b) b.push(t); else invByKey.set(k, [t]);
  }

  /* ── classify every commission difference ─────────────────────────────── */
  const cases: Case[] = [];
  for (const [k, lines] of invByKey) {
    const rows = dbByKey.get(k);
    if (!rows || rows.length !== 1) continue;
    const r = rows[0];
    const t = lines.reduce((a, b) => (a.date <= b.date ? a : b));
    if (t.status === 'VOID') continue;
    if (Math.abs(r.comm - t.commission) < 0.011) continue;

    const commDiff = Math.round((t.commission - r.comm) * 100) / 100;
    const payableDiff = Math.round((t.payable - r.amount) * 100) / 100;

    let cat: Category, payablePolicy: string, note: string;
    if (t.payable === 0 && t.fare !== 0) {
      cat = 'CC card row';
      payablePolicy = 'ledger already correct — the invoice settles nothing';
      note = 'credit-card sale: the airline collects directly';
    } else if (Math.abs(r.comm) > 0.005 && Math.abs(commDiff) < 1.0) {
      cat = 'G rounding';
      payablePolicy = 'leave as is';
      note = `ledger ${money(r.comm)} vs printed ${money(t.commission)} — rounded to whole units`;
    } else if (Math.abs(payableDiff) < 0.011) {
      cat = 'B already net';
      payablePolicy = 'Balance Payable is ALREADY correct — only the commission field is blank';
      note = 'money owed is right; the breakdown is missing';
    } else if (Math.abs(Math.abs(r.amount) - Math.abs(t.fare)) < 0.011) {
      cat = 'A genuine missing';
      payablePolicy = 'ledger holds the GROSS — correcting commission would also move payable from gross to net';
      note = 'commission was never recorded';
    } else {
      cat = 'other';
      payablePolicy = 'needs a look';
      note = `ledger ${money(r.amount)} vs invoice fare ${money(t.fare)} / payable ${money(t.payable)}`;
    }

    cases.push({
      doc: t.ticketNo, type: t.rawType, date: t.date, channel: t.channel,
      invFare: t.fare, invComm: t.commission, invPayable: t.payable,
      ledFare: r.fare, ledComm: r.comm, ledPayable: r.amount,
      commDiff, payableDiff, cat, payablePolicy, note,
      ledgerId: r.id, phase4: Boolean(r.import_batch_id?.startsWith('bsp-phase4-')),
    });
  }

  const byCat = new Map<Category, Case[]>();
  for (const cs of cases) { const b = byCat.get(cs.cat); if (b) b.push(cs); else byCat.set(cs.cat, [cs]); }
  const sum = (list: Case[], f: (c: Case) => number) => list.reduce((s, x) => s + f(x), 0);

  H('COMMISSION DIFFERENCES — classified against the PRINTED commission');
  console.log('  category               rows    invoice comm     ledger comm      difference   Phase-4 rows');
  for (const [cat, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${cat.padEnd(20)} ${String(list.length).padStart(5)}  ${money(sum(list, x => x.invComm)).padStart(14)}  ${money(sum(list, x => x.ledComm)).padStart(14)}  ${money(sum(list, x => x.commDiff)).padStart(14)}  ${String(list.filter(x => x.phase4).length).padStart(6)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${String(cases.length).padStart(5)}  ${money(sum(cases, x => x.invComm)).padStart(14)}  ${money(sum(cases, x => x.ledComm)).padStart(14)}  ${money(sum(cases, x => x.commDiff)).padStart(14)}  ${String(cases.filter(x => x.phase4).length).padStart(6)}`);

  H('BALANCE PAYABLE POLICY, per category');
  for (const [cat, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${cat} (${list.length})`);
    console.log(`     ${list[0].payablePolicy}`);
    console.log(`     payable difference across the group: ${money(sum(list, x => x.payableDiff))} AED\n`);
  }

  H('CATEGORY A — the 237-style rows, first 20 of ' + (byCat.get('A genuine missing')?.length ?? 0));
  console.log('  Document      Type  Date        Inv Fare      Inv Comm   Led Comm     Inv Payable    Led Payable    Difference');
  for (const cs of (byCat.get('A genuine missing') ?? []).slice(0, 20)) {
    console.log(`  ${cs.doc.padEnd(13)} ${cs.type.padEnd(5)} ${cs.date}  ${money(cs.invFare).padStart(11)}  ${money(cs.invComm).padStart(10)}  ${money(cs.ledComm).padStart(9)}  ${money(cs.invPayable).padStart(13)}  ${money(cs.ledPayable).padStart(13)}  ${money(cs.commDiff).padStart(11)}`);
  }
  console.log(`  (every row is written in full to ${OUT})`);

  H('CATEGORY B — commission field missing, money already net');
  for (const cs of byCat.get('B already net') ?? []) {
    const ok = Math.abs(cs.invPayable - cs.ledPayable) < 0.011;
    console.log(`  ${cs.doc.padEnd(13)} ${cs.type.padEnd(5)} ${cs.date}  invoice payable ${money(cs.invPayable).padStart(12)}  ledger ${money(cs.ledPayable).padStart(12)}  ${ok ? 'MATCH — COMMISSION FIELD MISSING, MONEY ALREADY NET' : 'MISMATCH'}`);
  }

  /* ── Group B stubs ────────────────────────────────────────────────────── */
  H('GROUP B — the three zero-value stubs');
  for (const doc of GROUP_B) {
    console.log(`\n  ── ${doc} ──`);
    for (const t of invoice.filter(x => x.ticketNo === doc)) {
      console.log(`     INVOICE ${t.rawType.padEnd(5)} ${t.date}  fare ${money(t.fare).padStart(11)}  commission ${money(t.commission).padStart(9)}  payable ${money(t.payable).padStart(12)}  channel ${t.channel}`);
    }
    for (const r of db.filter((x: any) => normDoc(x.ticket_no) === normDoc(doc))) {
      console.log(`     LEDGER  ${String(r.transaction_type || r.status).padEnd(5)} ${r.date}  fare ${money(r.fare).padStart(11)}  commission ${money(r.comm).padStart(9)}  payable ${money(r.amount).padStart(12)}  channel ${r.channel ?? '(none)'}  req ${r.req_num || '—'}  ${r.import_batch_id ? 'PHASE-4 IMPORT' : 'pre-existing'}`);
    }
    const inv = invoice.filter(x => x.ticketNo === doc);
    const issue = inv.find(x => x.status === 'ISSUE');
    const refund = inv.find(x => x.status === 'REFUND');
    const ledgerNet = db.filter((x: any) => normDoc(x.ticket_no) === normDoc(doc))
      .reduce((s: number, x: any) => s + x.amount, 0);
    if (issue && refund) {
      const truth = issue.payable + refund.payable;
      console.log(`     CONSEQUENCE: BSP billed ${money(issue.payable)} then refunded ${money(refund.payable)}, keeping ${money(truth)}.`);
      console.log(`                  The ledger nets ${money(ledgerNet)} because its issue side is a zero-value VOID,`);
      console.log(`                  so IATA is understated by ${money(truth - ledgerNet)} on this document.`);
    }
  }

  /* ── what a correction would cost ─────────────────────────────────────── */
  H('IF A CORRECTION WERE RUN — not applied');
  const A = byCat.get('A genuine missing') ?? [];
  const B = byCat.get('B already net') ?? [];
  const iataComm = before.find((r: any) => r.source === IATA_VENDOR)?.comm ?? 0;
  console.log(`  current total IATA commission        : ${money(iataComm)}`);
  console.log(`  category A — ${String(A.length).padStart(3)} rows, commission would rise by ${money(sum(A, x => x.commDiff))}`);
  console.log(`               and their payable would move from gross to net: ${money(sum(A, x => x.payableDiff))}`);
  console.log(`  category B — ${String(B.length).padStart(3)} rows, commission would rise by ${money(sum(B, x => x.commDiff))}`);
  console.log(`               their payable is already correct: ${money(sum(B, x => x.payableDiff))}`);
  console.log(`  total commission that would be added  : ${money(sum(A, x => x.commDiff) + sum(B, x => x.commDiff))}`);
  console.log(`  resulting IATA commission             : ${money(iataComm + sum(A, x => x.commDiff) + sum(B, x => x.commDiff))}`);
  console.log('\n  NOTHING WAS APPLIED. This is a preview only.');

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    invoices: files.length, invoiceTransactions: invoice.length,
    totals: Object.fromEntries([...byCat.entries()].map(([k, v]) => [k, {
      rows: v.length, invoiceCommission: sum(v, x => x.invComm), ledgerCommission: sum(v, x => x.ledComm),
      commissionDifference: sum(v, x => x.commDiff), payableDifference: sum(v, x => x.payableDiff),
      phase4Rows: v.filter(x => x.phase4).length,
    }])),
    cases,
  }, null, 2), 'utf8');
  console.log(`\n  full per-row detail: ${path.resolve(OUT)}`);

  /* ── read-only proof ──────────────────────────────────────────────────── */
  H('DATABASE SAFETY');
  const after = await snapshot();
  const walletsAfter = await wallets();
  const iata = after.find((r: any) => r.source === IATA_VENDOR);
  console.log(`  vendor counts/totals identical before and after : ${JSON.stringify(before) === JSON.stringify(after) ? 'YES' : 'NO  <-- PROBLEM'}`);
  console.log(`  wallets identical before and after              : ${JSON.stringify(walletsBefore) === JSON.stringify(walletsAfter) ? 'YES' : 'NO  <-- PROBLEM'}`);
  console.log(`  IATA transactions                               : ${iata?.n}`);
  console.log(`  Phase-4 imported rows still present             : ${db.filter((r: any) => r.import_batch_id?.startsWith('bsp-phase4-')).length}`);
  console.log(`  non-IATA vendors                                : ${after.filter((r: any) => r.source !== IATA_VENDOR).length}`);
  console.log('  statements issued: SELECT only — no INSERT, UPDATE, DELETE, ALTER or TRUNCATE.');
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
