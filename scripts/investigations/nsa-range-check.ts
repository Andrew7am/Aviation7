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
  const { rows: wal } = await c.query(
    `select vendor_name "vendorName", initial_balance::float8 "initialBalance",
            opening_date::text "openingDate" from vendor_balances`);
  await c.end();
  for (const [v, from, to] of [
    ['NSA','2026-04-01','2026-04-30'], ['NSA','2026-06-01','2026-06-30'],
    ['NSA','2026-07-01','2026-09-15'], ['Ibtekar','2026-09-01','2026-09-15'],
  ] as [string,string,string][]) {
    const w = (wal as any[]).find(x => x.vendorName === v);
    const r = balanceOverRange(v, from, to, st as VendorStatement[], tk as Ticket[], tu as any,
      w ? { initialBalance: w.initialBalance, openingDate: w.openingDate } : undefined);
    console.log(`\n${v}  ${from} → ${to}   [${r.anchor}]`);
    console.log(`   OUR balance  ${m(r.openingBalance)}  ->  ${m(r.closingBalance)}`);
    console.log(`   movement     issued -${f(r.issued)}   refunded +${f(r.refunded)}   paid +${f(r.paid)}`);
    console.log(`   THEIR figure ${m(r.statedOpening)}  ->  ${m(r.statedClosing)}`);
    console.log(`   ${r.anchorLabel}`);
    console.log(`   difference   ${r.balanceGap === null ? '—' : f(r.balanceGap)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
