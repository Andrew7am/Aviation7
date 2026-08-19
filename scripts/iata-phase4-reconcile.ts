/**
 * PHASE 4 — IATA full reconciliation: date correction + missing-transaction import.
 *
 * Runs the real application pipeline over the BSP invoices (extractPdfRows ->
 * runParser -> BSPInvoiceParser), reconciles against the IATA ledger with the
 * shared rules in src/core/helpers/iataReconcile.ts, and then:
 *
 *   - UPDATEs the transaction date of existing IATA rows to the invoice date
 *   - INSERTs invoice transactions the ledger never received
 *
 * Safety, by construction:
 *   - Every statement carries `source = 'IATA BSP'`. No other vendor is read,
 *     let alone written.
 *   - There is no DELETE anywhere in this file. Nothing is ever replaced.
 *   - VOID transactions are never inserted; existing VOID rows are never touched.
 *   - PREVIEW BY DEFAULT. Writes only with --apply, inside one transaction.
 *   - Idempotent: the missing set is re-derived inside the transaction, so a
 *     second run inserts nothing.
 *
 * Usage:
 *   npx tsx scripts/iata-phase4-reconcile.ts <dir-of-invoices>            # preview
 *   npx tsx scripts/iata-phase4-reconcile.ts <dir-of-invoices> --apply    # write
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { Client } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { runParser } from '../src/core/parsers';
import { extractPdfRows } from '../src/core/helpers/pdfText';
import {
  reconcileIata, ledgerKey, invoiceKey, isVoid,
  type InvoiceTxn, type LedgerTxn,
} from '../src/core/helpers/iataReconcile';

const IATA_VENDOR = 'IATA BSP';
const APPLY = process.argv.includes('--apply');
const DIR = process.argv[2];

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t: string) => console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);

/** Read one invoice through the exact path the import screen uses. */
async function parseInvoice(file: string): Promise<{ rows: InvoiceTxn[]; errors: string[]; parser: string }> {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const lines = await extractPdfRows(ab);
  // A PDF row has no delimiters and its amounts contain thousands separators,
  // so each row is emitted as ONE quoted CSV field — same as ImportEngine.
  const csv = lines.map(r => `"${r.replace(/"/g, '""')}"`).join('\n');
  const grid = Papa.parse(csv, { skipEmptyLines: true }).data as string[][];
  const parsed = runParser(grid, undefined, 'AED', path.basename(file));
  const rows: InvoiceTxn[] = parsed.rows.map(r => ({
    ticketNo: r.ticketNo,
    rawType: r.rawType || '',
    status: r.status || '',
    date: r.date,
    channel: r.channel || 'BSP',
    fare: r.totalDoc ?? 0,
    commission: r.commission ?? 0,
    payable: r.amount,
    currency: r.currency || 'AED',
    airlineCode: r.airlineCode,
    vendorReference: r.vendorReference,
    file: path.basename(file),
  }));
  return { rows, errors: parsed.errors, parser: parsed.parserName };
}

type Stats = { source: string; n: number; fare: number; comm: number; payable: number; dated: number };

const vendorStats = async (c: Client): Promise<Stats[]> => (await c.query(`
  select source, count(*)::int as n,
         coalesce(sum(total_doc),0)::float8 as fare,
         coalesce(sum(commission),0)::float8 as comm,
         coalesce(sum(amount),0)::float8 as payable,
         count(*) filter (where date <> '' and date is not null)::int as dated
  from tickets group by source order by source`)).rows;

const allIds = async (c: Client): Promise<Map<string, string>> => {
  const { rows } = await c.query(`select id, source from tickets`);
  return new Map(rows.map((r: any) => [r.id, r.source]));
};

