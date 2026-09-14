import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: tickets } = await c.query(
    `select id, ticket_no "ticketNo", coalesce(pnr,'') pnr, coalesce(passenger_name,'') "passengerName",
            coalesce(airline_code,'') "airlineCode", coalesce(route,'') route, source,
            date::text date, amount::float8 amount, abs(amount)::float8 "totalDoc",
            0 commission, coalesce(req_num,'') "reqNum", coalesce(vendor_reference,'') "vendorReference",
            status, currency, false "isDuplicate", 'u' "userId"
       from tickets where source in ('Ibtekar','NSA')`);
  const { rows: topUps } = await c.query(
    `select id, vendor_id "vendorId", vendor_name "vendorName", amount::float8 amount,
            coalesce(note,'') note, coalesce(date,'') date, 'u' "userId" from balance_topups`);
  const { rows: wallets } = await c.query(
    `select id, vendor_name "vendorName", initial_balance::float8 "initialBalance",
            current_balance::float8 "currentBalance", 'u' "userId", opening_date::text "openingDate"
       from vendor_balances`);
  const { rows: statements } = await c.query(
    `select id, vendor_name "vendorName", period_start::text "periodStart", period_end::text "periodEnd",
            currency, opening_balance::float8 "openingBalance", closing_balance::float8 "closingBalance",
            billed::float8 billed, paid::float8 paid, other_charges::float8 "otherCharges",
            coalesce(source_file,'') "sourceFile", coalesce(note,'') note from vendor_statements`);
  writeFileSync(process.argv[2], JSON.stringify({ tickets, topUps, wallets, statements }));
  console.log(`tickets ${tickets.length}, topUps ${topUps.length}, wallets ${wallets.length}, statements ${statements.length}`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
