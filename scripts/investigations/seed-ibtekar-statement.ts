/**
 * Enter Ibtekar's statement of account for 01/08 - 14/09 2026.
 *
 * Read off the PDF the agency was sent (AlSafar AlMutmiz.pdf) by column
 * position rather than by text order - the statement's balance column does not
 * line up row for row with its debit column, and read as flat text the opening
 * balance lands on the first ticket's line.
 *
 * The figures are the statement's own totals, and they foot:
 *   13,235.37 Cr + 20,000.00 paid - 24,969.00 billed = 8,266.37 Cr,
 * which is the "Amount Payable To You" it prints.
 *
 *   npx tsx scripts/investigations/seed-ibtekar-statement.ts
 *   npx tsx scripts/investigations/seed-ibtekar-statement.ts --apply
 */
import 'dotenv/config';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');

const S = {
  id: 'stm_ibtekar_20260801_20260914',
  vendor_name: 'Ibtekar',
  period_start: '2026-08-01',
  period_end: '2026-09-14',
  currency: 'SAR',
  opening_balance: 13235.37,
  closing_balance: 8266.37,
  billed: 24969.00,
  paid: 20000.00,
  other_charges: 0,
  source_file: 'AlSafar AlMutmiz.pdf',
  note: 'Statement of account, 21 ticket lines and receipt RV263365 of 23/08/2026.',
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const implied = S.opening_balance + S.paid - S.billed - S.other_charges;
  console.log(`opening ${S.opening_balance} + paid ${S.paid} - billed ${S.billed} = ${implied.toFixed(2)}`);
  console.log(`statement prints ${S.closing_balance}  ->  ${Math.abs(implied - S.closing_balance) < 0.011 ? 'FOOTS' : 'DOES NOT FOOT'}`);

  // The statement is evidence, so it is entered under whoever owns the ledger.
  const { rows: owner } = await c.query(
    `select user_id from tickets where source = 'Ibtekar' group by user_id
      order by count(*) desc limit 1`);
  if (!owner.length) { console.error('no Ibtekar tickets - cannot tell whose ledger this is'); process.exit(1); }
  const userId = owner[0].user_id;

  const { rows: led } = await c.query(
    `select count(*)::int n, coalesce(sum(amount), 0)::float8 total
       from tickets where source = 'Ibtekar' and date between $1 and $2`,
    [S.period_start, S.period_end]);
  console.log(`ledger over the same dates: ${led[0].n} row(s), ${led[0].total.toFixed(2)} SAR`);
  console.log(`difference to what Ibtekar billed: ${(S.billed - led[0].total).toFixed(2)} SAR`);

  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  await c.query(
    `insert into vendor_statements
       (id, user_id, vendor_name, period_start, period_end, currency,
        opening_balance, closing_balance, billed, paid, other_charges, source_file, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (id) do update set
       opening_balance = excluded.opening_balance,
       closing_balance = excluded.closing_balance,
       billed = excluded.billed, paid = excluded.paid,
       other_charges = excluded.other_charges,
       source_file = excluded.source_file, note = excluded.note`,
    [S.id, userId, S.vendor_name, S.period_start, S.period_end, S.currency,
     S.opening_balance, S.closing_balance, S.billed, S.paid, S.other_charges,
     S.source_file, S.note]);
  console.log('\nstatement stored.');
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
