/**
 * Set the day a wallet's opening balance starts counting from.
 *
 * A balance opened today should not be charged for tickets settled months ago.
 * This sets that date on an existing wallet and shows what the balance becomes
 * before writing anything.
 *
 *   npx tsx scripts/set-wallet-opening-date.ts --vendor=IATA --from=2026-09-02 [--apply]
 *   npx tsx scripts/set-wallet-opening-date.ts --vendor=IATA --clear [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { calcVendorBalance, undatedSkipped, drawsOnWallet } from '../src/core/helpers/walletMath';
import type { VendorBalance, BalanceTopUp } from '../src/types';

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes('--apply');
const CLEAR = process.argv.includes('--clear');
const VENDOR = arg('vendor');
const FROM = arg('from');

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  if (!VENDOR || (!FROM && !CLEAR)) {
    console.error('need --vendor=<name> and either --from=YYYY-MM-DD or --clear');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: vrows } = await c.query(
    `select id, vendor_name, initial_balance::float8 initial,
            current_balance::float8 current, opening_date::text opening_date
     from vendor_balances where lower(vendor_name) = lower($1)`, [VENDOR]);
  if (!vrows.length) { console.error(`no wallet named "${VENDOR}"`); process.exit(1); }
  const v = vrows[0] as any;

  const { rows: tickets } = await c.query(
    `select source, amount::float8 amount, status, date from tickets`);
  const { rows: topUpRows } = await c.query(
    `select id, vendor_id, vendor_name, amount::float8 amount, coalesce(note,'') note,
            coalesce(date,'') date from balance_topups`);
  const topUps: BalanceTopUp[] = (topUpRows as any[]).map(t => ({
    id: t.id, vendorId: t.vendor_id, vendorName: t.vendor_name,
    amount: t.amount, note: t.note, date: t.date, userId: 'x',
  }));

  const base: VendorBalance = {
    id: v.id, vendorName: v.vendor_name, initialBalance: v.initial,
    currentBalance: v.current, userId: 'x',
  };
  const before = calcVendorBalance(
    { ...base, openingDate: v.opening_date ?? undefined }, tickets as any, topUps);
  const after = calcVendorBalance(
    { ...base, openingDate: CLEAR ? undefined : FROM }, tickets as any, topUps);

  // Counted through the same rule the balance uses, so the two can never
  // disagree about what was charged.
  const charged = (from?: string) => (tickets as any[])
    .filter(t => (t.source || '').toLowerCase().includes(v.vendor_name.toLowerCase()))
    .filter(t => (t.status || '').toUpperCase() !== 'FUND')
    .filter(t => drawsOnWallet({ openingDate: from }, t.date));

  console.log(`wallet: ${v.vendor_name}`);
  console.log(`opening balance: ${money(v.initial)}`);
  console.log(`opening date:    ${v.opening_date ?? '(none — charges everything)'}` +
              `  ->  ${CLEAR ? '(none)' : FROM}\n`);
  console.table([
    { '': 'before', 'tickets charged': charged(v.opening_date ?? undefined).length, balance: money(before) },
    { '': 'after', 'tickets charged': charged(CLEAR ? undefined : FROM).length, balance: money(after) },
  ]);

  const skipped = undatedSkipped(
    { ...base, openingDate: CLEAR ? undefined : FROM }, tickets as any);
  if (skipped.count) {
    console.log(`\nNOT charged — ${skipped.count} ticket(s) with no date at all, ` +
                `worth ${money(skipped.amount)}.`);
    console.log('An undated ticket cannot be shown to fall after the opening day, and');
    console.log('every one left in this ledger is legacy data, so charging it would');
    console.log('double-count a sale the opening balance already accounts for.');
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await c.end(); return; }

  await c.query(
    `update vendor_balances set opening_date = $2, current_balance = $3 where id = $1`,
    [v.id, CLEAR ? null : FROM, after]);
  console.log(`\nAPPLIED — ${v.vendor_name} now starts from ${CLEAR ? '(none)' : FROM}, balance ${money(after)}`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
