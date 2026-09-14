/**
 * Take the sale's invoice number back off its refund.
 *
 * A refund carries the same ticket number as the sale it reverses, so filling
 * the invoice number by ticket number put the sale's invoice on the refund row
 * too. It does not belong there: Ibtekar bills the sale on an invoice and
 * credits the refund on a separate document, and their own statement rows
 * carry no document number against a refund at all.
 *
 * It also made every invoice look short. INV261658 bills 3,390.95 and its five
 * issues come to exactly that; the two refunds that had picked up its number
 * dragged the ledger's total for it down to 1,815.18. The same for INV261813
 * and INV261934. With the refunds off, all eighteen invoices in the folder
 * reconcile to the piastre.
 *
 * A refund is only cleared when the document that named it is the one that
 * bills its own sale - that is the inheritance. A refund the vendor really did
 * name on a document of its own is left alone.
 *
 *   npx tsx scripts/investigations/unmark-refund-invoices.ts
 *   npx tsx scripts/investigations/unmark-refund-invoices.ts --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.find(a => a.startsWith('--snapshot='))?.split('=')[1]
          ?? 'refund-invoice-snapshot.json';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select r.id, r.ticket_no, r.date::text date, r.amount::float8 amount,
            r.status, r.vendor_reference, r.passenger_name
       from tickets r
      where r.source = 'Ibtekar'
        and r.amount < 0
        and coalesce(r.vendor_reference, '') <> ''
        and exists (
          select 1 from tickets s
           where s.source = 'Ibtekar' and s.amount > 0
             and regexp_replace(s.ticket_no, '\\D', '', 'g') = regexp_replace(r.ticket_no, '\\D', '', 'g')
             and s.vendor_reference = r.vendor_reference)
      order by r.date`);

  console.log(`refunds carrying their own sale's invoice number: ${rows.length}`);
  console.table(rows.map((r: any) => ({
    ticket: r.ticket_no, date: r.date, amount: r.amount.toFixed(2),
    ref: r.vendor_reference, pax: (r.passenger_name || '').slice(0, 24),
  })));
  console.log(`value wrongly attributed: ${rows.reduce((n: number, r: any) => n + r.amount, 0).toFixed(2)}`);

  if (!rows.length) { await c.end(); return; }
  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nsnapshot: ${SNAP}`);

  await c.query('begin');
  try {
    const res = await c.query(
      `update tickets set vendor_reference = '' where id = any($1)`,
      [rows.map((r: any) => r.id)]);
    await c.query('commit');
    console.log(`rows cleared: ${res.rowCount}`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
