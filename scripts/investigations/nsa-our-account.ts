/**
 * Our own books for a statement vendor, period by period, checked against the
 * balance Vendor Credit shows.
 *
 * The screen's figures come from ledgerAccount(); so do these. If the last
 * closing figure here is not the wallet balance, the screen is wrong too — the
 * point of running it outside the browser is that the check fails loudly in a
 * terminal instead of quietly on a page nobody is reading that day.
 *
 *   npx tsx scripts/investigations/nsa-our-account.ts [vendor]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { ledgerAccount, Payment } from '../../src/core/helpers/statementMath';
import { calcVendorBalance } from '../../src/core/helpers/walletMath';
import type { Ticket, VendorStatement, VendorBalance, BalanceTopUp } from '../../src/types';

const m = (n: number | null) => n === null ? '—'
  : Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    + (n < 0 ? ' Dr' : ' Cr');
const n2 = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const vendor = process.argv[2] || 'NSA';
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const [w] = await q(`select * from vendor_balances where vendor_name = $1`, [vendor]);
  if (!w) { console.error(`no wallet for ${vendor}`); process.exit(1); }

  const tickets: Ticket[] = (await q(
    `select id, source, date, amount::float8 amount, status, currency,
            ticket_no "ticketNo", passenger_name "passengerName",
            vendor_reference "vendorReference", airline_code "airlineCode"
       from tickets where source = $1`, [vendor])) as any;

  const topUps: BalanceTopUp[] = (await q(
    `select id, vendor_id "vendorId", vendor_name "vendorName",
            amount::float8 amount, date::text date, note
       from balance_topups where vendor_name = $1`, [vendor])) as any;

  const statements: VendorStatement[] = (await q(
    `select id, vendor_name "vendorName", period_start::text "periodStart", period_end::text "periodEnd",
            currency, opening_balance::float8 "openingBalance",
            closing_balance::float8 "closingBalance", billed::float8 billed,
            paid::float8 paid, other_charges::float8 "otherCharges",
            source_file "sourceFile", note
       from vendor_statements where vendor_name = $1`, [vendor])) as any;

  const wallet: VendorBalance = {
    id: w.id, vendorName: w.vendor_name,
    initialBalance: Number(w.initial_balance),
    currentBalance: Number(w.current_balance),
    openingDate: w.opening_date ? new Date(w.opening_date).toISOString().slice(0, 10) : undefined,
  } as any;

  const payments: Payment[] = topUps.map(t => ({
    id: t.id, vendorName: t.vendorName, amount: t.amount, date: t.date, note: t.note,
  }));

  const a = ledgerAccount(vendor, statements, tickets, payments,
    { initialBalance: wallet.initialBalance, openingDate: wallet.openingDate });

  console.log('='.repeat(104));
  console.log(`${vendor} — OUR OWN BOOKS`);
  console.log('='.repeat(104));

  console.table(a.periods.map(p => ({
    period: `${p.from} → ${p.to}`,
    opening: m(p.opening),
    issued: n2(p.issued),
    refunded: p.refunded ? n2(p.refunded) : '—',
    paid: p.paid ? '+' + n2(p.paid) : '—',
    closing: m(p.closing),
    rows: p.tickets.length,
    foots: Math.abs(Math.round((p.opening + p.paid - p.issued + p.refunded - p.closing) * 100) / 100) < 0.011
      ? 'ok' : 'OFF',
    theirs: p.statement ? m(p.statement.closingBalance) : '',
    diff: p.balanceGap === null ? '' : (Math.abs(p.balanceGap) < 0.011 ? '—' : n2(p.balanceGap)),
  })));

  const vc = calcVendorBalance(wallet, tickets as any, topUps);

  console.log(`\nour balance on ${a.balanceAsOf}   ${m(a.balance)}`);
  console.log(`Vendor Credit says              ${m(Math.round(vc * 100) / 100)}`);
  const off = Math.round((((a.balance ?? 0) - vc)) * 100) / 100;
  console.log(Math.abs(off) < 0.011
    ? '\n   ✓ the two agree to the piastre'
    : `\n   ✗ THEY DISAGREE BY ${n2(off)} — one of them is wrong`);

  if (a.statedBalance !== null)
    console.log(`\n${vendor} last stated ${m(a.statedBalance)} on ${a.statedAsOf}; `
      + `our books made it ${n2(a.balanceGap ?? 0)} different that day.`);
  if (a.undated)
    console.log(`\n${a.undated} row(s) carry no date (${n2(a.undatedAmount)}); they sit in every `
      + `opening and closing alike and cancel out of the movement.`);

  await c.end();
  if (Math.abs(off) >= 0.011) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
