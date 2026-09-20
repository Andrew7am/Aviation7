/**
 * Reset a vendor wallet to a stated credit, as of a stated day.
 *
 * An opening balance is a statement about a moment — "as of this day we hold
 * this much" — so the day is half the instruction. Tickets before it were
 * settled out of whatever came before and are not charged again; tickets on or
 * after it draw the balance down. Move the figure without moving the day and
 * the same tickets are either charged twice or not at all, and nothing on any
 * screen says so.
 *
 * --balance takes a number when the figure comes from outside (the vendor's
 * portal, a bank statement), or the word `ours` to re-baseline on what our own
 * ledger already makes it. Those are different acts and the run says which it
 * is: adopting an outside figure asserts the vendor is right, while adopting
 * ours draws a line under the history and says we are.
 *
 * Dry run by default. Nothing is written without --apply, and --apply writes a
 * snapshot of the row as it stood first, so the move can be undone with
 * --revert <snapshot.json>.
 *
 *   npx tsx scripts/investigations/set-vendor-credit.ts --vendor NSA --balance ours --as-of 2026-09-20
 *   npx tsx scripts/investigations/set-vendor-credit.ts --vendor IATA --balance 261594.46 --as-of 2026-09-17 --apply
 *   npx tsx scripts/investigations/set-vendor-credit.ts --revert scratch/<vendor>-wallet-<stamp>.json
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const VENDOR = flag('vendor') ?? 'IATA';
/** The ledger source this wallet draws on. Only where it differs from the
 *  wallet's own name, which is the usual case. */
