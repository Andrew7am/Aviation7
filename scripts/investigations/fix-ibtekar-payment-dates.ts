/**
 * Put Ibtekar's payments on the day they were actually received.
 *
 * Twelve payments were imported from Ibtekar's statement as "Auto top-up from
 * Ibtekar". Their total is exactly what Ibtekar's own receipt vouchers come to
 * - 265,000.00 across twelve receipts on both sides - so none is missing and
 * none is doubled. Five of the dates are wrong, and wrong in one particular
 * way:
 *
 *   RV261566  01/06/2026  we hold 2026-01-06   1 June read as 6 January
 *   RV261618  04/06/2026  we hold 2026-04-06   4 June read as 6 April
 *   RV261643  07/06/2026  we hold 2026-07-06   7 June read as 6 July
 *   RV261687  11/06/2026  we hold 2026-11-06  11 June read as 6 November
 *   RV261693  11/06/2026  we hold 2026-11-06  11 June read as 6 November
 *
 * Day and month, swapped. Every payment whose day is 13 or higher is correct -
 * 19/05, 25/05, 14/06, 15/06 - because there is no month 19 to swap into. That
 * is the signature of a date read as mm/dd when the vendor wrote dd/mm, and it
 * can only ever go wrong on the first twelve days of a month.
 *
 * Two of them landed in November, after today, which is how this surfaced: a
 * payment dated outside every period falls out of every balance drawn for one.
 *
 * The receipt each payment answers to is written into the note as well, so the
 * next person does not have to do this matching again.
 *
 *   npx tsx scripts/investigations/fix-ibtekar-payment-dates.ts
 *   npx tsx scripts/investigations/fix-ibtekar-payment-dates.ts --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const SNAP = process.argv.find(a => a.startsWith('--snapshot='))?.split('=')[1]
          ?? 'ibtekar-payment-dates-snapshot.json';

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** dd/mm/yyyy, or an ISO timestamp, as a plain ISO date. */
function asIso(raw: string): string {
  const s = (raw || '').trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? m[0] : '';
}

