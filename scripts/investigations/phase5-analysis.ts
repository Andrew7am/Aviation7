/**
 * PHASE 5 — IATA discrepancy investigation. STRICTLY READ-ONLY.
 *
 * Every money column is read from its own x position under the invoice's own
 * column headings, so the invoice's commission is taken AS PRINTED and never
 * derived as fare - payable. That distinction is the whole point: the importer
 * derives it, and where the two disagree the derivation is what is wrong.
 *
 * Database access is SELECT only. Counts are captured before and after and
 * compared, so the read-only claim is demonstrated rather than asserted.
 *
 * Run: npx tsx scripts/investigations/phase5-analysis.ts <dir-of-invoices>
 */
import 'dotenv/config';
import { readdirSync } from 'fs';
import path from 'path';
import { Client } from 'pg';
import { extractRows, text, type Row } from './phase5-raw-rows';
import { normDoc, dirOf } from '../../src/core/helpers/iataReconcile';

const IATA_VENDOR = 'IATA BSP';
const DIR = process.argv[2];

const GROUP_A = ['5512129174', '5512129175', '5512129176', '5512129177', '5512129178', '5512129179', '5512129180'];
const GROUP_B = ['5511323216', '5511323218', '5511323220'];

/* Column bands, from the invoice's own heading row:
   Amount@270 | Amount@324 | ... | Amount@540 | Rate@570 Amt@619 | Rate@642 Amt@698 | Comm@746 | Payable@797 */
const BAND = {
  txn:       [250, 300],
  fare:      [300, 360],
  cobl:      [520, 560],
  stdAmt:    [600, 635],
  suppAmt:   [670, 730],
  taxOnComm: [730, 775],
  payable:   [775, 835],
} as const;

const MONEY = /^-?[\d,]+\.\d{2}$/;
const num = (t: string) => parseFloat(t.replace(/[,\s]/g, ''));
const cents = (n: number) => Math.round(n * 100) / 100;
const inBand = (x: number, b: readonly [number, number]) => x >= b[0] && x < b[1];
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t: string) => console.log(`\n${'='.repeat(96)}\n${t}\n${'='.repeat(96)}`);

const MONTHS: Record<string, string> = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
const isoDate = (d: string) => {
  const m = d.toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  return m && MONTHS[m[2]] ? `20${m[3]}-${MONTHS[m[2]]}-${m[1]}` : '';
};

const TXN_RE = /^(\d{3})\s+([A-Z]{3,5})\s+(\d{8,})\s+(\d{2}[A-Z]{3}\d{2})\b/i;

interface Txn {
  file: string; page: number; channel: string; section: string;
  trnc: string; doc: string; iso: string;
  txn: number; fare: number; stdComm: number; suppComm: number; taxOnComm: number; payable: number;
  rtdn: string | null; fop: string | null; raw: string;
}

function readInvoice(file: string): { txns: Txn[]; headers: string[] } {
  const rows = extractRows(file);
  const txns: Txn[] = [];
  const headers: string[] = [];
  let channel = 'BSP', section = '';

  for (let i = 0; i < rows.length; i++) {
    const row: Row = rows[i];
    const line = text(row);

    if (/Balance/.test(line) && /Tax on/.test(line)) {
      headers.push(row.runs.filter(r => /Amount|Amt|Payable|Rate|Comm/i.test(r.t)).map(r => `${r.t}@${r.x.toFixed(0)}`).join(' '));
    }
    const cat = line.match(/^CATEGORY\s+([A-Z][A-Z0-9\-\s]*?)\s*$/i);
    if (cat) { channel = cat[1].trim().toUpperCase(); continue; }
    const sec = line.match(/^\*+\s*(ISSUES|REFUNDS|DEBIT MEMOS|CREDIT MEMOS)\b/i);
    if (sec) { section = sec[1].toUpperCase(); continue; }

    const m = line.match(TXN_RE);
    if (!m) continue;

    const pick = (b: readonly [number, number]) => {
      const hit = row.runs.find(r => MONEY.test(r.t.trim()) && inBand(r.x, b));
      return hit ? cents(num(hit.t)) : 0;
    };

    // An RTDN continuation line sits below its own transaction, before the
    // next one. It names the related document the transaction settles against.
    // The form of payment sits in the FOP column (header FOP@217); for card
    // sales it is printed on a continuation line rather than the main row.
    let rtdn: string | null = null;
    let fop: string | null =
      row.runs.find(r => inBand(r.x, [210, 235]) && /^[A-Z]{2}$/.test(r.t.trim()))?.t.trim() ?? null;
    for (let k = i + 1; k < rows.length; k++) {
      const t2 = text(rows[k]);
      if (TXN_RE.test(t2)) break;
      if (!fop) {
        const f = rows[k].runs.find(r => inBand(r.x, [210, 235]) && /^[A-Z]{2}$/.test(r.t.trim()));
        if (f) fop = f.t.trim();
      }
      const r = t2.match(/^\+RTDN:\s*(\d{8,})/);
      if (r) { rtdn = r[1]; break; }
    }

    txns.push({
      file: path.basename(file), page: row.page, channel, section,
      trnc: m[2].toUpperCase(), doc: m[3], iso: isoDate(m[4]),
      txn: pick(BAND.txn), fare: pick(BAND.fare), stdComm: pick(BAND.stdAmt),
      suppComm: pick(BAND.suppAmt), taxOnComm: pick(BAND.taxOnComm), payable: pick(BAND.payable),
      rtdn, fop, raw: line,
    });
  }
  return { txns, headers };
}

