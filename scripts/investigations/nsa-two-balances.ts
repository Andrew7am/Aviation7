/** The two NSA balances the app shows, and why they differ. */
import 'dotenv/config';
import { Client } from 'pg';
import { balanceOverRange } from '../../src/core/helpers/statementMath';
import { calcVendorBalance } from '../../src/core/helpers/walletMath';
import type { VendorStatement, Ticket } from '../../src/types';
const m = (n: number) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: w } = await c.query(
    `select id, vendor_name "vendorName", initial_balance::float8 "initialBalance",
            current_balance::float8 "currentBalance", opening_date::text "openingDate"
       from vendor_balances where vendor_name = 'NSA'`);
  const { rows: st } = await c.query(
    `select id, vendor_name "vendorName", period_start::text "periodStart", period_end::text "periodEnd",
            currency, opening_balance::float8 "openingBalance", closing_balance::float8 "closingBalance",
            billed::float8 billed, paid::float8 paid, other_charges::float8 "otherCharges"
       from vendor_statements order by period_start`);
  const { rows: tk } = await c.query(
    `select id, ticket_no "ticketNo", source, date::text date, amount::float8 amount, status,
            coalesce(vendor_reference,'') "vendorReference", currency from tickets`);
  const { rows: tu } = await c.query(
    `select id, vendor_id "vendorId", vendor_name "vendorName", amount::float8 amount,
            coalesce(date,'') date, coalesce(note,'') note from balance_topups`);
  await c.end();

  const wallet = w[0] as any;
  const walletBal = calcVendorBalance(wallet, tk as any, tu as any);
  const nsaTk = (tk as any[]).filter(t => t.source === 'NSA');
  const nsaTu = (tu as any[]).filter(t => t.vendorName === 'NSA');

  console.log('VENDOR CREDIT (the wallet)');
  console.log(`   initial balance        ${m(wallet.initialBalance).padStart(16)}`);
  console.log(`   + every payment        ${m(nsaTu.reduce((n, t) => n + t.amount, 0)).padStart(16)}  (${nsaTu.length})`);
  console.log(`   - every ticket         ${m(nsaTk.reduce((n, t) => n + t.amount, 0)).padStart(16)}  (${nsaTk.length})`);
  console.log(`   = balance              ${m(walletBal).padStart(16)}`);
  console.log(`   opening date           ${wallet.openingDate ?? '(none — charges the whole history)'}`);

  const r = balanceOverRange('NSA', '2026-07-01', '2026-12-31', st as VendorStatement[], tk as Ticket[], tu as any);
  console.log('\nVENDOR STATEMENTS (their statement, carried forward)');
  console.log(`   their closing 2026-06-30 ${m(-23704.04).padStart(14)}`);
  console.log(`   since then: issued -${m(r.issued)}, refunded +${m(r.refunded)}, paid +${m(r.paid)}`);
  console.log(`   = balance              ${m(r.closingBalance ?? 0).padStart(16)}`);

  console.log(`\ndifference between the two: ${m(walletBal - (r.closingBalance ?? 0))}`);
})().catch(e => { console.error(e); process.exit(1); });
