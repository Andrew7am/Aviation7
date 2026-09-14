/**
 * What it would take for the Ibtekar balance to be right — which is not the
 * invoices.
 *
 * A tax invoice is a VAT document. The money it describes was charged to the
 * account when the ticket was issued, is already in our ledger, and is already
 * on Ibtekar's statement. Receiving the PDF changes the paperwork and moves the
 * balance by nothing at all. Worth proving rather than asserting, because
 * "chase the missing invoices" and "make the balance right" feel like the same
 * job and are not.
 *
 *   npx tsx scripts/investigations/ibtekar-balance-position.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drCr = (n: number) => `${m(Math.abs(n))} ${n < 0 ? 'Dr' : 'Cr'}`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: st } = await c.query(
    `select period_start::text ps, period_end::text pe,
            opening_balance::float8 ob, closing_balance::float8 cb,
            billed::float8 billed, paid::float8 paid, other_charges::float8 oc
       from vendor_statements where vendor_name = 'Ibtekar' order by period_start`);

  const { rows: w } = await c.query(
    `select initial_balance::float8 ib, opening_date::text od
       from vendor_balances where vendor_name = 'Ibtekar'`);

  const { rows: t } = await c.query(
    `select coalesce(sum(amount), 0)::float8 total, count(*)::int n,
            count(*) filter (where date is null or date = '')::int undated,
            coalesce(sum(amount) filter (where date is null or date = ''), 0)::float8 undatedValue
       from tickets where source = 'Ibtekar'`);

  const { rows: p } = await c.query(
    `select coalesce(sum(amount), 0)::float8 total, count(*)::int n
       from balance_topups where vendor_name = 'Ibtekar'`);

  console.log('='.repeat(72));
  console.log('WHERE THE IBTEKAR BALANCE STANDS');
  console.log('='.repeat(72));

  console.log('\nWhat Ibtekar says (their statement of account)');
  for (const s of st as any[]) {
    console.log(`   ${s.ps} to ${s.pe}`);
    console.log(`      opening          ${drCr(s.ob).padStart(16)}`);
    console.log(`      billed          -${m(s.billed).padStart(15)}`);
    console.log(`      paid            +${m(s.paid).padStart(15)}`);
    if (s.oc) console.log(`      their charges   -${m(s.oc).padStart(15)}`);
    console.log(`      closing          ${drCr(s.cb).padStart(16)}`);
  }
  const latest = (st as any[])[st.length - 1];

  console.log('\nWhat our books say, over the whole history');
  console.log(`   opening balance set  ${m(w[0]?.ib ?? 0).padStart(16)}${w[0]?.od ? `  from ${w[0].od}` : ''}`);
  console.log(`   paid to them        +${m(p[0].total).padStart(15)}   (${p[0].n} payment(s))`);
  console.log(`   tickets issued      -${m(t[0].total).padStart(15)}   (${t[0].n} row(s))`);
  const ours = (w[0]?.ib ?? 0) + p[0].total - t[0].total;
  console.log(`   balance             ${drCr(ours).padStart(16)}`);

  console.log(`\nTheir closing balance at ${latest.pe}: ${drCr(latest.cb)}`);
  console.log(`Our balance today                  : ${drCr(ours)}`);
  console.log(`Difference                         : ${m(ours - latest.cb)}`);

  // What actually moves the balance, as against what only moves the paperwork.
  console.log('\n' + '='.repeat(72));
  console.log('WHAT MOVES THE BALANCE, AND WHAT DOES NOT');
  console.log('='.repeat(72));

  const { rows: noInv } = await c.query(
    `select count(*)::int n, coalesce(sum(amount), 0)::float8 v
       from tickets where source = 'Ibtekar' and amount >= 0
        and vendor_reference in ('INV261867','INV261875','INV261877','INV261903',
                                 'INV263652','INV263768','INV263849','INV263872','INV263970','INV263549')`);
  console.log(`\nThe tickets waiting on a tax invoice: ${noInv[0].n} row(s), ${m(noInv[0].v)} SAR`);
  console.log('   already in our ledger      : yes — they are the rows counted above');
  console.log('   already on their statement : yes — that is where the invoice numbers came from');
  console.log('   effect on the balance when the invoices arrive: 0.00');

  const { rows: dated } = await c.query(
    `select ticket_no, date::text date, amount::float8 amount, coalesce(vendor_reference,'') ref
       from tickets where source = 'Ibtekar' and (date is null or date = '') order by amount`);
  console.log(`\nRows carrying no date: ${dated.length}`);
  console.log('   these DO affect any balance drawn for a period — they fall in none of them');
  if (dated.length) console.table(dated.map((r: any) => ({
    ticket: r.ticket_no, amount: m(r.amount), ref: r.ref || '(none)' })));

  // A payment is tied down when a credit on Ibtekar's own statement sits on the
  // same day for the same money. Six were re-dated onto their receipt voucher
  // and carry its number in the note; the rest are checked against the
  // statement rows here, because a payment that is only in our books is a
  // payment nobody has confirmed they received.
  const { rows: pays } = await c.query(
    `select t.date, t.amount::float8 amount, coalesce(t.note, '') note,
            (t.note ilike '%receipt RV%' or exists (
               select 1 from ibtekar_rows r
                where r.credit ~ '^[0-9.]+$'
                  and abs(r.credit::float8 - t.amount) < 0.011
                  and left(r.date, 10) = to_char(t.date::date, 'DD/MM/YYYY')
             )) as tied
       from balance_topups t where t.vendor_name = 'Ibtekar' order by t.date`);
  const loose = (pays as any[]).filter(r => !r.tied);
  console.log(`\nPayments recorded: ${pays.length}, ${m((pays as any[]).reduce((n, r) => n + r.amount, 0))}`);
  console.log(`   confirmed by a receipt on their statement : ${pays.length - loose.length}`);
  console.log(`   not confirmed                             : ${loose.length}, ${m(loose.reduce((n, r) => n + r.amount, 0))}`);
  if (loose.length) console.table(loose.map((r: any) => ({
    date: r.date, amount: m(r.amount), note: r.note })));

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