const isVoidType = (t: Txn) => t.trnc === 'CANX' || t.trnc === 'CANN';
/** Commission as PRINTED, never derived. */
const explicitComm = (t: Txn) => cents(t.stdComm + t.suppComm);
/** Commission as the importer computes it. */
const derivedComm = (t: Txn) => cents(t.txn - t.payable);

async function main() {
  const files = readdirSync(DIR).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f)).sort();
  const invoice: Txn[] = [];
  const headerShapes = new Set<string>();
  for (const f of files) {
    const { txns, headers } = readInvoice(path.join(DIR, f));
    invoice.push(...txns);
    headers.forEach(h => headerShapes.add(h));
  }

  H('0. COLUMN GEOMETRY — are the bands valid for all 32 invoices?');
  console.log(`  distinct column-heading layouts across ${files.length} invoices: ${headerShapes.size}`);
  for (const h of headerShapes) console.log(`     ${h}`);
  console.log(`  transactions read positionally: ${invoice.length}`);

  H('0b. DOES THE INVOICE\'S OWN FORMULA HOLD?   Payable = Txn Amount - Std - Supp +/- Tax on Comm');
  const valued = invoice.filter(t => !isVoidType(t));
  const holds = valued.filter(t => Math.abs(t.txn - t.stdComm - t.suppComm - t.payable) < 0.011);
  const holdsTax = valued.filter(t => Math.abs(t.txn - t.stdComm - t.suppComm + t.taxOnComm - t.payable) < 0.011);
  const breaks = valued.filter(t => Math.abs(t.txn - t.stdComm - t.suppComm - t.payable) >= 0.011
                                 && Math.abs(t.txn - t.stdComm - t.suppComm + t.taxOnComm - t.payable) >= 0.011);
  console.log(`  valued (non-VOID) transactions      : ${valued.length}`);
  console.log(`  formula holds without tax-on-comm   : ${holds.length}`);
  console.log(`  holds once tax-on-comm is included  : ${holdsTax.length}`);
  console.log(`  formula does NOT hold               : ${breaks.length}`);
  const breaksWithRtdn = breaks.filter(t => t.rtdn);
  console.log(`     of those, carrying an RTDN reference: ${breaksWithRtdn.length}`);
  console.log(`     of those, payable exactly 0.00      : ${breaks.filter(t => Math.abs(t.payable) < 0.005).length}`);

  H('0c. WHERE THE IMPORTER\'S DERIVED COMMISSION DISAGREES WITH THE PRINTED ONE');
  const mismatch = valued.filter(t => Math.abs(derivedComm(t) - explicitComm(t)) >= 0.011);
  console.log(`  rows where derived (fare - payable) != printed (Std + Supp): ${mismatch.length}`);
  console.log(`  total printed commission on those rows : ${money(mismatch.reduce((s, t) => s + explicitComm(t), 0))}`);
  console.log(`  total derived commission on those rows : ${money(mismatch.reduce((s, t) => s + derivedComm(t), 0))}`);
  console.log(`  overstatement introduced by deriving   : ${money(mismatch.reduce((s, t) => s + derivedComm(t) - explicitComm(t), 0))}`);
  const byType = new Map<string, number>();
  for (const t of mismatch) byType.set(t.trnc, (byType.get(t.trnc) ?? 0) + 1);
  console.log(`  by type: ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  carrying an RTDN reference: ${mismatch.filter(t => t.rtdn).length}`);
  console.log(`\n  the invoice's own footnote defines Balance Payable as`);
  console.log(`  "Transaction Amount CA FOP (or 0) - Std Comm - Supp Comm +/- Tax on Comm",`);
  console.log(`  i.e. only a CASH form of payment contributes; a card sale contributes 0.`);
  console.log(`\n  doc          type  date         txn amount     payable   FOP   RTDN`);
  for (const t of mismatch) {
    console.log(`  ${t.doc.padEnd(12)} ${t.trnc.padEnd(5)} ${t.iso}  ${money(t.txn).padStart(12)}  ${money(t.payable).padStart(10)}  ${(t.fop || '—').padEnd(4)}  ${t.rtdn ?? '—'}`);
  }
  const cc = mismatch.filter(t => t.fop === 'CC');
  console.log(`\n  of the ${mismatch.length}, form of payment is a card (CC): ${cc.length}`);

  /* ── database, SELECT only ────────────────────────────────────────────── */
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const snapshot = async () => (await c.query(`
    select source, count(*)::int as n, coalesce(sum(amount),0)::float8 as net,
           coalesce(sum(commission),0)::float8 as comm, coalesce(sum(total_doc),0)::float8 as fare
    from tickets group by source order by source`)).rows;
  const walletSnap = async () => (await c.query(
    `select vendor_name, initial_balance::float8 as ib, current_balance::float8 as cb
     from vendor_balances order by vendor_name`)).rows;
  const beforeRows = await snapshot();
  const beforeWallets = await walletSnap();

  const { rows: db } = await c.query(
    `select id, ticket_no, status, transaction_type, date, channel, import_batch_id,
            amount::float8 as amount, total_doc::float8 as fare, commission::float8 as comm,
            req_num, report_name, import_time::text as imported
     from tickets where source = $1 order by ticket_no`, [IATA_VENDOR]);

  const dbByKey = new Map<string, any[]>();
  for (const r of db) {
    const k = `${normDoc(r.ticket_no)}|${r.amount < 0 ? '-' : '+'}`;
    const b = dbByKey.get(k); if (b) b.push(r); else dbByKey.set(k, [r]);
  }
  const invByKey = new Map<string, Txn[]>();
  for (const t of invoice) {
    const k = `${normDoc(t.doc)}|${dirOf(t.trnc, t.payable)}`;
    const b = invByKey.get(k); if (b) b.push(t); else invByKey.set(k, [t]);
  }

  /* ── GROUP A ──────────────────────────────────────────────────────────── */
  H('A. THE SEVEN REFUNDS');
  for (const doc of GROUP_A) {
    console.log(`\n  ── ${doc} ────────────────────────────────────────────────`);
    for (const t of invoice.filter(x => x.doc === doc)) {
      console.log(`     INVOICE ${t.trnc} ${t.iso}  [${t.file.slice(0, 6)} p${t.page}] section=${t.section} channel=${t.channel}`);
      console.log(`        Transaction Amount ${money(t.txn).padStart(13)}   FARE ${money(t.fare).padStart(13)}`);
      console.log(`        Std Comm Amt       ${money(t.stdComm).padStart(13)}   Supp Comm Amt ${money(t.suppComm).padStart(13)}   Tax on Comm ${money(t.taxOnComm).padStart(10)}`);
      console.log(`        Balance Payable    ${money(t.payable).padStart(13)}   RTDN ${t.rtdn ?? '—'}`);
      console.log(`        printed commission ${money(explicitComm(t)).padStart(13)}   importer would derive ${money(derivedComm(t)).padStart(13)}`);
    }
    for (const r of db.filter((x: any) => normDoc(x.ticket_no) === normDoc(doc))) {
      console.log(`     LEDGER  ${String(r.status).padEnd(7)} type=${r.transaction_type || '—'} date=${r.date || '—'} channel=${r.channel ?? '(none)'}`);
      console.log(`        fare ${money(r.fare).padStart(13)}   commission ${money(r.comm).padStart(10)}   payable ${money(r.amount).padStart(13)}   req=${r.req_num || '—'}   batch=${r.import_batch_id ?? '(pre-existing)'}`);
    }
  }

  H('A2. HOW A NORMAL REFUND LOOKS, FOR COMPARISON');
  const normalRefunds = invoice.filter(t => t.trnc === 'RFND' && Math.abs(t.payable) > 0.005 && !t.rtdn).slice(0, 3);
  for (const t of normalRefunds) {
    console.log(`  ${t.doc} ${t.iso}  txn ${money(t.txn).padStart(12)}  std ${money(t.stdComm).padStart(9)}  supp ${money(t.suppComm).padStart(9)}  payable ${money(t.payable).padStart(12)}  RTDN ${t.rtdn ?? '—'}`);
  }
  const rfndZero = invoice.filter(t => t.trnc === 'RFND' && Math.abs(t.payable) < 0.005);
  console.log(`\n  refunds across all 32 invoices whose Balance Payable is 0.00 : ${rfndZero.length}`);
  console.log(`     of those carrying an RTDN reference                       : ${rfndZero.filter(t => t.rtdn).length}`);
  console.log(`     documents: ${rfndZero.map(t => t.doc).join(', ')}`);

  /* ── GROUP B ──────────────────────────────────────────────────────────── */
  H('B. THE THREE ZERO-VALUE STUBS');
  for (const doc of GROUP_B) {
    console.log(`\n  ── ${doc} ────────────────────────────────────────────────`);
    for (const t of invoice.filter(x => x.doc === doc)) {
      console.log(`     INVOICE ${t.trnc} ${t.iso}  txn ${money(t.txn).padStart(12)}  std ${money(t.stdComm).padStart(8)}  supp ${money(t.suppComm).padStart(8)}  payable ${money(t.payable).padStart(12)}  RTDN ${t.rtdn ?? '—'}`);
    }
    for (const r of db.filter((x: any) => normDoc(x.ticket_no) === normDoc(doc))) {
      console.log(`     LEDGER  ${String(r.status).padEnd(7)} type=${r.transaction_type || '—'} date=${r.date || '—'} fare ${money(r.fare).padStart(12)} comm ${money(r.comm).padStart(8)} payable ${money(r.amount).padStart(12)} req=${r.req_num || '—'} report=${r.report_name || '—'} batch=${r.import_batch_id ?? '(pre-existing)'}`);
    }
  }

  /* ── GROUP C ──────────────────────────────────────────────────────────── */
  H('C. COMMISSION DIFFERENCES — classified');
  interface Case { t: Txn; r: any; cat: string; note: string }
  const cases: Case[] = [];
  for (const [k, lines] of invByKey) {
    const rows = dbByKey.get(k);
    if (!rows || rows.length !== 1) continue;      // shared keys handled separately
    const r = rows[0];
    const t = lines.reduce((a, b) => (a.iso <= b.iso ? a : b));
    if (isVoidType(t)) continue;
    const printed = explicitComm(t);
    const derived = derivedComm(t);
    const ledgerComm = r.comm as number;
    // Only rows where the ledger's commission disagrees with the invoice.
    if (Math.abs(ledgerComm - printed) < 0.011) continue;

    let cat: string, note: string;
    if (Math.abs(t.txn) < 0.005 && Math.abs(t.payable) < 0.005) {
      cat = 'E zero-value'; note = 'invoice bills nothing on this line';
    } else if (Math.abs(derived - printed) >= 0.011 && t.rtdn) {
      cat = 'F refund/RTDN'; note = `settled against ${t.rtdn}; printed commission ${money(printed)}, importer would derive ${money(derived)}`;
    } else if (Math.abs(derived - printed) >= 0.011) {
      cat = 'C derivation issue'; note = `printed ${money(printed)} vs derived ${money(derived)}`;
    } else if (Math.abs(ledgerComm) > 0.005 && Math.abs(ledgerComm - printed) < 1.0) {
      // The ledger carries the commission but rounded to whole units — the
      // half-unit lands on the amount too, so fare = comm + amount still holds
      // on both sides. Sub-unit noise, not missing money.
      cat = 'G rounding'; note = `ledger ${money(ledgerComm)} vs printed ${money(printed)} — rounded to whole units`;
    } else if (Math.abs(r.amount - t.payable) < 0.011) {
      cat = 'B already represented'; note = 'ledger amount already equals Balance Payable — only the commission column is blank';
    } else if (Math.abs(Math.abs(r.amount) - Math.abs(t.txn)) < 0.011) {
      cat = 'A genuine missing'; note = 'ledger holds the gross amount; the commission was never recorded';
    } else if (['ADMA', 'ACMA', 'SPDR', 'ADNT', 'ACNT', 'SPCR'].includes(t.trnc)) {
      cat = 'D special'; note = `${t.trnc} memo`;
    } else {
      cat = 'G other'; note = `ledger ${money(r.amount)} vs invoice txn ${money(t.txn)} / payable ${money(t.payable)}`;
    }
    cases.push({ t, r, cat, note });
  }

  const cats = new Map<string, Case[]>();
  for (const cs of cases) { const b = cats.get(cs.cat); if (b) b.push(cs); else cats.set(cs.cat, [cs]); }
  console.log(`  rows where the ledger commission differs from the invoice's PRINTED commission: ${cases.length}\n`);
  console.log('  category                rows      printed commission     ledger commission        difference');
  for (const [cat, list] of [...cats.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const p = list.reduce((s, x) => s + explicitComm(x.t), 0);
    const l = list.reduce((s, x) => s + x.r.comm, 0);
    console.log(`  ${cat.padEnd(22)} ${String(list.length).padStart(4)}   ${money(p).padStart(18)}   ${money(l).padStart(18)}   ${money(p - l).padStart(15)}`);
  }
  const totalPrinted = cases.reduce((s, x) => s + explicitComm(x.t), 0);
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(cases.length).padStart(4)}   ${money(totalPrinted).padStart(18)}   ${money(cases.reduce((s, x) => s + x.r.comm, 0)).padStart(18)}   ${money(totalPrinted - cases.reduce((s, x) => s + x.r.comm, 0)).padStart(15)}`);

  for (const [cat, list] of [...cats.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  --- ${cat} (${list.length}) ---`);
    for (const cs of list.slice(0, 6)) {
      console.log(`     ${cs.t.trnc} ${cs.t.doc} ${cs.t.iso}  invoice txn ${money(cs.t.txn).padStart(12)} printed comm ${money(explicitComm(cs.t)).padStart(9)} payable ${money(cs.t.payable).padStart(12)}`);
      console.log(`        ledger fare ${money(cs.r.fare).padStart(12)} comm ${money(cs.r.comm).padStart(9)} amount ${money(cs.r.amount).padStart(12)}   ${cs.note}`);
    }
    if (list.length > 6) console.log(`     ... +${list.length - 6} more`);
  }

  /* ── section 8: are any Phase-4 imports involved? ─────────────────────── */
  H('8. ARE ANY PHASE-4 IMPORTED ROWS INVOLVED?');
  const phase4 = new Set(db.filter((r: any) => r.import_batch_id?.startsWith('bsp-phase4-')).map((r: any) => r.id));
  console.log(`  Phase-4 imported rows in the ledger      : ${phase4.size}`);
  const casesP4 = cases.filter(cs => phase4.has(cs.r.id));
  console.log(`  ...appearing in the commission cases     : ${casesP4.length}`);
  const groupAB = [...GROUP_A, ...GROUP_B];
  const abP4 = db.filter((r: any) => groupAB.includes(normDoc(r.ticket_no)) && phase4.has(r.id));
  console.log(`  ...among the Group A / Group B documents : ${abP4.length}`);
  for (const r of abP4) console.log(`     ${r.ticket_no} ${r.status} ${r.date}`);

  /* ── read-only proof ──────────────────────────────────────────────────── */
  H('10. READ-ONLY VERIFICATION');
  const afterRows = await snapshot();
  const afterWallets = await walletSnap();
  const sameRows = JSON.stringify(beforeRows) === JSON.stringify(afterRows);
  const sameWallets = JSON.stringify(beforeWallets) === JSON.stringify(afterWallets);
  console.log(`  vendor counts/totals identical before and after : ${sameRows ? 'YES' : 'NO  <-- PROBLEM'}`);
  console.log(`  wallets identical before and after              : ${sameWallets ? 'YES' : 'NO  <-- PROBLEM'}`);
  console.log(`  IATA transactions                               : ${afterRows.find((r: any) => r.source === IATA_VENDOR)?.n}`);
  for (const r of afterRows) console.log(`     ${String(r.source).padEnd(18)} ${String(r.n).padStart(5)} rows  net ${money(r.net).padStart(14)}`);
  console.log('\n  statements issued by this script: SELECT only (no INSERT/UPDATE/DELETE/ALTER anywhere).');
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