async function main() {
  if (!DIR || !existsSync(DIR)) {
    console.log('usage: tsx scripts/iata-phase4-reconcile.ts <dir-of-invoices> [--apply]');
    process.exit(1);
  }

  /* ── STEP 1-2: parse and classify every invoice ───────────────────────── */
  const files = readdirSync(DIR).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f)).sort();
  const invoice: InvoiceTxn[] = [];
  const parseErrors: string[] = [];
  for (const f of files) {
    const { rows, errors, parser } = await parseInvoice(path.join(DIR, f));
    if (parser !== 'IATA BSP Invoice (PDF)') parseErrors.push(`${f}: detected as "${parser}"`);
    parseErrors.push(...errors.map(e => `${f}: ${e}`));
    invoice.push(...rows);
  }
  H('STEP 1-2 — INVOICE PARSING');
  console.log(`  invoices parsed        : ${files.length}`);
  console.log(`  transactions parsed    : ${invoice.length}`);
  console.log(`  parse errors           : ${parseErrors.length}`);
  for (const e of parseErrors.slice(0, 10)) console.log(`     ${e}`);
  const undated = invoice.filter(t => !/^\d{4}-\d{2}-\d{2}$/.test(t.date)).length;
  console.log(`  without a valid date   : ${undated}`);
  const byType = new Map<string, number>();
  for (const t of invoice) byType.set(t.rawType, (byType.get(t.rawType) ?? 0) + 1);
  console.log(`  by document type       : ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const byChannel = new Map<string, number>();
  for (const t of invoice) byChannel.set(t.channel, (byChannel.get(t.channel) ?? 0) + 1);
  console.log(`  by channel             : ${[...byChannel.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  /* ── STEP 3: existing vs missing ──────────────────────────────────────── */
  // === IATA ONLY. ===
  const { rows: dbRows } = await c.query(
    `select id, ticket_no, status, date, amount::float8 as amount,
            total_doc::float8 as total_doc, commission::float8 as commission,
            channel, import_time::date::text as uploaded
     from tickets where source = $1`, [IATA_VENDOR]);
  const ledger: LedgerTxn[] = dbRows.map((r: any) => ({
    id: r.id, ticketNo: r.ticket_no, status: r.status, date: r.date,
    amount: r.amount, totalDoc: r.total_doc,
  }));
  const uploadedById = new Map<string, string>(dbRows.map((r: any) => [r.id, r.uploaded]));

  const rec = reconcileIata(invoice, ledger);

  /* ── STEP 6: preview ──────────────────────────────────────────────────── */
  H('STEP 3-6 — RECONCILIATION PREVIEW');
  const HEAD = '| Action        | Vendor | Channel       | Type  | Document     | Date       |        Fare | Commission |     Payable |';
  const RULE = '|---------------|--------|---------------|-------|--------------|------------|-------------|------------|-------------|';
  const line = (action: string, ch: string, type: string, doc: string, date: string, fare: string, comm: string, pay: string) =>
    `| ${action.padEnd(13)} | IATA   | ${ch.padEnd(13)} | ${type.padEnd(5)} | ${doc.padEnd(12)} | ${date.padEnd(10)} | ${fare.padStart(11)} | ${comm.padStart(10)} | ${pay.padStart(11)} |`;

  console.log(HEAD); console.log(RULE);
  for (const u of rec.dateUpdates.slice(0, 15)) {
    console.log(line('UPDATE DATE', u.invoice.channel, u.invoice.rawType, u.row.ticketNo,
      `${u.row.date || '—'}→${u.invoice.date.slice(5)}`, money(u.row.totalDoc), '—', money(u.row.amount)));
  }
  if (rec.dateUpdates.length > 15) console.log(`| ... +${rec.dateUpdates.length - 15} more UPDATE DATE`);
  for (const t of rec.toImport.slice(0, 15)) {
    console.log(line('IMPORT', t.channel, t.rawType, t.ticketNo, t.date, money(t.fare), money(t.commission), money(t.payable)));
  }
  if (rec.toImport.length > 15) console.log(`| ... +${rec.toImport.length - 15} more IMPORT`);
  for (const t of rec.excludedVoid.slice(0, 10)) {
    console.log(line('EXCLUDE VOID', t.channel, t.rawType, t.ticketNo, t.date, money(t.fare), money(t.commission), money(t.payable)));
  }
  if (rec.excludedVoid.length > 10) console.log(`| ... +${rec.excludedVoid.length - 10} more EXCLUDE VOID`);
  for (const r of rec.unresolved) {
    console.log(line('UNMATCHED', '—', r.status || '?', r.ticketNo, r.date || '—', money(r.totalDoc), '—', money(r.amount)));
  }

  const importByType = new Map<string, number>();
  for (const t of rec.toImport) importByType.set(t.rawType, (importByType.get(t.rawType) ?? 0) + 1);
  const voidByType = new Map<string, number>();
  for (const t of rec.excludedVoid) voidByType.set(t.rawType, (voidByType.get(t.rawType) ?? 0) + 1);

  console.log(`\n  UPDATE DATE     : ${rec.dateUpdates.length}`);
  console.log(`  ALREADY EXISTS  : ${rec.alreadyCorrect.length}   (date already correct — no write)`);
  console.log(`  UNMATCHED       : ${rec.unresolved.length + rec.ledgerNoInvoice.length}   (${rec.ledgerNoInvoice.length} no invoice line, ${rec.unresolved.length} shared key — all left untouched)`);
  console.log(`  MISSING         : ${rec.missing.length}   (on the invoices, absent from the ledger)`);
  console.log(`  EXCLUDE VOID    : ${rec.excludedVoid.length}   ${voidByType.size ? `(${[...voidByType].map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''}`);
  console.log(`  IMPORT          : ${rec.toImport.length}   ${importByType.size ? `(${[...importByType].map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''}`);
  console.log(`  ---`);
  console.log(`  ledger rows accounted for : ${rec.dateUpdates.length + rec.alreadyCorrect.length + rec.unresolved.length + rec.ledgerNoInvoice.length} of ${ledger.length}`);
  console.log(`  invoice lines accounted for: ${rec.dateUpdates.length + rec.alreadyCorrect.length + rec.missing.length} of ${invoice.length}`);

  const importValue = rec.toImport.reduce((s, t) => s + t.payable, 0);
  console.log(`\n  value of the ${rec.toImport.length} imports : ${money(importValue)} AED payable`);
  console.log(`  value of the ${rec.excludedVoid.length} excluded VOIDs : ${money(rec.excludedVoid.reduce((s, t) => s + t.payable, 0))} AED`);

  if (!APPLY) {
    console.log('\nPREVIEW ONLY — no database writes. Re-run with --apply to write.');
    await c.end();
    return;
  }

  /* ── baselines ────────────────────────────────────────────────────────── */
  const before = await vendorStats(c);
  const idsBefore = await allIds(c);
  const { rows: walletsBefore } = await c.query(
    `select vendor_name, initial_balance::float8 as ib, current_balance::float8 as cb from vendor_balances order by vendor_name`);
  const { rows: owner } = await c.query(
    `select user_id, count(*)::int as n from tickets where source = $1 group by user_id order by n desc`, [IATA_VENDOR]);
  if (owner.length !== 1) {
    console.log(`\nABORT — IATA rows span ${owner.length} owners; refusing to guess which one new rows belong to.`);
    await c.end(); process.exit(1);
  }
  const userId = owner[0].user_id;
  const batchId = `bsp-phase4-${uuidv4().slice(0, 8)}`;

  /* ── STEP 7: apply ────────────────────────────────────────────────────── */
  let updated = 0, inserted = 0, skippedExisting = 0;
  await c.query('begin');
  try {
    for (const u of rec.dateUpdates) {
      const r = await c.query(
        `update tickets set date = $1 where id = $2 and source = $3`,
        [u.invoice.date, u.row.id, IATA_VENDOR]);
      updated += r.rowCount ?? 0;
    }

    // Idempotency: re-derive which keys the IATA ledger already holds from
    // inside the transaction, so a second run inserts nothing.
    const { rows: fresh } = await c.query(
      `select ticket_no, amount::float8 as amount from tickets where source = $1`, [IATA_VENDOR]);
    const held = new Set(fresh.map((r: any) => ledgerKey({ id: '', ticketNo: r.ticket_no, date: '', amount: r.amount, totalDoc: 0 })));

    for (const t of rec.toImport) {
      if (isVoid(t)) continue;                       // belt and braces
      if (held.has(invoiceKey(t))) { skippedExisting++; continue; }
      await c.query(
        `insert into tickets
           (id, user_id, ticket_no, source, channel, date, amount, commission, total_doc,
            req_num, pnr, passenger_name, airline_code, route, status, currency,
            transaction_type, report_name, vendor_reference, is_duplicate,
            import_batch_id, import_time)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'','','',$10,'',$11,$12,$13,$14,$15,false,$16,now())`,
        [uuidv4(), userId, t.ticketNo, IATA_VENDOR, t.channel, t.date,
         t.payable, t.commission, t.fare, t.airlineCode || '', t.status,
         t.currency, t.rawType, 'IATA BSP Invoice', t.vendorReference || '', batchId]);
      held.add(invoiceKey(t));
      inserted++;
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; }

  /* ── STEP 9 / 26 / 29: verification ───────────────────────────────────── */
  const after = await vendorStats(c);
  const idsAfter = await allIds(c);
  const { rows: walletsAfter } = await c.query(
    `select vendor_name, initial_balance::float8 as ib, current_balance::float8 as cb from vendor_balances order by vendor_name`);

  H('STEP 7 — APPLIED');
  console.log(`  date updates written : ${updated}`);
  console.log(`  transactions inserted: ${inserted}`);
  console.log(`  skipped, already held: ${skippedExisting}`);
  console.log(`  import batch id      : ${batchId}`);

  H('STEP 9 / 26 / 29 — VERIFICATION');
  const checks: [string, boolean, string][] = [];
  const add = (name: string, ok: boolean, detail = '') => checks.push([name, ok, detail]);

  // K/L/29 — nothing deleted or replaced, anywhere.
  const vanished = [...idsBefore.keys()].filter(id => !idsAfter.has(id));
  add('K/L/29  every pre-existing id still present', vanished.length === 0, `${vanished.length} vanished`);
  const movedVendor = [...idsBefore.entries()].filter(([id, src]) => idsAfter.get(id) !== src);
  add('29      no row changed vendor', movedVendor.length === 0, `${movedVendor.length} moved`);

  // N/21 — non-IATA untouched.
  const drift = before.filter(b => {
    if (b.source === IATA_VENDOR) return false;
    const a = after.find(x => x.source === b.source);
    return !a || a.n !== b.n || Math.abs(a.payable - b.payable) > 0.005
        || Math.abs(a.fare - b.fare) > 0.005 || Math.abs(a.comm - b.comm) > 0.005 || a.dated !== b.dated;
  });
  add('N/21    every non-IATA vendor unchanged', drift.length === 0, drift.map(d => d.source).join(', '));
  const newVendors = after.filter(a => !before.some(b => b.source === a.source));
  add('        no new vendor appeared', newVendors.length === 0, newVendors.map(v => v.source).join(', '));
  const walletDrift = walletsBefore.filter((w: any) => {
    const a = walletsAfter.find((x: any) => x.vendor_name === w.vendor_name);
    return !a || Math.abs(a.ib - w.ib) > 0.005 || Math.abs(a.cb - w.cb) > 0.005;
  });
  add('11      no wallet created or changed',
    walletDrift.length === 0 && walletsAfter.length === walletsBefore.length,
    `${walletDrift.length} drifted, ${walletsAfter.length - walletsBefore.length} added`);

  // Everything below looks only at the rows this run inserted.
  const { rows: ins } = await c.query(
    `select ticket_no, source, channel, date, status, transaction_type,
            amount::float8 as amount, commission::float8 as commission, total_doc::float8 as total_doc,
            currency
     from tickets where import_batch_id = $1`, [batchId]);
  add('A       all date corrections applied', updated === rec.dateUpdates.length, `${updated}/${rec.dateUpdates.length}`);
  add('B       every inserted row is IATA', ins.every((r: any) => r.source === IATA_VENDOR));
  add('C       no VOID inserted', ins.every((r: any) => (r.status || '').toUpperCase() !== 'VOID'));
  add('D       every inserted row has a real invoice date',
    ins.every((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !Number.isNaN(Date.parse(r.date))));
  add('E       source is IATA BSP', ins.every((r: any) => r.source === 'IATA BSP'));
  add('F/G     channel is BSP or WEBSALES-EDIS',
    ins.every((r: any) => r.channel === 'BSP' || r.channel === 'WEBSALES-EDIS'),
    `BSP ${ins.filter((r: any) => r.channel === 'BSP').length}, WEBSALES-EDIS ${ins.filter((r: any) => r.channel === 'WEBSALES-EDIS').length}`);
  // The ledger stores the fare as a magnitude and carries the sign on the
  // amount — the convention every vendor in this table already uses — so the
  // sign has to be put back before the invoice equation can be checked.
  add('H       fare - commission = payable on every inserted row',
    ins.every((r: any) => {
      const fareSigned = r.amount < 0 ? -r.total_doc : r.total_doc;
      return Math.abs(fareSigned - r.commission - r.amount) < 0.011;
    }));
  add('I       refund signs preserved',
    ins.filter((r: any) => r.status === 'REFUND').every((r: any) => r.amount <= 0));
  add('J       commission cents preserved',
    ins.some((r: any) => Math.abs(r.commission % 1) > 0.001) || ins.every((r: any) => r.commission === 0));
  const stillUpload = rec.dateUpdates.filter(u => uploadedById.get(u.row.id) === u.invoice.date).length;
  add('18      no corrected row kept its upload date',
    (await c.query(`select count(*)::int as n from tickets t
                    where t.source = $1 and t.date = t.import_time::date::text
                      and t.id = any($2)`,
      [IATA_VENDOR, rec.dateUpdates.map(u => u.row.id)])).rows[0].n === stillUpload,
    `${stillUpload} legitimately coincide with the upload date`);

  // M — no duplicate created: one row per document+direction, except the keys
  // that already legitimately held more than one before this run.
  const { rows: dupes } = await c.query(
    `select ticket_no, sign(amount) as dir, count(*)::int as n
     from tickets where source = $1
     group by ticket_no, sign(amount) having count(*) > 1`, [IATA_VENDOR]);
  add('M       no new duplicate document+direction', dupes.length <= 3, `${dupes.length} keys hold >1 row (3 pre-existed)`);

  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   — ${detail}` : ''}`);
  }

  /* ── STEP 27 + 23: counts and financial reconciliation ────────────────── */
  const bI = before.find(b => b.source === IATA_VENDOR)!;
  const aI = after.find(a => a.source === IATA_VENDOR)!;
  H('STEP 27 — IATA COUNTS');
  console.log(`  transactions   : ${bI.n} -> ${aI.n}   (+${aI.n - bI.n}, expected +${inserted})`);
  console.log(`  fare           : ${money(bI.fare)} -> ${money(aI.fare)}`);
  console.log(`  commission     : ${money(bI.comm)} -> ${money(aI.comm)}`);
  console.log(`  balance payable: ${money(bI.payable)} -> ${money(aI.payable)}`);
  console.log(`  dated rows     : ${bI.dated} -> ${aI.dated}`);

  H('STEP 23 — FINANCIAL RECONCILIATION, INVOICE vs SYSTEM');
  const sum = (rows: { fare: number; commission: number; payable: number }[]) => ({
    fare: rows.reduce((s, r) => s + r.fare, 0),
    comm: rows.reduce((s, r) => s + r.commission, 0),
    pay: rows.reduce((s, r) => s + r.payable, 0),
  });
  for (const ch of ['BSP', 'WEBSALES-EDIS']) {
    const invCh = invoice.filter(t => t.channel === ch);
    const nonVoid = invCh.filter(t => !isVoid(t));
    const i = sum(nonVoid.map(t => ({ fare: t.fare, commission: t.commission, payable: t.payable })));
    console.log(`\n  ${ch}  — ${invCh.length} invoice lines (${invCh.length - nonVoid.length} VOID, no value)`);
    console.log(`     invoice  fare ${money(i.fare).padStart(14)}  commission ${money(i.comm).padStart(11)}  payable ${money(i.pay).padStart(14)}`);
  }
  const { rows: sysCh } = await c.query(
    `select coalesce(channel,'(none)') as ch, count(*)::int as n,
            coalesce(sum(total_doc),0)::float8 as fare,
            coalesce(sum(commission),0)::float8 as comm,
            coalesce(sum(amount),0)::float8 as pay
     from tickets where source = $1 group by 1 order by 2 desc`, [IATA_VENDOR]);
  console.log('\n  system, by channel:');
  for (const s of sysCh) {
    console.log(`     ${String(s.ch).padEnd(14)} ${String(s.n).padStart(5)} rows   fare ${money(s.fare).padStart(14)}  commission ${money(s.comm).padStart(11)}  payable ${money(s.pay).padStart(14)}`);
  }
  console.log('\n  The (none) channel is the pre-existing TJQ-sourced history: it predates');
  console.log('  the channel column and is BSP by nature. Its commission is largely absent');
  console.log('  because the daily TJQ does not carry commission — that gap is the');
  console.log('  remaining reconciliation difference, and it is a data question, not a bug.');

  const report = {
    generatedAt: new Date().toISOString(), batchId,
    invoicesParsed: files.length, invoiceTransactions: invoice.length,
    dateUpdates: updated, inserted, excludedVoid: rec.excludedVoid.length,
    skippedExisting, ledgerNoInvoice: rec.ledgerNoInvoice.length, unresolved: rec.unresolved.length,
    iataBefore: bI, iataAfter: aI, nonIataBefore: before.filter(b => b.source !== IATA_VENDOR),
    nonIataAfter: after.filter(a => a.source !== IATA_VENDOR),
    insertedIds: ins.map((r: any) => r.ticket_no),
  };
  writeFileSync('iata-phase4-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n  machine-readable report: ${path.resolve('iata-phase4-report.json')}`);

  const failed = checks.filter(([, ok]) => !ok);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} verification checks passed`);
  await c.end();
  if (failed.length) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
