/**
 * LEDGER INVARIANTS — rules that must hold whatever has been imported.
 *
 * These replace a table of frozen row counts and net totals ("NSA must have
 * exactly 2,770 tickets totalling 5,005,240.97"). That table was written
 * against a snapshot, so every legitimate import broke it; seven assertions
 * had been red for so long that a real failure would have gone unnoticed
 * among them, which is the worst thing a test suite can do.
 *
 * What is asserted here is a RULE rather than a number, so importing a report
 * cannot turn it red — only breaking the rule can. Each one names a specific
 * failure the ledger has actually suffered, so a regression reintroduces a
 * known problem rather than an abstract one.
 *
 * Read-only. Nothing here writes.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { calcVendorBalance, vendorMatchesSource } from '../src/core/helpers/walletMath';
import type { VendorBalance, BalanceTopUp } from '../src/types';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown, detail?: string) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`);
    if (detail) console.log(`          ${detail}`);
  }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  /** Rows breaking a rule, plus one example to chase. */
  const offenders = async (sql: string) => {
    const { rows } = await c.query(sql);
    return { n: Number(rows[0]?.n ?? 0), sample: rows[0]?.sample ?? null };
  };
  const none = async (name: string, sql: string, why: string) => {
    const r = await offenders(sql);
    check(name, r.n, 0, r.n ? `${why}  first offender: ${r.sample}` : undefined);
  };

  console.log('\n1. Ticket identity — the airline never lives inside the ticket number');
  await none('no ticket is stored in the 13-digit joined form',
    `select count(*)::int n, min(ticket_no) sample from tickets where ticket_no ~ '^[0-9]{13}$'`,
    'A joined ticket cannot match its own BSP invoice line, which is how 28 documents ended up stored twice.');
  await none('no airline code was scavenged from its own serial',
    `select count(*)::int n, min(ticket_no) sample from tickets
     where ticket_no ~ '^[0-9]{10}$' and airline_code ~ '^[0-9]{3}$'
       and ticket_no like airline_code || '%'`,
    'Deriving an airline from a bare serial just returns its own first three digits — that is where 1,446 rows stamped "551" came from.');

  console.log('\n2. Money — the figures on a row are coherent');
  // Deliberately NOT asserted: "an ISSUE is never negative". It looks like a
  // rule and is not one. AirArabia credits are recorded as negative ISSUE
  // rows — one carries req num "CREDIT" for -20,000 — and the wallet maths
  // handles them correctly, because subtracting a negative issuance raises the
  // balance, which is what a credit should do. The AirArabia balance is right
  // WITH those rows, so anyone tempted to "fix" them would break a balance
  // that currently reconciles.
  //
  // What is asserted instead are the properties that do hold everywhere, and
  // that a genuine sign or parsing error would break.
  await none('no REFUND carries a positive amount',
    `select count(*)::int n, min(ticket_no) sample from tickets where status = 'REFUND' and amount > 0`,
    'A refund that adds money reverses the sign of a reversal.');
  await none('the gross fare is never negative',
    `select count(*)::int n, min(ticket_no) sample from tickets where total_doc < 0`,
    'total_doc is a magnitude; direction belongs to amount alone.');
  await none('a document with a fare always carries a value',
    `select count(*)::int n, min(ticket_no) sample from tickets
     where total_doc > 0 and amount = 0 and upper(coalesce(status,'')) <> 'VOID'`,
    'A fare with nothing payable and no cancellation means a column was misread.');
  await none('commission never exceeds the fare it was earned on',
    `select count(*)::int n, min(ticket_no) sample from tickets
     where total_doc > 0 and abs(commission) > total_doc + 0.01`,
    'Deriving commission as fare-minus-payable returns the whole fare on a card sale; this is what catches that.');
  await none('no currency outside the supported set',
    `select count(*)::int n, min(currency) sample from tickets
     where currency is not null and currency not in ('SAR','AED','USD','EUR')`,
    'An unrecognised currency is silently excluded from every total.');

  console.log('\n3. Voided documents are discarded, not stored');
  await none('no VOID / CANN / CANX / RFNX row is kept',
    `select count(*)::int n, min(ticket_no) sample from tickets
     where upper(btrim(coalesce(status,''))) in ('VOID','CANN','CANX','CANCEL','CANCELLED','RFNX')`,
    'They settle at zero, so they only pad the ticket count and the not-closed list.');

  console.log('\n4. One row per document');
  await none('no two rows are indistinguishable',
    `select count(*)::int n, min(k) sample from (
       select ticket_no || '|' || source || '|' || coalesce(status,'') || '|' || amount || '|' || date k
       from tickets group by 1 having count(*) > 1) x`,
    'Same ticket, vendor, status, money and date twice is what the system itself calls a duplicate.');
  await none('no document is counted twice across vendors',
    `select count(*)::int n, min(ticket_no) sample from (
       select ticket_no from tickets where ticket_no ~ '^[0-9]{10}$'
       group by ticket_no, (amount < 0), abs(amount)
       having count(distinct source) > 1) x`,
    'A portal sale and its BSP invoice line are ONE sale; holding both doubled 25 documents.');

  console.log('\n5. Vendors and channels are not confused');
  await none('every row names a vendor',
    `select count(*)::int n, min(ticket_no) sample from tickets where coalesce(btrim(source),'') = ''`,
    'A row with no vendor belongs to no wallet and no report.');
  await none('no settlement channel is stored as a vendor',
    `select count(*)::int n, min(source) sample from tickets where source ilike '%websales%'`,
    'WEBSALES-EDIS is a channel within IATA; as a vendor it would draw against a wallet of its own.');
  await none('no wallet exists for a settlement channel',
    `select count(*)::int n, min(vendor_name) sample from vendor_balances
     where vendor_name ilike '%websales%' or vendor_name ~* '^bsp$'`,
    'WEBSALES-EDIS and BSP are how an IATA ticket settles, not who it was bought from. '
    + 'A wallet named after either would draw rows the IATA wallet already holds.');

  // An IATA wallet used to be forbidden here on the same reasoning. It is not
  // any more, because the agency keeps a real IATA credit balance and needs to
  // see it. What must stay true is that such a wallet cannot silently inherit
  // the history it was opened after — see test-iata-phase3, which requires an
  // opening date on every wallet created since the migration.
  await none('a wallet opened since the migration always declares its start date',
    `select count(*)::int n, min(vendor_name) sample from vendor_balances
     where created_at::date > date '2026-07-10' and opening_date is null`,
    'Without one, a balance added today is charged for every ticket the vendor ever issued.');

  console.log('\n6. Wallet arithmetic is the same for every vendor');
  const { rows: vRows } = await c.query(
    `select id, vendor_name, initial_balance::float8 ib, current_balance::float8 cb from vendor_balances`);
  const { rows: tuRows } = await c.query(
    `select id, vendor_id, vendor_name, amount::float8 amount from balance_topups`);
  const { rows: tkRows } = await c.query(
    `select source, amount::float8 amount, status from tickets`);

  for (const v of vRows as any[]) {
    const vendor: VendorBalance = {
      id: v.id, vendorName: v.vendor_name, initialBalance: v.ib, currentBalance: v.cb, userId: '',
    };
    const tu: BalanceTopUp[] = (tuRows as any[])
      .filter(t => t.vendor_id === v.id)
      .map(t => ({ id: t.id, vendorId: t.vendor_id, vendorName: t.vendor_name, amount: t.amount, note: '', date: '', userId: '' }));

    const balance = calcVendorBalance(vendor, tkRows as any, tu);
    const issued = (tkRows as any[])
      .filter(t => vendorMatchesSource(v.vendor_name, t.source) && (t.status || '').toUpperCase() !== 'FUND')
      .reduce((s, t) => s + t.amount, 0);
    const topUps = tu.reduce((s, t) => s + t.amount, 0);

    // One formula, every vendor: money in raises the balance, tickets lower it.
    check(`  ${v.vendor_name}: initial + top-ups - issued`,
      Number(balance.toFixed(2)), Number((v.ib + topUps - issued).toFixed(2)));
  }

  console.log('\n7. A top-up always raises the balance it is paid into');
  for (const v of vRows as any[]) {
    const vendor: VendorBalance = {
      id: v.id, vendorName: v.vendor_name, initialBalance: v.ib, currentBalance: v.cb, userId: '',
    };
    const tu: BalanceTopUp[] = (tuRows as any[])
      .filter(t => t.vendor_id === v.id)
      .map(t => ({ id: t.id, vendorId: t.vendor_id, vendorName: t.vendor_name, amount: t.amount, note: '', date: '', userId: '' }));
    const before = calcVendorBalance(vendor, tkRows as any, tu);
    const after = calcVendorBalance(vendor, tkRows as any,
      [...tu, { id: 'probe', vendorId: v.id, vendorName: v.vendor_name, amount: 100, note: '', date: '', userId: '' }]);
    check(`  ${v.vendor_name}: +100 moves the balance up by 100`,
      Number((after - before).toFixed(2)), 100);
  }

  console.log('\n8. Write access belongs to the people the owner named');
  /**
   * The admins the owner has approved, by name.
   *
   * This used to assert a single admin, from when there was one. A second was
   * added on 2026-08-17 and the owner confirmed it — so the rule is not "how
   * many" but "which": listing them means a THIRD appearing still fails this,
   * which is the thing worth catching. Relaxing it to a count would have
   * turned the check off.
   *
   * app_users carries no audit trail, so an unexpected name here is the only
   * warning there would be. Add to this list only on the owner's say-so.
   */
  const APPROVED_ADMINS = [
    'accounting3@events-explorers.com',
    'accounting1@events-explorers.com',
  ];
  const { rows: admins } = await c.query(`select email from app_users where role = 'admin'`);
  const names = (admins as any[]).map(a => String(a.email).toLowerCase()).sort();
  check('  the admins are exactly the approved ones', names, [...APPROVED_ADMINS].sort());
  const { rows: pol } = await c.query(
    `select tablename, count(*)::int n from pg_policies
     where schemaname='public' and tablename in
       ('tickets','vendor_balances','balance_topups','import_history','error_log')
       and cmd = 'ALL' and qual = 'is_admin()'
     group by tablename order by tablename`);
  check('  every data table restricts writes to is_admin()', pol.length, 5,
    `tables covered: ${(pol as any[]).map(p => p.tablename).join(', ') || 'none'}`);

  await c.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