/** The same date with day and month exchanged, when that is a real date. */
function swapped(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const [, y, mo, d] = m;
  if (Number(d) > 12 || Number(d) < 1) return '';
  return `${y}-${d}-${mo}`;
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: ours } = await c.query(
    `select id, amount::float8 amount, coalesce(note,'') note, coalesce(date,'') date
       from balance_topups where vendor_name = 'Ibtekar' order by date`);

  // Their side: a receipt voucher on a statement row is money they received.
  // The refund documents (RFD) beside them are credits of a different kind and
  // are not payments, so they are left out.
  const { rows: rvs } = await c.query(
    `select r.date, coalesce(r.doc_no,'') doc_no, r.credit::float8 credit
       from ibtekar_rows r
      where r.credit ~ '^[0-9.]+$' and r.credit::float8 >= 1000
      order by r.source_row_num`);

  const theirs = rvs.map((r: any) => ({
    date: asIso(String(r.date)), doc: r.doc_no, amount: Number(r.credit),
  }));

  const oursTotal = ours.reduce((n: number, r: any) => n + r.amount, 0);
  const theirsTotal = theirs.reduce((n: number, r: any) => n + r.amount, 0);
  console.log(`we recorded : ${ours.length} payment(s), ${money(oursTotal)}`);
  console.log(`they receipt: ${theirs.length} receipt(s), ${money(theirsTotal)}`);
  console.log(`difference  : ${money(oursTotal - theirsTotal)}\n`);

  // Match on the amount and a date that is either right or right when swapped.
  // Anything matched on a swap is a correction; anything matched on the date
  // as it stands is already correct and left alone.
  const taken = new Set<number>();
  const fixes: any[] = [];
  const already: any[] = [];
  const unmatched: any[] = [];

  for (const p of ours as any[]) {
    const iso = asIso(p.date);
    const flip = swapped(iso);

    const exact = theirs.findIndex((t, i) =>
      !taken.has(i) && t.date && t.date === iso && Math.abs(t.amount - p.amount) < 0.011);
    if (exact >= 0) { taken.add(exact); already.push({ ...p, receipt: theirs[exact].doc }); continue; }

    const byFlip = flip
      ? theirs.findIndex((t, i) =>
          !taken.has(i) && t.date && t.date === flip && Math.abs(t.amount - p.amount) < 0.011)
      : -1;
    if (byFlip >= 0) {
      taken.add(byFlip);
      fixes.push({ id: p.id, amount: p.amount, was: iso, now: flip,
                   receipt: theirs[byFlip].doc, note: p.note });
      continue;
    }
    unmatched.push({ ...p, iso });
  }

  // One payment is not in ibtekar_rows to be matched against: it was entered by
  // hand as "Aug TopUp" and dated to the month end, while the statement of
  // account for 01/08-14/09 bills it as RV263365 of 23/08/2026. Named here
  // rather than inferred, because month-end and the 23rd cannot be told apart
  // by any rule - only by reading the document.
  const BY_DOCUMENT: { was: string; amount: number; now: string; receipt: string }[] = [
    { was: '2026-08-31', amount: 20000, now: '2026-08-23', receipt: 'RV263365' },
  ];
  for (const k of BY_DOCUMENT) {
    const i = unmatched.findIndex((u: any) =>
      u.iso === k.was && Math.abs(u.amount - k.amount) < 0.011);
    if (i < 0) continue;
    const [u] = unmatched.splice(i, 1);
    fixes.push({ id: u.id, amount: u.amount, was: k.was, now: k.now,
                 receipt: k.receipt, note: u.note });
  }

  console.log(`already on the right day : ${already.length}`);
  if (already.length) console.table(already.map((r: any) => ({
    date: asIso(r.date), amount: money(r.amount), receipt: r.receipt })));

  console.log(`\non the wrong day         : ${fixes.length}`);
  if (fixes.length) console.table(fixes.map(f => ({
    amount: money(f.amount), was: f.was, now: f.now,
    why: swapped(f.was) === f.now ? 'day and month swapped' : 'dated off the receipt',
    receipt: f.receipt || '(no document)' })));

  console.log(`\nno receipt to match      : ${unmatched.length}`);
  if (unmatched.length) console.table(unmatched.map((r: any) => ({
    date: r.iso, amount: money(r.amount), note: r.note.slice(0, 34) })));

  const spare = theirs.filter((_, i) => !taken.has(i));
  console.log(`\nreceipts with no payment recorded against them: ${spare.length}`);
  if (spare.length) console.table(spare.map(t => ({
    date: t.date || '(undated)', document: t.doc || '(none)', amount: money(t.amount) })));

  if (!fixes.length) { console.log('\nnothing to correct.'); await c.end(); return; }
  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); await c.end(); return; }

  const { rows: before } = await c.query(
    `select id, vendor_name, amount::float8 amount, note, date
       from balance_topups where id = any($1)`, [fixes.map(f => f.id)]);
  writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), rows: before }, null, 2));
  console.log(`\nsnapshot: ${SNAP} (${before.length} row(s))`);

  await c.query('begin');
  try {
    let n = 0;
    for (const f of fixes) {
      const note = f.receipt && !f.note.includes(f.receipt)
        ? `${f.note}${f.note ? ' — ' : ''}receipt ${f.receipt}`
        : f.note;
      const r = await c.query(
        `update balance_topups set date = $2, note = $3 where id = $1 and date = $4`,
        [f.id, f.now, note, f.was]);
      n += r.rowCount ?? 0;
    }
    await c.query('commit');
    console.log(`payments re-dated: ${n}`);
  } catch (e) {
    await c.query('rollback');
    console.error('rolled back:', e);
    process.exit(1);
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
