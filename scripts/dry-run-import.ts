/**
 * Run a report through the real import pipeline against the live ledger and
 * report what WOULD happen — parse, dedupe, settle, classify — writing
 * nothing. This is the same code path the Import screen uses; only the save
 * is missing.
 *
 *   npx tsx scripts/dry-run-import.ts "path/to/report.csv" [--currency SAR]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import Papa from 'papaparse';
import { Client } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { runParser, smartDetect } from '../src/core/parsers';
import {
  detectDuplicates, detectDuplicatesAgainstExisting,
  classifyAgainstExisting, RECON_LABEL,
} from '../src/core/ImportEngine';
import { isVoidRow } from '../src/core/helpers/normalizeStatus';
import type { Ticket } from '../src/types';

const file = process.argv[2];
const curArg = process.argv.indexOf('--currency');
const CURRENCY = (curArg !== -1 ? process.argv[curArg + 1] : 'AED') as 'AED' | 'SAR';

/** Rows are written under the workspace owner; RLS is bypassed here because
 *  this connects as the database user, not through the anon key. */
const USER_ID = process.env.IMPORT_USER_ID ?? '';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const grid = Papa.parse<string[]>(readFileSync(file, 'utf8'), { skipEmptyLines: true }).data;
  const det = smartDetect(grid);
  console.log(`parser: ${det.parser?.name} (${det.parser?.id})  confidence: ${det.confidence}`);

  const parsed = runParser(grid, CURRENCY);
  console.log(`parsed ${parsed.rows.length} rows, ${parsed.errors.length} error(s)`);
  parsed.errors.forEach(e => console.log('   ERR', e));

  // Mirror useImport: build tickets, split out top-ups, drop voids.
  const all: Ticket[] = parsed.rows.map((r: any) => ({
    id: uuidv4(),
    ticketNo: r.ticketNo, pnr: r.pnr ?? '', passengerName: r.passengerName ?? '',
    airlineCode: r.airlineCode ?? '', route: r.route ?? '',
    source: r.source || det.parser?.name || '', date: r.date,
    amount: r.amount, totalDoc: r.totalDoc, commission: r.commission,
    reqNum: r.reqNum ?? '', status: r.status, currency: r.currency,
    transactionType: r.transactionType ?? r.status, vendorReference: r.vendorReference ?? '',
    serial: r.serial, channel: r.channel, closed: false,
    isDuplicate: false, userId: 'dry-run',
  }));

  const topUps   = all.filter(t => t.status === 'FUND');
  const voided   = all.filter(t => t.status !== 'FUND' && isVoidRow(t));
  const keepable = all.filter(t => t.status !== 'FUND' && !isVoidRow(t));
  const staged   = detectDuplicates(keepable);

  // Same lookup the app does: existing rows for these ticket numbers only.
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: dbRows } = await c.query(
    `select * from tickets where ticket_no = any($1)`, [keepable.map(t => t.ticketNo)]);
  const existing: Ticket[] = dbRows.map((r: any) => ({
    id: r.id, ticketNo: r.ticket_no, pnr: r.pnr ?? '', passengerName: r.passenger_name ?? '',
    airlineCode: r.airline_code ?? '', route: r.route ?? '', source: r.source,
    date: r.date, amount: Number(r.amount), totalDoc: Number(r.total_doc),
    commission: Number(r.commission), reqNum: r.req_num ?? '', status: r.status,
    currency: r.currency, transactionType: r.transaction_type, vendorReference: r.vendor_reference ?? '',
    serial: r.serial ?? undefined, channel: r.channel ?? undefined, closed: r.closed ?? false,
    isDuplicate: r.is_duplicate, userId: r.user_id,
  }));
  await c.end();

  console.log(`\nalready in the ledger for these ticket numbers: ${existing.length}`);

  const { fresh, updates, duplicates, settlements } =
    detectDuplicatesAgainstExisting(staged, existing);
  const classified = classifyAgainstExisting(staged, existing);

  console.log('\n=== what the import would do ===');
  console.table([{
    'new rows':        fresh.length,
    'settled':         settlements.length,
    'req updates':     updates.length,
    'duplicates':      duplicates.length,
    'voids dropped':   voided.length,
    'top-ups':         topUps.length,
  }]);

  const byCls: Record<string, number> = {};
  for (const r of classified) byCls[r.cls] = (byCls[r.cls] ?? 0) + 1;
  console.log('\n=== reconciliation verdict per row ===');
  console.table(Object.entries(byCls).map(([cls, n]) => ({ verdict: RECON_LABEL[cls as never] ?? cls, rows: n })));

  console.log('\n=== row by row ===');
  console.table(classified.map(r => {
    const t = r.ticket;
    const where = fresh.includes(t) ? 'NEW ROW'
      : settlements.some(s => s.ticketNo === t.ticketNo) ? 'SETTLES EXISTING'
      : updates.some(u => u.ticketNo === t.ticketNo) ? 'REQ UPDATE'
      : 'SKIPPED (duplicate)';
    return {
      ticket: t.ticketNo, date: t.date,
      payable: money(t.amount), comm: money(t.commission),
      'in ledger': r.existing ? money(r.existing.amount) : '—',
      'ledger comm': r.existing ? money(r.existing.commission) : '—',
      verdict: RECON_LABEL[r.cls] ?? r.cls,
      action: where,
    };
  }));

  const diffs = classified.filter(r => !['NEW', 'EXACT_MATCH', 'DUPLICATE'].includes(r.cls));
  if (diffs.length) {
    console.log('\n=== rows that differ from the ledger ===');
    console.table(diffs.map(r => ({
      ticket: r.ticket.ticketNo, verdict: RECON_LABEL[r.cls] ?? r.cls,
      'fare Δ': money(r.delta.fare), 'comm Δ': money(r.delta.commission), 'payable Δ': money(r.delta.payable),
    })));
  } else {
    console.log('\nno row disagrees with the ledger.');
  }

  if (parsed.warnings.length) {
    const shown = parsed.warnings.filter(w => !/Missing Req Num/.test(w));
    console.log(`\nwarnings: ${parsed.warnings.length} (${parsed.warnings.length - shown.length} are "missing req num")`);
    shown.forEach(w => console.log('   ', w));
  }

  if (!process.argv.includes('--apply')) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to import.');
    return;
  }

  // Writes exactly what TicketService.saveImport() writes, so applying here
  // and applying from the Import screen leave the ledger in the same state.
  const w = new Client({ connectionString: process.env.DATABASE_URL });
  await w.connect();
  const touched = [...updates, ...settlements].map(t => t.id);
  const { rows: before } = touched.length
    ? await w.query('select * from tickets where id = any($1)', [touched])
    : { rows: [] as any[] };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`import-snapshot-${stamp}.json`,
    JSON.stringify({ takenAt: new Date().toISOString(), file, before, inserted: fresh.map(f => f.id) }, null, 2));
  console.log(`\nrollback snapshot written: import-snapshot-${stamp}.json`);

  await w.query('begin');
  try {
    for (const t of fresh) {
      await w.query(
        `insert into tickets (id, user_id, ticket_no, source, date, amount, commission, total_doc,
                              req_num, pnr, passenger_name, airline_code, route, status, currency,
                              transaction_type, report_name, vendor_reference, serial, channel,
                              closed, is_duplicate, import_time)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())`,
        [t.id, USER_ID, t.ticketNo, t.source, t.date, t.amount, t.commission, t.totalDoc,
         t.reqNum, t.pnr, t.passengerName, t.airlineCode, t.route, t.status, t.currency,
         t.transactionType, det.parser?.name ?? '', t.vendorReference, t.serial ?? null,
         t.channel ?? null, false, false]);
    }
    for (const t of updates) {
      // Mirrors TicketService.saveImport: fill only, never blank. nullif('')
      // keeps an empty incoming value from erasing what the ledger holds.
      await w.query(
        `update tickets set
           req_num        = coalesce(nullif($1,''), req_num),
           route          = coalesce(nullif($2,''), route),
           passenger_name = coalesce(nullif($3,''), passenger_name),
           pnr            = coalesce(nullif($4,''), pnr),
           serial         = coalesce($5, serial)
         where id=$6`,
        [t.reqNum ?? '', t.route ?? '', t.passengerName ?? '', t.pnr ?? '', t.serial ?? null, t.id]);
    }
    for (const t of settlements) {
      await w.query(
        `update tickets set amount=$1, commission=$2, total_doc=$3, date=$4, status=$5,
                            channel=coalesce($6, channel), req_num=$7, serial=coalesce($8, serial)
         where id=$9`,
        [t.amount, t.commission, t.totalDoc, t.date, t.status, t.channel ?? null,
         t.reqNum, t.serial ?? null, t.id]);
    }
    await w.query('commit');
    console.log(`APPLIED: ${fresh.length} inserted, ${settlements.length} settled, ${updates.length} req updates.`);
  } catch (e) {
    await w.query('rollback');
    console.error('rolled back, nothing changed:', e);
    process.exitCode = 1;
  }
  await w.end();
})().catch(e => { console.error(e); process.exit(1); });
