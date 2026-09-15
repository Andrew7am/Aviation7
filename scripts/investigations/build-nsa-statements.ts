/**
 * NSA's statement of account, cut into months.
 *
 * Their Ticketwise export is already in the database, 2,785 rows of it, and
 * its running outstanding balance walks without a single break across all
 * 2,784 steps. That makes the opening and closing figure for any period
 * readable straight off the statement rather than derived from our own rows -
 * which matters, because a balance the vendor stated is evidence and a balance
 * we worked out is arithmetic.
 *
 * Two things have to be got right or the periods are worthless.
 *
 * The sign. NSA's balance RISES as they bill us: it is what we owe them, their
 * Dr. Ibtekar prints the opposite - what they hold for us, their Cr - and the
 * screen shows both under one convention where positive is credit in our
 * favour. So every NSA balance is negated on the way in.
 *
 * The deposits. A credit on their statement is either money we paid in or a
 * ticket they credited back, and those are not the same thing to anybody. The
 * deposits carry a receipt voucher number - RV-25-06-0100 - or say so in
 * words; the rest are refunds against a document. Run together, a month with a
 * big refund reads as a month we paid them, and the "paid" column stops
 * meaning anything.
 *
 *   npx tsx scripts/investigations/build-nsa-statements.ts
 *   npx tsx scripts/investigations/build-nsa-statements.ts --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.find(a => a.startsWith('--snapshot='))?.split('=')[1]
          ?? 'nsa-statements-snapshot.json';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/,/g, '');
  const n = Number(s);
  return s && Number.isFinite(n) ? n : 0;
};
const iso = (v: unknown) => {
  const s = String(v ?? '').trim();
  let x = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (x) return x[0];
  x = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return x ? `${x[3]}-${x[2]}-${x[1]}` : '';
};

/**
 * Money we paid in, as against a ticket credited back.
 *
 * A receipt voucher number, or the word in as many words. And a credit that
 * names NO document at all: a credit against something is always against a
 * document and says which, so one that names nothing is not a credit against
 * anything - it is money arriving. One row of the 2,785 is like that, blank
 * but for a date and 300,000.00, and reading it as a refund made July look
 * 300,000.00 out against our own ledger when nothing was wrong with either.
 */
const isDeposit = (r: any) => {
  const doc = String(r.doc_no ?? '').trim();
  const lpo = String(r.lpo ?? '').trim();
  return /^RV-/i.test(doc) || /^RV-/i.test(lpo)
      || /payment/i.test(String(r.description ?? ''))
      || (!doc && !lpo);
};

