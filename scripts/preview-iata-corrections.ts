/**
 * PHASE 7 — commission / balance / missing-issue correction preview.
 *
 * STRICTLY READ-ONLY. Every database statement is a SELECT, and the vendor
 * totals plus every wallet are captured before and after so the claim is
 * demonstrated rather than asserted. Nothing is corrected, inserted or removed.
 *
 * The planning arithmetic lives in src/core/helpers/iataCommissionPlan.ts so it
 * can be tested without a database; this script only supplies the two sides and
 * prints what comes back.
 *
 * Run: npx tsx scripts/preview-iata-corrections.ts <dir-of-invoices> [out.json]
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { Client } from 'pg';
import { runParser } from '../src/core/parsers';
import { extractPdfRows, pdfRowsToCsv } from '../src/core/helpers/pdfText';
import { normDoc, dirOf, type InvoiceTxn } from '../src/core/helpers/iataReconcile';
import {
  planRow, summarise, planIssueStubs, projectScenarios,
  type LedgerSide, type InvoiceSide, type PlanRow, type IssueStub, type Totals,
} from '../src/core/helpers/iataCommissionPlan';

const IATA_VENDOR = 'IATA BSP';
const DIR = process.argv[2];
const OUT = process.argv[3] ?? 'iata-commission-balance-preview.json';

/** The three documents BSP billed as issued while the agency voided them. */
const STUB_DOCS = ['5511323216', '5511323218', '5511323220'];
/** The seven credit-card refunds confirmed correct in Phase 5. */
const CC_REFUNDS = ['5512129174', '5512129175', '5512129176', '5512129177',
                    '5512129178', '5512129179', '5512129180'];

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t: string) => console.log(`\n${'='.repeat(102)}\n${t}\n${'='.repeat(102)}`);
const cents = (n: number) => Math.round(n * 100) / 100;

