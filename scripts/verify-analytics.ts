/**
 * Check the analytics screen's arithmetic against the database itself.
 *
 * The screen's figures come from computeAnalytics(). This works the same
 * numbers out independently in SQL and compares them line by line, so a
 * mistake in that function shows up as a disagreement rather than as a
 * plausible-looking percentage nobody questions.
 *
 *   npx tsx scripts/verify-analytics.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { computeAnalytics } from '../src/core/helpers/analytics';
import { airlineName } from '../src/core/config/airlines';
import { sourceToCurrency } from '../src/core/helpers/sourceCurrency';
import type { Ticket } from '../src/types';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select id, ticket_no, source, date, amount::float8 amount,
            commission::float8 commission, total_doc::float8 total_doc,
            coalesce(req_num,'') req_num, coalesce(airline_code,'') airline_code,
            coalesce(route,'') route, status, coalesce(channel,'') channel,
            coalesce(cabin_class,'') cabin_class, coalesce(cabin_raw,'') cabin_raw
     from tickets`);

  const tickets: Ticket[] = (rows as any[]).map(r => ({
    id: r.id, ticketNo: r.ticket_no, source: r.source, date: r.date ?? '',
    amount: r.amount, commission: r.commission, totalDoc: r.total_doc,
    reqNum: r.req_num, airlineCode: r.airline_code, route: r.route,
    status: r.status, channel: r.channel,
    cabinClass: r.cabin_class || undefined, cabinRaw: r.cabin_raw || undefined,
    userId: 'x',
  }));
  console.log(`ledger: ${tickets.length} rows\n`);

  const an = computeAnalytics(tickets);

  // ── 1. What is actually being counted ──────────────────────────────────
  // Written out in SQL rather than reusing the app's own predicate: a check
  // that borrows the code it is checking proves only that the code equals
  // itself. A ticket counts when it is a ticket and the money went out.
  const IS_TICKET = `
    upper(status) not in ('FUND','ACM','ADM','REFUND','EMD','EMDS','EMDA')
    and amount >= 0`;
  // Everything an airline's figures are built from. Only wallet funding is
  // out, because it carries no airline code — every other document does.
  const IN_LEDGER = `upper(status) <> 'FUND'`;

  console.log('1. What each status contributes to the airline ranking');
  console.table((await c.query(
    `select status, count(*)::int rows,
            count(*) filter (where ${IS_TICKET})::int counted_as_ticket,
            count(*) filter (where amount < 0)::int negative
     from tickets group by 1 order by rows desc`)).rows);

  // ── 2. The independent count ───────────────────────────────────────────
  const { rows: sqlAirline } = await c.query(
    `select coalesce(nullif(trim(airline_code),''),'No code') code,
            count(*) filter (where ${IS_TICKET})::int issued
     from tickets where ${IN_LEDGER}
     group by 1 order by issued desc`);

  console.log('\n2. Airline counts: the screen vs the database');
  check('same number of airline rows', an.byAirline.length, sqlAirline.length);
  let mismatched = 0;
  for (const s of sqlAirline as any[]) {
    const a = an.byAirline.find(x => x.key === s.code);
    if (!a) { console.log(`  MISSING from the screen: ${s.code}`); mismatched++; continue; }
    if (a.tickets !== s.issued) {
      console.log(`  ${s.code}: screen says ${a.tickets}, database says ${s.issued}`);
      mismatched++;
    }
  }
  check('every airline count matches', mismatched, 0);

  // ── 3. The percentages ─────────────────────────────────────────────────
  console.log('\n3. The percentages');
  const totalIssued = an.byAirline.reduce((s, r) => s + r.tickets, 0);
  const pctSum = an.byAirline.reduce((s, r) => s + r.pct, 0);
  check('percentages add up to 100', Math.round(pctSum * 100) / 100, 100);
  check('the denominator is every issued ticket', totalIssued, an.issuedCount);

  const { rows: [{ n: sqlIssued }] } = await c.query(
    `select count(*)::int n from tickets where ${IS_TICKET}`);
  check('issued count matches the database', an.issuedCount, sqlIssued);

  const { rows: [{ n: sqlRefunds }] } = await c.query(
    `select count(*)::int n from tickets where upper(status) = 'REFUND'`);
  check('refund count matches the database', an.refundCount, sqlRefunds);

  const { rows: [{ n: sqlOther }] } = await c.query(
    `select count(*)::int n from tickets
     where ${IN_LEDGER} and not (${IS_TICKET}) and upper(status) <> 'REFUND'`);
  check('memo/EMD count matches the database', an.otherDocCount, sqlOther);

  // Nothing may fall between the three columns, and nothing may sit in two.
  const { rows: [{ n: sqlAllDocs }] } = await c.query(
    `select count(*)::int n from tickets where ${IN_LEDGER}`);
  check('every document is counted exactly once',
    an.issuedCount + an.refundCount + an.otherDocCount, sqlAllDocs);

  const perRow = an.byAirline.reduce((s, r) => s + r.tickets + r.refunds + r.otherDocs, 0);
  check('the airline rows account for every document', perRow, sqlAllDocs);

  // Money is a separate question from counting: an EMD, a refund and a credit
  // note are all excluded from the ticket count, and all three still belong in
  // the totals.
  const { rows: [{ s: sqlAll }] } = await c.query(
    `select round(sum(amount)::numeric, 2)::text s from tickets where ${IN_LEDGER}`);
  const anAll = an.byAirline.reduce((s, r) => s + r.sar + r.aed + r.other, 0);
  check('no money is dropped by the ticket rule',
    Math.round(anAll * 100) / 100, Number(sqlAll));

  let recomputed = 0;
  for (const r of an.byAirline) {
    if (Math.abs(r.pct - (r.tickets / totalIssued) * 100) > 0.0001) recomputed++;
  }
  check('every percentage is its own share of the total', recomputed, 0);

  // ── 4. The money, per currency ─────────────────────────────────────────
  console.log('\n4. The money');
  const sqlSar = { net: 0, issued: 0, refunded: 0 };
  const sqlAed = { net: 0, issued: 0, refunded: 0 };
  for (const t of tickets) {
    // Only funding is out. A memo and an EMD are airline money and belong in
    // these totals exactly as a refund does.
    if ((t.status || '').toUpperCase() === 'FUND') continue;
    const cur = sourceToCurrency(t.source || '');
    const box = cur === 'SAR' ? sqlSar : cur === 'AED' ? sqlAed : null;
    if (!box) continue;
    box.net += t.amount;
    if (t.amount < 0) box.refunded += t.amount; else box.issued += t.amount;
  }
  const anSar = an.byAirline.reduce((s, r) => s + r.sar, 0);
  const anAed = an.byAirline.reduce((s, r) => s + r.aed, 0);
  check('SAR across all airlines equals the ledger', Math.round(anSar * 100) / 100, Math.round(sqlSar.net * 100) / 100);
  check('AED across all airlines equals the ledger', Math.round(anAed * 100) / 100, Math.round(sqlAed.net * 100) / 100);
  check('SAR total matches the totals block', Math.round(an.totals.sar * 100) / 100, Math.round(sqlSar.net * 100) / 100);
  check('AED total matches the totals block', Math.round(an.totals.aed * 100) / 100, Math.round(sqlAed.net * 100) / 100);
  check('no money lands outside SAR or AED',
    Math.round(an.byAirline.reduce((s, r) => s + r.other, 0) * 100) / 100, 0);

  // ── 4a. Share by VOLUME, not ticket count ──────────────────────────────
  // Recomputed independently here rather than by calling tally()/addMoney()
  // again: iterate the raw ticket rows directly, same as section 4 above does
  // for the SAR/AED totals, reusing only sourceToCurrency (the shared mapping
  // every screen already uses) — never the function actually under test.
  console.log('\n4a. Airline share by volume (SAR / AED), not ticket count');
  const volSar = new Map<string, number>();
  const volAed = new Map<string, number>();
  for (const t of tickets) {
    if ((t.status || '').toUpperCase() === 'FUND') continue;
    if (t.amount < 0) continue;           // sarIssued/aedIssued: gross ISSUED only
    const key = (t.airlineCode || '').trim() || 'No code';
    const cur = sourceToCurrency(t.source || '');
    if (cur === 'SAR') volSar.set(key, (volSar.get(key) ?? 0) + t.amount);
    else if (cur === 'AED') volAed.set(key, (volAed.get(key) ?? 0) + t.amount);
  }
  const totalVolSar = [...volSar.values()].reduce((s, n) => s + n, 0) || 1;
  const totalVolAed = [...volAed.values()].reduce((s, n) => s + n, 0) || 1;

  let sarMismatch = 0, aedMismatch = 0;
  for (const r of an.byAirline) {
    const wantSar = ((volSar.get(r.key) ?? 0) / totalVolSar) * 100;
    const wantAed = ((volAed.get(r.key) ?? 0) / totalVolAed) * 100;
    if (Math.abs(r.pctSar - wantSar) > 0.005) {
      console.log(`  ${r.key}: pctSar got ${r.pctSar.toFixed(3)}, want ${wantSar.toFixed(3)}`);
      sarMismatch++;
    }
    if (Math.abs(r.pctAed - wantAed) > 0.005) {
      console.log(`  ${r.key}: pctAed got ${r.pctAed.toFixed(3)}, want ${wantAed.toFixed(3)}`);
      aedMismatch++;
    }
  }
  check('every airline\'s SAR volume share matches an independent recomputation', sarMismatch, 0);
  check('every airline\'s AED volume share matches an independent recomputation', aedMismatch, 0);

  check('SAR volume shares add up to 100',
    Math.round(an.byAirline.reduce((s, r) => s + r.pctSar, 0) * 100) / 100, 100);
  check('AED volume shares add up to 100',
    Math.round(an.byAirline.reduce((s, r) => s + r.pctAed, 0) * 100) / 100, 100);

  // The two bases are genuinely different questions, not the same number
  // twice — assert they actually disagree somewhere, so a future refactor
  // that quietly makes pctSar an alias for pct would be caught.
  const differs = an.byAirline.some(r => Math.abs(r.pctSar - r.pct) > 0.5);
  check('volume share and ticket-count share are not just the same number', differs, true);

  // ── 4b. Cabins ─────────────────────────────────────────────────────────
  console.log('\n4b. Cabin');
  const { rows: sqlCabin } = await c.query(
    `select coalesce(cabin_class,'(none)') cabin, count(*)::int tickets
     from tickets where ${IS_TICKET} group by 1 order by tickets desc`);
  console.table(sqlCabin);

  // The shares are of tickets that HAVE a cabin, not of every ticket — a
  // "Not recorded" slice at three quarters buried every real cabin.
  const { rows: [{ known: sqlKnown }] } = await c.query(
    `select count(*)::int known from tickets
     where ${IS_TICKET} and cabin_class is not null`);
  check('the cabin table counts every ticket that HAS a cabin', an.cabinKnown, sqlKnown);
  check('and reports the total it was measured against', an.cabinTotal, an.issuedCount);
  check('no "not recorded" row is in the ranking',
    an.byCabin.some(r => /not recorded/i.test(r.key)), false);
  check('cabin percentages add to 100 across the known ones',
    Math.round(an.byCabin.reduce((s, r) => s + r.pct, 0) * 100) / 100, 100);

  for (const s of (sqlCabin as any[]).filter(r => r.cabin !== '(none)')) {
    const label = { FIRST: 'First', BUSINESS: 'Business',
                    PREMIUM_ECONOMY: 'Premium Economy', ECONOMY: 'Economy' }[s.cabin as string]!;
    const row = an.byCabin.find(r => r.key === label);
    check(`  ${label}: ${s.tickets}`, row?.tickets ?? 0, s.tickets);
  }

  // The tickets left out of the ranking must still be accounted for, or the
  // coverage line would be quietly wrong.
  const { rows: [{ n: sqlNoCabin }] } = await c.query(
    `select count(*)::int n from tickets where ${IS_TICKET} and cabin_class is null`);
  check('known plus unrecorded is every issued ticket',
    an.cabinKnown + sqlNoCabin, an.issuedCount);

  // The per-airline split has to add back up to that airline's own count, or
  // a cabin has been counted against the wrong carrier.
  const badSplit = an.byAirline.filter(r => {
    const sum = r.cabins.FIRST + r.cabins.BUSINESS + r.cabins.PREMIUM_ECONOMY
              + r.cabins.ECONOMY + r.cabins.unknown;
    return sum !== r.tickets;
  });
  check('every airline\'s cabin split adds up to its ticket count', badSplit.length, 0);

  // ── 5. Every code, named or not ────────────────────────────────────────
  console.log('\n5. Every airline in the ranking');
  console.table(an.byAirline.map(r => ({
    code: r.key,
    airline: r.key === 'No code' ? '—' : (airlineName(r.key) || '(name unknown)'),
    tickets: r.tickets,
    'share (tickets)': `${r.pct.toFixed(2)}%`,
    'share (SAR vol)': r.sarIssued ? `${r.pctSar.toFixed(2)}%` : '—',
    'share (AED vol)': r.aedIssued ? `${r.pctAed.toFixed(2)}%` : '—',
    'net SAR': r.sar ? money(r.sar) : '—',
    'net AED': r.aed ? money(r.aed) : '—',
  })));

  const unnamed = an.byAirline.filter(r => r.key !== 'No code' && !airlineName(r.key));
  console.log(`\ncodes still without a name: ${unnamed.length}` +
    (unnamed.length ? ` (${unnamed.reduce((s, r) => s + r.tickets, 0)} tickets)` : ''));

  console.log(`\n${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