const lastDay = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select source_row_num n, date, doc_no, description, lpo_number lpo,
            debit_sar debit, credit_sar credit, c_0utstanding_balances balance
       from nsa_rows order by source_row_num`);

  // The balance before the first row that carries a date: the opening B/F.
  const opening0 = num((rows as any[])[0].balance);

  // An undated row cannot be put in a month. It still moved the balance, so it
  // is carried into whichever month it sits between rather than dropped - the
  // running balance is the authority and it does not skip them.
  let month = '';
  const periods: any[] = [];
  let prevBalance = opening0;
  let cur: any = null;

  for (const r of (rows as any[]).slice(1)) {
    const d = iso(r.date);
    const key = d ? d.slice(0, 7) : month;
    if (!key) { prevBalance = num(r.balance); continue; }

    if (key !== month) {
      if (cur) { cur.closing = prevBalance; periods.push(cur); }
      month = key;
      cur = {
        month, opening: prevBalance, closing: 0,
        debits: 0, refunds: 0, deposits: 0,
        rows: 0, undated: 0, firstDate: d, lastDate: d,
      };
    }
    const deb = num(r.debit), cred = num(r.credit);
    cur.debits += deb;
    if (cred) { if (isDeposit(r)) cur.deposits += cred; else cur.refunds += cred; }
    cur.rows++;
    if (!d) cur.undated++; else cur.lastDate = d;
    prevBalance = num(r.balance);
  }
  if (cur) { cur.closing = prevBalance; periods.push(cur); }

  console.log(`NSA statement: ${rows.length} row(s), ${periods.length} month(s)`);
  console.log(`opening B/F ${m(opening0)} Dr  ->  closing ${m(prevBalance)} Dr\n`);

  let bad = 0;
  const table = periods.map(p => {
    // Their arithmetic: what we owe rises by what they bill and falls by what
    // we pay and by what they credit back.
    const implied = r2(p.opening + p.debits - p.refunds - p.deposits);
    const gap = r2(implied - p.closing);
    if (Math.abs(gap) > 0.011) bad++;
    return {
      month: p.month, rows: p.rows,
      'opening (Dr)': m(p.opening), billed: m(p.debits),
      refunded: m(p.refunds), deposits: m(p.deposits),
      'closing (Dr)': m(p.closing),
      foots: Math.abs(gap) < 0.011 ? 'yes' : `off by ${m(gap)}`,
    };
  });
  console.table(table);
  console.log(`months that do not foot: ${bad}`);

  // Each month must open where the last one closed, or a month is missing.
  let chain = 0;
  for (let i = 1; i < periods.length; i++) {
    if (Math.abs(periods[i].opening - periods[i - 1].closing) > 0.011) chain++;
  }
  console.log(`breaks in the chain    : ${chain}`);

  const totalDebits = periods.reduce((n, p) => n + p.debits, 0);
  const totalRef = periods.reduce((n, p) => n + p.refunds, 0);
  const totalDep = periods.reduce((n, p) => n + p.deposits, 0);
  console.log(`\nbilled    ${m(totalDebits)}`);
  console.log(`refunded  ${m(totalRef)}`);
  console.log(`deposits  ${m(totalDep)}`);
  console.log(`opening ${m(opening0)} + billed - refunded - deposits = ${m(r2(opening0 + totalDebits - totalRef - totalDep))}`);
  console.log(`statement closes at                                    ${m(prevBalance)}`);

  if (bad || chain) { console.log('\nNot writing: the periods do not reconcile.'); await c.end(); return; }
  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  const { rows: owner } = await c.query(
    `select user_id from tickets where source = 'NSA' group by user_id order by count(*) desc limit 1`);
  if (!owner.length) { console.error('no NSA tickets - cannot tell whose ledger this is'); process.exit(1); }
  const userId = owner[0].user_id;

  const { rows: before } = await c.query(
    `select * from vendor_statements where vendor_name = 'NSA'`);
  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), rows: before }, null, 2));
  console.log(`\nsnapshot: ${SNAP} (${before.length} existing row(s))`);

  await c.query('begin');
  try {
    for (const p of periods) {
      const [y, mo] = p.month.split('-').map(Number);
      const start = `${p.month}-01`;
      const end = lastDay(y, mo);
      await c.query(
        `insert into vendor_statements
           (id, user_id, vendor_name, period_start, period_end, currency,
            opening_balance, closing_balance, billed, paid, other_charges, source_file, note)
         values ($1,$2,'NSA',$3,$4,'SAR',$5,$6,$7,$8,0,$9,$10)
         on conflict (id) do update set
           opening_balance = excluded.opening_balance,
           closing_balance = excluded.closing_balance,
           billed = excluded.billed, paid = excluded.paid,
           source_file = excluded.source_file, note = excluded.note`,
        [`stm_nsa_${p.month.replace('-', '')}`, userId, start, end,
         // Their Dr is what we owe; the screen's positive is credit in our
         // favour, so both balances change sign on the way in.
         -p.opening, -p.closing,
         r2(p.debits - p.refunds), r2(p.deposits),
         'Aviation 1 (2).xlsx',
         `${p.rows} statement row(s); ${m(p.refunds)} credited back against documents.`]);
    }
    await c.query('commit');
    console.log(`statements written: ${periods.length}`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