async function main() {
  if (!DIR || !existsSync(DIR)) {
    console.log('usage: tsx scripts/preview-iata-corrections.ts <dir-of-invoices> [out.json]');
    process.exit(1);
  }

  /* ── invoices, through the fixed parser ───────────────────────────────── */
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

  /* ── ledger, SELECT only ──────────────────────────────────────────────── */
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const vendorSnapshot = async () => (await c.query(`
    select source, count(*)::int as n, coalesce(sum(amount),0)::float8 as net,
           coalesce(sum(commission),0)::float8 as comm, coalesce(sum(total_doc),0)::float8 as fare
    from tickets group by source order by source`)).rows;
  const walletSnapshot = async () => (await c.query(
    `select vendor_name, initial_balance::float8 as ib, current_balance::float8 as cb
     from vendor_balances order by vendor_name`)).rows;
  const idSnapshot = async () => (await c.query(
    `select id from tickets order by id`)).rows.map((r: any) => r.id).join(',');

  const beforeVendors = await vendorSnapshot();
  const beforeWallets = await walletSnapshot();
  const beforeIds = await idSnapshot();

  const { rows: db } = await c.query(
    `select id, ticket_no, status, transaction_type, date, channel, import_batch_id, req_num,
            amount::float8 as amount, total_doc::float8 as fare, commission::float8 as comm
     from tickets where source = $1`, [IATA_VENDOR]);

  /* ── pair each ledger row with its invoice line ───────────────────────── */
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

  const plans: PlanRow[] = [];
  for (const [k, lines] of invByKey) {
    const rows = dbByKey.get(k);
    if (!rows || rows.length !== 1) continue;      // shared keys are out of scope
    const r = rows[0];
    const t = lines.reduce((a, b) => (a.date <= b.date ? a : b));
    if (t.status === 'VOID') continue;
    if (Math.abs(r.comm - t.commission) < 0.011) continue;   // nothing disagrees

    const led: LedgerSide = {
      id: r.id, ticketNo: r.ticket_no, type: r.transaction_type || r.status || '',
      channel: r.channel, date: r.date, fare: r.fare, commission: r.comm, payable: r.amount,
      phase4: Boolean(r.import_batch_id?.startsWith('bsp-phase4-')),
    };
    const inv: InvoiceSide = {
      type: t.rawType, channel: t.channel, date: t.date,
      fare: t.fare, commission: t.commission, payable: t.payable,
    };
    plans.push(planRow(led, inv));
  }

  const totals = summarise(plans);
  const A = plans.filter(p => p.category === 'A genuine missing');
  const B = plans.filter(p => p.category === 'B already net');
  const G = plans.filter(p => p.category === 'G rounding');
  const CC = plans.filter(p => p.category === 'CC card row');
  const anomalies = plans.filter(p => p.category === 'A anomaly' || p.category === 'other');

  H('PARSING');
  console.log(`  invoices ${files.length} · transactions ${invoice.length} · parse errors ${parseErrors}`);
  console.log(`  IATA ledger rows ${db.length}`);

  H('§3-4  CATEGORY A — gross to net');
  console.log(`  rows                       : ${A.length}`);
  console.log(`  commission to be added     : ${money(totals['A genuine missing']?.commissionDelta ?? 0)}`);
  console.log(`  balance payable movement   : ${money(totals['A genuine missing']?.balancePayableDelta ?? 0)}`);
  console.log(`  Phase-4 rows among them    : ${totals['A genuine missing']?.phase4Rows ?? 0}`);
  console.log('\n  validation, all five §4 checks:');
  const checkNames = A.length ? Object.keys(A[0].validation) : [];
  for (const name of checkNames) {
    const ok = A.filter(p => p.validation[name]).length;
    console.log(`     ${ok === A.length ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${ok}/${A.length}`);
  }
  console.log('\n  Document      Type  Date        Cur Fare      Cur Comm    Cur Payable  ->  New Comm    New Payable');
  for (const p of A.slice(0, 15)) {
    console.log(`  ${p.document.padEnd(13)} ${p.transactionType.padEnd(5)} ${p.date}  ${money(p.currentFare).padStart(11)}  ${money(p.currentCommission).padStart(10)}  ${money(p.currentBalancePayable).padStart(13)}  ->  ${money(p.newCommission).padStart(9)}  ${money(p.newBalancePayable).padStart(13)}`);
  }
  if (A.length > 15) console.log(`  ... +${A.length - 15} more (all written to the preview file)`);

  H('§5  CATEGORY B — commission field missing, money already net');
  console.log(`  rows                       : ${B.length}`);
  console.log(`  commission to be added     : ${money(totals['B already net']?.commissionDelta ?? 0)}`);
  console.log(`  balance payable movement   : ${money(totals['B already net']?.balancePayableDelta ?? 0)}`);
  console.log('\n  Document      Type  Date        Cur Payable   Inv Payable   Cur Comm   Inv Comm   verdict');
  for (const p of B) {
    const same = Math.abs(p.currentBalancePayable - p.invoiceBalancePayable) < 0.011;
    console.log(`  ${p.document.padEnd(13)} ${p.transactionType.padEnd(5)} ${p.date}  ${money(p.currentBalancePayable).padStart(12)}  ${money(p.invoiceBalancePayable).padStart(12)}  ${money(p.currentCommission).padStart(8)}  ${money(p.invoiceCommission).padStart(8)}   ${same ? 'MONEY ALREADY NET' : 'MISMATCH — REVIEW'}`);
  }

  H('§6  CATEGORY G — rounding, untouched and excluded from the totals');
  console.log(`  rows                       : ${G.length}`);
  console.log(`  commission difference      : ${money((totals['G rounding']?.invoiceCommission ?? 0) - (totals['G rounding']?.ledgerCommission ?? 0))}`);
  console.log(`  proposed correction        : ${money(totals['G rounding']?.commissionDelta ?? 0)}   (none, by rule)`);

  H('§7  FOP = CC — confirmed correct, no correction proposed');
  const cardRows = invoice.filter(t => t.status !== 'VOID' && t.payable === 0 && t.fare !== 0);
  console.log(`  card rows on the invoices  : ${cardRows.length}`);
  console.log(`  printed commission on them : ${money(cardRows.reduce((s, t) => s + t.commission, 0))}`);
  console.log(`  appearing as a difference  : ${CC.length}   (none means the ledger already agrees)`);
  const sevenLedger = db.filter((r: any) => CC_REFUNDS.includes(r.ticket_no) && r.amount < 0);
  console.log(`\n  the seven refunds:`);
  for (const r of sevenLedger) {
    const inv = invoice.find(t => t.ticketNo === r.ticket_no && t.status === 'REFUND');
    const ok = inv && Math.abs(r.comm - inv.commission) < 0.005 && Math.abs(r.comm) < 0.005;
    console.log(`     ${r.ticket_no}  ledger comm ${money(r.comm).padStart(6)}  invoice comm ${money(inv?.commission ?? 0).padStart(6)}  payable ${money(r.amount).padStart(12)}  ${ok ? 'CORRECT — NO CHANGE' : 'REVIEW'}`);
  }
  console.log(`  proposed corrections among them: ${plans.filter(p => CC_REFUNDS.includes(p.document) && p.commissionDelta !== 0).length}`);

  H('§8-9  THE THREE MISSING BSP ISSUES  (separate from any commission work)');
  const stubs: IssueStub[] = [];
  for (const doc of STUB_DOCS) {
    const issue = invoice.find(t => t.ticketNo === doc && t.status === 'ISSUE');
    const refundInv = invoice.find(t => t.ticketNo === doc && t.status === 'REFUND');
    const refundLed = db.find((r: any) => r.ticket_no === doc && r.amount < 0);
    const voidLed = db.find((r: any) => r.ticket_no === doc && (r.status || '').toUpperCase() === 'VOID');
    if (!issue || !refundLed || !voidLed) { console.log(`  ${doc}: expected rows not found — skipped`); continue; }
    stubs.push({
      document: doc,
      invoiceIssue: { date: issue.date, fare: issue.fare, commission: issue.commission, payable: issue.payable },
      ledgerRefund: { date: refundLed.date, payable: refundLed.amount },
      localVoid: { id: voidLed.id, date: voidLed.date },
    });
    void refundInv;
  }
  const issuePlans = planIssueStubs(stubs);
  for (const p of issuePlans) {
    console.log(`\n  ── ${p.document} ──`);
    console.log(`     BSP issue    ${p.invoiceIssue.date}  ${money(p.invoiceIssue.payable).padStart(12)}   (not in the ledger)`);
    console.log(`     BSP refund   ${p.ledgerRefund.date}  ${money(p.ledgerRefund.payable).padStart(12)}   (in the ledger, Phase-4 import)`);
    console.log(`     local VOID   ${p.localVoid.date}  ${money(0).padStart(12)}   (in the ledger, pre-existing)`);
    console.log(`     true net ${money(p.trueNet)}   ledger net ${money(p.ledgerNet)}   understated by ${money(p.understatement)}`);
    console.log(`     ${p.classification} — ${p.proposedAction}`);
  }
  console.log(`\n  totals: true net ${money(issuePlans.reduce((s, p) => s + p.trueNet, 0))}   ledger net ${money(issuePlans.reduce((s, p) => s + p.ledgerNet, 0))}   understated by ${money(issuePlans.reduce((s, p) => s + p.understatement, 0))}`);

  H('§10  CORRECTION TOTALS, kept apart');
  console.log('  correction                                     commission     balance payable   rows');
  const line = (label: string, comm: number, pay: number, n: number) =>
    console.log(`  ${label.padEnd(44)} ${money(comm).padStart(12)}   ${money(pay).padStart(15)}   ${String(n).padStart(4)}`);
  line('1. Category A — commission', totals['A genuine missing']?.commissionDelta ?? 0, 0, A.length);
  line('2. Category A — balance payable', 0, totals['A genuine missing']?.balancePayableDelta ?? 0, A.length);
  line('3. Category B — commission only', totals['B already net']?.commissionDelta ?? 0, 0, B.length);
  line('4. Category G — rounding', 0, 0, G.length);
  line('5. Missing BSP issues', 0, issuePlans.reduce((s, p) => s + p.invoiceIssue.payable, 0), issuePlans.length);
  line('6. Existing local VOIDs', 0, 0, issuePlans.length);
  console.log(`  ${'-'.repeat(84)}`);
  const commTotal = cents((totals['A genuine missing']?.commissionDelta ?? 0) + (totals['B already net']?.commissionDelta ?? 0));
  line('TOTAL commission field correction', commTotal, totals['A genuine missing']?.balancePayableDelta ?? 0, A.length + B.length);

  H('§11  PROJECTED IATA TOTALS  (hypothetical — nothing applied)');
  const iataNow = beforeVendors.find((r: any) => r.source === IATA_VENDOR);
  const current: Totals = {
    transactions: iataNow.n, fare: iataNow.fare,
    commission: iataNow.comm, balancePayable: iataNow.net,
  };
  const sc = projectScenarios(current, totals, issuePlans);
  const show = (name: string, t: Totals, note: string) => {
    console.log(`\n  ${name}  — ${note}`);
    console.log(`     transactions    ${String(t.transactions).padStart(6)}`);
    console.log(`     fare            ${money(t.fare).padStart(16)}`);
    console.log(`     commission      ${money(t.commission).padStart(16)}`);
    console.log(`     balance payable ${money(t.balancePayable).padStart(16)}`);
  };
  show('CURRENT   ', sc.current, 'what the ledger holds today');
  show('SCENARIO A', sc.scenarioA, 'category A + B commission only');
  show('SCENARIO B', sc.scenarioB, 'scenario A + category A gross-to-net');
  show('SCENARIO C', sc.scenarioC, 'scenario B + the three missing BSP issues');

  if (anomalies.length) {
    H('ROWS SET ASIDE — not included in any correction total');
    for (const p of anomalies) {
      console.log(`  ${p.document.padEnd(13)} ${p.transactionType.padEnd(5)} ${p.category.padEnd(18)} ${p.proposedAction}`);
      for (const [k, v] of Object.entries(p.validation)) if (!v) console.log(`       failed: ${k}`);
    }
  }

  /* ── §13 preview file ─────────────────────────────────────────────────── */
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: 'HYPOTHETICAL ONLY — no database change was made or is authorised by this file.',
    invoices: files.length, invoiceTransactions: invoice.length, iataLedgerRows: db.length,
    categoryTotals: totals,
    scenarios: sc,
    rows: plans,
    missingBspIssues: issuePlans,
  }, null, 2), 'utf8');

  /* ── §14 safety ───────────────────────────────────────────────────────── */
  H('§14  DATABASE SAFETY');
  const afterVendors = await vendorSnapshot();
  const afterWallets = await walletSnapshot();
  const afterIds = await idSnapshot();
  const iataAfter = afterVendors.find((r: any) => r.source === IATA_VENDOR);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  console.log(`  vendor counts and totals identical : ${same(beforeVendors, afterVendors) ? 'YES' : 'NO  <-- PROBLEM'}`);
  console.log(`  all 7 wallets identical            : ${same(beforeWallets, afterWallets) ? 'YES' : 'NO  <-- PROBLEM'}`);
  console.log(`  every row id identical             : ${beforeIds === afterIds ? 'YES' : 'NO  <-- PROBLEM'}`);
  console.log(`  IATA transactions                  : ${iataNow.n} -> ${iataAfter.n}`);
  console.log(`  Phase-4 imported rows present      : ${db.filter((r: any) => r.import_batch_id?.startsWith('bsp-phase4-')).length}`);
  console.log(`  Phase-4 rows proposed for change   : ${plans.filter(p => p.phase4 && (p.commissionDelta !== 0 || p.balancePayableDelta !== 0)).length}`);
  console.log(`  non-IATA vendors                   : ${afterVendors.filter((r: any) => r.source !== IATA_VENDOR).length}`);
  console.log('  statements issued: SELECT only — no INSERT, UPDATE, DELETE, ALTER or TRUNCATE.');
  console.log(`\n  preview written to: ${path.resolve(OUT)}`);
  console.log('  NOTHING WAS APPLIED.');
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