const SOURCE_OF: Record<string, string> = { IATA: 'IATA BSP' };
const LEDGER_SOURCE = SOURCE_OF[VENDOR] ?? VENDOR;

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const [w] = await q(`select * from vendor_balances where vendor_name = $1`, [VENDOR]);
  if (!w) { console.error(`no wallet for ${VENDOR}`); process.exit(1); }

  /* ── revert ─────────────────────────────────────────────────────────────── */
  const revert = flag('revert');
  if (revert) {
    const snap = JSON.parse(readFileSync(revert, 'utf8'));
    console.log(`Restoring the ${VENDOR} wallet from ${revert}:`);
    console.log(`   initial_balance  ${m(w.initial_balance)}  ->  ${m(snap.initial_balance)}`);
    console.log(`   opening_date     ${w.opening_date ?? 'null'}  ->  ${snap.opening_date ?? 'null'}`);
    await q(
      `update vendor_balances set initial_balance = $1, opening_date = $2, current_balance = $3
        where id = $4`,
      [snap.initial_balance, snap.opening_date, snap.current_balance, w.id]);
    console.log('restored.');
    await c.end();
    return;
  }

  const asOf = flag('as-of');
  const raw = flag('balance');
  if (!raw || !asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    console.error('need --vendor <name> --balance <number|ours> --as-of <yyyy-mm-dd>');
    process.exit(1);
  }

  const wasOpen = w.opening_date
    ? new Date(w.opening_date).toISOString().slice(0, 10) : null;

  // `ours` re-baselines on our own arithmetic: whatever the wallet reads today
  // becomes the opening figure, and the history behind it is closed off. The
  // figure is read BEFORE anything is written, from the same rule
  // calcVendorBalance uses, so it is the number on the screen and not a second
  // version of it.
  const fromOurs = raw.toLowerCase() === 'ours';
  let balance: number;
  if (fromOurs) {
    const [cur] = await q(
      `select coalesce(sum(amount),0)::float8 total from tickets
        where source = $1 and upper(coalesce(status,'')) <> 'FUND'
          ${wasOpen ? "and date >= $2 and date <> '' and date is not null" : ''}`,
      wasOpen ? [LEDGER_SOURCE, wasOpen] : [LEDGER_SOURCE]);
    const [tu] = wasOpen
      ? await q(`select coalesce(sum(amount),0)::float8 total from balance_topups
                  where vendor_id = $1 and date >= $2 and date <> '' and date is not null`,
                [w.id, wasOpen])
      : await q(`select coalesce(sum(amount),0)::float8 total from balance_topups
                  where vendor_id = $1`, [w.id]);
    balance = Math.round((Number(w.initial_balance) + Number(tu.total) - cur.total) * 100) / 100;
  } else {
    balance = Number(raw);
    if (!Number.isFinite(balance)) {
      console.error(`--balance must be a number or the word "ours", got ${raw}`);
      process.exit(1);
    }
  }

  /* ── what the change means, before it is made ───────────────────────────── */
  const charged = async (from: string | null) => {
    if (!from) {
      const [r] = await q(
        `select count(*)::int rows, coalesce(sum(amount),0)::float8 total from tickets
          where source = $1 and upper(coalesce(status,'')) <> 'FUND'`, [LEDGER_SOURCE]);
      return r;
    }
    const [r] = await q(
      `select count(*)::int rows, coalesce(sum(amount),0)::float8 total from tickets
        where source = $1 and upper(coalesce(status,'')) <> 'FUND'
          and date >= $2 and date <> '' and date is not null`, [LEDGER_SOURCE, from]);
    return r;
  };
  /** Payments the wallet counts, which an opening date gates exactly as it
   *  gates tickets - a payment made before the wallet opened is already inside
   *  the opening figure. */
  const credited = async (from: string | null) => {
    const [r] = from
      ? await q(`select coalesce(sum(amount),0)::float8 total from balance_topups
                  where vendor_id = $1 and date >= $2 and date <> '' and date is not null`,
                [w.id, from])
      : await q(`select coalesce(sum(amount),0)::float8 total from balance_topups
                  where vendor_id = $1`, [w.id]);
    return Number(r.total);
  };

  const before = await charged(wasOpen);
  const after = await charged(asOf);
  const topsBefore = await credited(wasOpen);
  const topsAfter = await credited(asOf);
  const oldBalance = r2(Number(w.initial_balance) + topsBefore - before.total);
  const newBalance = r2(balance + topsAfter - after.total);

  console.log('='.repeat(88));
  console.log(`${VENDOR} WALLET — ${has('apply') ? 'APPLYING' : 'DRY RUN'}`);
  console.log('='.repeat(88));
  console.log(fromOurs
    ? `\n  Re-baselining on OUR OWN figure of ${m(balance)}. This draws a line under\n`
      + `  everything before ${asOf}: it is not a claim that the vendor agrees, it is a\n`
      + `  decision to stop recomputing the history and to compare only what comes next.`
    : `\n  Adopting a figure of ${m(balance)} stated outside the ledger.`);
  console.log('\n                        before                 after');
  console.log(`  opening balance  ${m(w.initial_balance).padStart(16)}      ${m(balance).padStart(16)}`);
  console.log(`  opening date     ${(wasOpen ?? '(none)').padStart(16)}      ${asOf.padStart(16)}`);
  console.log(`  tickets charged  ${String(before.rows).padStart(16)}      ${String(after.rows).padStart(16)}`);
  console.log(`  they come to     ${m(before.total).padStart(16)}      ${m(after.total).padStart(16)}`);
  console.log(`  payments counted ${m(topsBefore).padStart(16)}      ${m(topsAfter).padStart(16)}`);
  console.log('  ' + '-'.repeat(54));
  console.log(`  THE SCREEN READS ${m(oldBalance).padStart(16)}      ${m(newBalance).padStart(16)}`);

  console.log(`\n  ${m(balance)} + ${m(topsAfter)} − ${m(after.total)} = ${m(newBalance)}`);
  if (newBalance < 0)
    console.log(`\n  This leaves the wallet OVERDRAWN by ${m(Math.abs(newBalance))}: ${after.rows} ticket(s)`
      + `\n  have been issued since ${asOf} and nothing has been paid against them yet.`);

  // Rows that change side. These are the ones the move is really about.
  if (wasOpen && wasOpen !== asOf) {
    const lo = wasOpen < asOf ? wasOpen : asOf;
    const hi = wasOpen < asOf ? asOf : wasOpen;
    const [moved] = await q(
      `select count(*)::int rows, coalesce(sum(amount),0)::float8 total from tickets
        where source = $1 and upper(coalesce(status,'')) <> 'FUND'
          and date >= $2 and date < $3 and date <> ''`, [LEDGER_SOURCE, lo, hi]);
    console.log(`\n  ${moved.rows} ticket(s) worth ${m(moved.total)} dated ${lo} to ${hi} `
      + `${wasOpen < asOf ? 'STOP being charged' : 'START being charged'} to this wallet.`);
    console.log(`  ${wasOpen < asOf
      ? 'They are treated as settled by whatever produced the new figure.'
      : 'They are treated as still outstanding against the new figure.'}`);
  }

  if (!has('apply')) {
    console.log('\nDry run. Nothing was written. Add --apply to make the change.');
    await c.end();
    return;
  }

  /* ── snapshot, then write ───────────────────────────────────────────────── */
  mkdirSync('scratch', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `scratch/${VENDOR.toLowerCase()}-wallet-${stamp}.json`;
  writeFileSync(path, JSON.stringify({
    id: w.id,
    vendor_name: w.vendor_name,
    initial_balance: w.initial_balance,
    current_balance: w.current_balance,
    opening_date: w.opening_date,
    taken_at: new Date().toISOString(),
  }, null, 2));
  console.log(`\nSnapshot written to ${path}`);

  await q(
    `update vendor_balances set initial_balance = $1, opening_date = $2, current_balance = $3
      where id = $4`,
    [balance, asOf, newBalance, w.id]);

  const [check] = await q(`select * from vendor_balances where id = $1`, [w.id]);
  console.log('\nApplied:');
  console.log(`   initial_balance  ${m(check.initial_balance)}`);
  console.log(`   opening_date     ${new Date(check.opening_date).toISOString().slice(0, 10)}`);
  console.log(`   current_balance  ${m(check.current_balance)}`);
  console.log(`\nTo undo: npx tsx scripts/investigations/set-vendor-credit.ts --revert ${path}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
