/**
 * Put Ibtekar's own invoice number on the ticket it billed.
 *
 * The plan is built from Ibtekar's documents, not from the ledger: the tax
 * invoices in the shared folder and the statement of account they bill on.
 * Three columns can move, and only ever onto a row whose ticket number the
 * document names:
 *
 *   vendor_reference  the invoice number, replacing the request number or the
 *                     PNR that was standing in for it. Nothing is lost - both
 *                     of those have their own column, and the script refuses
 *                     to overwrite a value that is not held elsewhere.
 *   airline_code      where the ledger holds a two-letter carrier code or a
 *                     code scavenged from the serial, and the document gives
 *                     the numeric one. A code already three digits is left be.
 *   date              only where the ledger's date is impossible - blank, or
 *                     outside the years the agency has traded. A date that is
 *                     merely a day off the invoice is the issue date against
 *                     the billing date, and the issue date is the true one.
 *
 *   npx tsx scripts/investigations/apply-ibtekar-plan.ts <plan.json>
 *   npx tsx scripts/investigations/apply-ibtekar-plan.ts <plan.json> --apply
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { Client } from 'pg';

interface PlanRow {
  id: string;
  ticketNo: string;
  was: { vendor_reference: string; airline_code: string; date: string | null };
  set: { vendor_reference?: string; airline_code?: string; date?: string };
  amount: number;
  reqNum: string;
  pax: string;
}

const PLAN = process.argv[2];
const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.find(a => a.startsWith('--snapshot='))?.split('=')[1]
          ?? 'ibtekar-plan-snapshot.json';

const COLS = ['vendor_reference', 'airline_code', 'date'] as const;

(async () => {
  const plan: PlanRow[] = JSON.parse(readFileSync(PLAN, 'utf8'));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Re-read every row the plan touches, so the comparison is against the
  // ledger as it stands now and not as it stood when the plan was drawn.
  const { rows: live } = await c.query(
    `select id, ticket_no, coalesce(vendor_reference,'') vendor_reference,
            coalesce(airline_code,'') airline_code, date::text date,
            coalesce(req_num,'') req_num, coalesce(pnr,'') pnr
       from tickets where id = any($1)`, [plan.map(p => p.id)]);
  const now = new Map(live.map((r: any) => [r.id, r]));

  const doable: PlanRow[] = [];
  const skipped: string[] = [];
  for (const p of plan) {
    const r: any = now.get(p.id);
    if (!r) { skipped.push(`${p.ticketNo}: row is gone`); continue; }

    // Refuse to drop a reference that is recorded nowhere else. What stands in
    // the column today is either the request number, the PNR, or one of
    // Ibtekar's file numbers - and every file number the vendor ever sent is
    // kept verbatim in ibtekar_rows, so none of those is the only copy.
    const old = r.vendor_reference;
    const isFileNo = /^(KSA|UAE)[A-Z]{0,3}\d+$/i.test(old);
    if (p.set.vendor_reference && old && old !== r.req_num && old !== r.pnr && !isFileNo) {
      skipped.push(`${p.ticketNo}: vendor ref "${old}" is not the request number, the PNR or a file number`);
      continue;
    }
    const changed: PlanRow['set'] = {};
    for (const col of COLS) {
      const want = p.set[col];
      if (want !== undefined && r[col] !== want) changed[col] = want as any;
    }
    if (Object.keys(changed).length) doable.push({ ...p, set: changed });
  }

  const count = (col: string) => doable.filter(p => (p.set as any)[col] !== undefined).length;
  console.log(`plan rows        : ${plan.length}`);
  console.log(`already correct  : ${plan.length - doable.length - skipped.length}`);
  console.log(`to change        : ${doable.length}`);
  for (const col of COLS) console.log(`   ${col.padEnd(18)}${count(col)}`);
  if (skipped.length) {
    console.log(`\nskipped (${skipped.length}):`);
    for (const s of skipped) console.log('   ' + s);
  }

  const sample = doable.filter(p => p.set.airline_code || p.set.date);
  console.log(`\nevery row where a code or a date moves (${sample.length}):`);
  console.table(sample.map(p => ({
    ticket: p.ticketNo,
    'ref was': p.was.vendor_reference || '-', 'ref now': p.set.vendor_reference ?? '=',
    'A/L was': p.was.airline_code || '-',     'A/L now': p.set.airline_code ?? '=',
    'date was': p.was.date || '(blank)',      'date now': p.set.date ?? '=',
    amount: p.amount.toFixed(2), pax: p.pax.slice(0, 20),
  })));

  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  writeFileSync(SNAP, JSON.stringify({
    takenAt: new Date().toISOString(),
    rows: live.filter((r: any) => doable.some(p => p.id === r.id)),
  }, null, 2));
  console.log(`\nsnapshot: ${SNAP}`);

  await c.query('begin');
  try {
    let n = 0;
    for (const p of doable) {
      const sets: string[] = [];
      const vals: any[] = [p.id];
      for (const col of COLS) {
        const want = (p.set as any)[col];
        if (want === undefined) continue;
        vals.push(want);
        sets.push(`${col} = $${vals.length}${col === 'date' ? '::date' : ''}`);
      }
      const r = await c.query(`update tickets set ${sets.join(', ')} where id = $1`, vals);
      n += r.rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`\nrows updated: ${n}`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
