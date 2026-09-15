/** What the Vendor Statements screen now shows for NSA over a few ranges. */
import 'dotenv/config';
import { Client } from 'pg';
import { balanceOverRange } from '../../src/core/helpers/statementMath';
import type { VendorStatement, Ticket } from '../../src/types';
const m = (n: number | null) => n === null ? '—' : `${Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${n < 0 ? 'Dr' : 'Cr'}`;
const f = (n: number) => n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: st } = await c.query(
    `select id, vendor_name "vendorName", period_start::text "periodStart", period_end::text "periodEnd",
            currency, opening_balance::float8 "openingBalance", closing_balance::float8 "closingBalance",
            billed::float8 billed, paid::float8 paid, other_charges::float8 "otherCharges"
       from vendor_statements order by period_start`);
  const { rows: tk } = await c.query(
    `select id, ticket_no "ticketNo", source, date::text date, amount::float8 amount,
            coalesce(vendor_reference,'') "vendorReference", status, currency from tickets`);
  const { rows: tu } = await c.query(
    `select id, vendor_name "vendorName", amount::float8 amount, coalesce(date,'') date, coalesce(note,'') note
       from balance_topups`);
  await c.end();
  for (const [v, from, to] of [
    ['NSA','2026-04-01','2026-04-30'], ['NSA','2026-06-01','2026-06-30'],
    ['NSA','2026-07-01','2026-09-15'], ['Ibtekar','2026-09-01','2026-09-15'],
  ] as [string,string,string][]) {
    const r = balanceOverRange(v, from, to, st as VendorStatement[], tk as Ticket[], tu as any);
    console.log(`\n${v}  ${from} → ${to}   [${r.anchor}]`);
    console.log(`   opening ${m(r.openingBalance)}   issued -${f(r.issued)}   refunded +${f(r.refunded)}   paid +${f(r.paid)}`);
    console.log(`   closing ${m(r.closingBalance)}`);
    console.log(`   ${r.anchorLabel}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
