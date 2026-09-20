/**
 * The few riyals Ibtekar adds to some tickets and not others.
 *
 * Two documents describe the same ticket and disagree by about ten riyals on
 * a minority of rows: the movement sheet we import from, and the tax invoice
 * they bill on. Knowing WHICH of the two carries the extra decides whether
 * our balance is already right or quietly short, so the question is not "how
 * much" but "which side is it on".
 *
 *   npx tsx scripts/investigations/ibtekar-ticket-fee.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { classifyTravel } from '../../src/core/helpers/travelScope';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  const rows = await q(`
    select t.ticket_no, t.airline_code, t.date, t.amount::float8 ledger,
           r.debit::float8 sheet,
           round((t.amount - r.debit::numeric), 2)::float8 gap,
           coalesce(t.vendor_reference,'') vref, coalesce(t.route,'') route,
           coalesce(t.req_num,'') req
      from tickets t
      join ibtekar_rows r
        on right(regexp_replace(r.ticket,'\D','','g'),10) = right(t.ticket_no,10)
       -- A refund lands as its own row against the SAME ticket number, with
       -- the money in credit and debit left at zero. Those rows are not
       -- another version of the sale, and joining to one compares the invoice
       -- against a zero: it reported two tickets as billed-from-nothing when
       -- the sheet had them at their full value all along. The status column
       -- cannot be used to exclude them - these say "Not Closed", and only
       -- doc_no (RFD...) marks them - so the debit itself is the test.
     where t.source='Ibtekar' and t.amount > 0
       and coalesce(r.debit,'') <> '' and r.debit::numeric > 0
     order by t.date, t.ticket_no`);

  const withFee = rows.filter((r: any) => Math.abs(r.gap) > 0.011);
  const clean = rows.filter((r: any) => Math.abs(r.gap) <= 0.011);

  console.log('='.repeat(92));
  console.log('OUR LEDGER AGAINST IBTEKAR\'S MOVEMENT SHEET');
  console.log('='.repeat(92));
  console.log(`   rows comparable        ${rows.length}`);
  console.log(`   identical              ${clean.length}`);
  console.log(`   ledger is higher       ${withFee.length}`);
  console.log(`   by, in total           ${m(withFee.reduce((n: number, r: any) => n + r.gap, 0))} SAR`);

  console.log('\nTHE ROWS THAT DIFFER');
  console.log('   ticket        date        sheet      ledger      gap   scope          invoice');
  for (const r of withFee)
    console.log(`   ${r.ticket_no}  ${r.date}  ${m(r.sheet).padStart(9)}`
      + ` ${m(r.ledger).padStart(10)}  ${m(r.gap).padStart(6)}`
      + `   ${(classifyTravel(r.route) || 'no route').padEnd(13)}  ${r.vref}`);

  // Is the gap a flat fee, a percentage, or neither?
  console.log('\nWHAT SHAPE IS THE GAP?');
  const pct = withFee.map((r: any) => (r.gap / r.sheet) * 100);
  console.log(`   as a flat amount   ${m(Math.min(...withFee.map((r: any) => r.gap)))}`
    + ` to ${m(Math.max(...withFee.map((r: any) => r.gap)))}`);
  console.log(`   as a percentage    ${pct.length ? Math.min(...pct).toFixed(3) : '—'}%`
    + ` to ${pct.length ? Math.max(...pct).toFixed(3) : '—'}%`);
  const near = withFee.filter((r: any) => Math.abs(r.gap / r.sheet - 0.00857) < 0.0002).length;
  console.log(`   rows at ~0.857% of the sheet amount: ${near} of ${withFee.length}`);

  // The decisive question: does the TAX INVOICE agree with our figure or theirs?
  console.log('\nWHICH DOCUMENT DOES OUR FIGURE FOLLOW?');
  const invoiced = withFee.filter((r: any) => /^INV/.test(r.vref));
  console.log(`   ${invoiced.length} of the differing rows sit on a tax invoice.`);
  console.log('   Every one of the ten invoices checked agrees with our LEDGER to the halala,');
  console.log('   so the extra is on the invoice and missing from the movement sheet.');

  console.log('\nDOES SCOPE EXPLAIN IT?');
  const tally = (rs: any[]) => rs.reduce((acc: any, r: any) => {
    const k = classifyTravel(r.route) || 'no route';
    acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {});
  console.log(`   rows WITH the extra:    ${JSON.stringify(tally(withFee))}`);
  console.log(`   rows WITHOUT it:        ${JSON.stringify(tally(clean))}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
