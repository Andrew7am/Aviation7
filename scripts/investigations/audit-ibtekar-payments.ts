/**
 * Every payment recorded to Ibtekar, against the receipts Ibtekar acknowledges.
 *
 * Two top-ups of 20,000.00 each sit at 2026-11-06 - a date in the future, and
 * one that reads like 06/11 taken for 11/06. A payment dated outside every
 * period falls out of every balance drawn for one, so it is worth knowing
 * whether the date is wrong, or the payment is a duplicate, or both.
 *
 * Their side comes from two documents: the statement of account rows already
 * imported (ibtekar_rows, whose credit column is a receipt) and the statement
 * PDF read separately. Reports only - nothing here writes.
 *
 *   npx tsx scripts/investigations/audit-ibtekar-payments.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const TODAY = new Date().toISOString().slice(0, 10);

  const { rows: ours } = await c.query(
    `select id, vendor_name, amount::float8 amount, coalesce(note,'') note,
            coalesce(date,'') date
       from balance_topups where vendor_name = 'Ibtekar' order by date, amount`);

  console.log(`payments recorded to Ibtekar: ${ours.length}, ${money(ours.reduce((n: number, r: any) => n + r.amount, 0))}\n`);
  console.table(ours.map((r: any) => ({
    date: r.date, amount: money(r.amount), note: r.note.slice(0, 40),
    future: r.date > TODAY ? 'AFTER TODAY' : '',
    id: r.id.slice(0, 16),
  })));

  // Ibtekar's own side: a credit on a statement row is money they received.
  const { rows: theirs } = await c.query(
    `select r.date, r.doc_no, r.credit, r.balance, i.source_file
       from ibtekar_rows r
       left join vendor_imports i on i.id = r.vendor_import_id
      where nullif(btrim(r.credit), '') is not null
        and r.credit ~ '^[0-9.]+$' and r.credit::float8 > 0
      order by r.source_row_num`);
  console.log(`\nreceipts Ibtekar acknowledges on the statements we hold: ${theirs.length}`);
  console.table(theirs.map((r: any) => ({
    date: String(r.date).slice(0, 10), document: r.doc_no,
    credit: money(Number(r.credit)), file: String(r.source_file ?? '').slice(0, 30),
  })));

  // Anything that looks like the same payment entered twice.
  const seen = new Map<string, any[]>();
  for (const r of ours as any[]) {
    const k = `${r.amount}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k)!.push(r);
  }
  console.log('\nsame amount recorded more than once:');
  for (const [amount, rs] of seen) {
    if (rs.length < 2) continue;
    console.log(`   ${money(Number(amount))} x ${rs.length}  on ${rs.map(r => r.date).join(', ')}`);
    console.log(`      notes: ${[...new Set(rs.map(r => r.note))].join(' | ')}`);
  }

  // What each payment does to the audit trail, so a wrong date can be traced
  // to the import or the hand that entered it.
  const ids = ours.map((r: any) => r.id);
  const { rows: audit } = await c.query(
    `select entity, action, detail, performed_at::text at
       from audit_log where action = 'TOPUP' and entity = 'Ibtekar'
      order by performed_at desc limit 20`);
  console.log(`\ntop-up entries in the audit log: ${audit.length}`);
  console.table(audit.map((a: any) => ({ at: a.at.slice(0, 19), detail: a.detail.slice(0, 40) })));
  void ids;

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
