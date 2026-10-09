/**
 * Every request on their sheet, read the way EGPML1909 was read by hand.
 *
 *   1. Documents, not rows: what their sheet names, what our books hold,
 *      and what is only on one side.
 *   2. Money, row by row: their Net Cost against what we paid for the same
 *      documents. Where their figure is LOWER than ours the client was priced
 *      on less than the ticket cost us - that is the loss to look at.
 *      SAR, AED and USD are pegged, so a row priced in one and bought in
 *      another is compared at the peg (1 USD = 3.75 SAR = 3.6725 AED) and
 *      marked as converted.
 *
 * Read-only. Writes JSON for the workbook builder.
 *
 *   npx tsx scripts/investigations/team-sheet-request-audit.ts <out.json>
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync } from 'fs';
import { rowsToCsv } from '../../src/core/integrations/airtable';
import { parseTeamSheet } from '../../src/core/parsers/teamSheet';
import { compareTeamSheet, whoActs, VERDICT_LABEL } from '../../src/core/helpers/teamSheetCompare';
import { unconfirmed } from '../../src/core/helpers/supplierProof';

const TO_SAR: Record<string, number> = { SAR: 1, AED: 3.75 / 3.6725, USD: 3.75 };
const conv = (v: number, from: string, to: string) =>
  TO_SAR[from] && TO_SAR[to] ? (v * TO_SAR[from]) / TO_SAR[to] : null;
const key = (s: string) => (s || '').replace(/\D/g, '').slice(-10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const reqParts = (s: string) => (s || '').toUpperCase().split(/[\s,/;|+&-]+/).filter(x => /^[A-Z]{4,6}\d{2,5}$/.test(x));

(async () => {
  const out = process.argv[2] || 'scratch/request-audit.json';
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const at = (await db.query(`select record_id, req_num, serials, status, net_cost::float n, currency, pnr, ticket_cell, sheet_row
    from airtable_tickets where deleted=false order by created_at`)).rows;
  const L = (await db.query(`select * from tickets`)).rows;
  const tickets = L.map(t => ({ id: t.id, ticketNo: t.ticket_no, source: t.source, date: String(t.date ?? '').slice(0, 10), amount: +t.amount,
    commission: +(t.commission ?? 0), totalDoc: +(t.total_doc ?? 0), reqNum: t.req_num ?? '', pnr: t.pnr ?? '', airlineCode: t.airline_code ?? '',
    status: t.status ?? '', transactionType: t.transaction_type ?? '', currency: t.currency, closed: !!t.closed, relatedTicket: t.related_ticket,
    originalCurrency: t.original_currency, originalAmount: t.original_amount == null ? undefined : +t.original_amount,
    fxRate: t.fx_rate == null ? undefined : +t.fx_rate, reportName: t.report_name ?? '', confirmedBy: t.confirmed_by,
    passengerName: t.passenger_name ?? '' })) as any[];
  const voids = (await db.query(`select ticket_no from void_tickets`)).rows.map(r => r.ticket_no);
  const voided = new Set(voids.map(key));
  await db.end();

  // 1 ─ the comparison itself, on the whole live sheet
  const csv = rowsToCsv(at.map(r => r.sheet_row), (d: any) => {
    const q = (v: string) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    return [d.fields.map(q).join(','), ...d.data.map((r: string[]) => r.map(q).join(','))].join('\n');
  });
  const report = compareTeamSheet(parseTeamSheet(csv).rows, tickets, [], {}, { voided: voids });
  const usFindings = report.findings.filter(f => !f.explained && whoActs(f) === 'US' && f.verdict !== 'OK');

  // 2 ─ money, booking by booking
  /* Their rows are joined into bookings first: one ticket can sit on two of
     their rows (an Issued row at the fare and a Reissue row at the change
     fee; a seat at 320.00 and the fare at 5,700.00), and one PNR can carry
     several rows. Comparing row by row read each part as a shortfall. */
  const bySerial = new Map<string, any[]>();
  for (const t of tickets) { const k = key(t.ticketNo); if (k.length === 10) bySerial.set(k, [...(bySerial.get(k) ?? []), t]); }
  const byPnr = new Map<string, any[]>();
  for (const t of tickets) if (key(t.ticketNo).length !== 10 && t.pnr) byPnr.set(t.pnr.toUpperCase(), [...(byPnr.get(t.pnr.toUpperCase()) ?? []), t]);
  const priced = at.filter(r => /^(Issued|Reissue)$/i.test(r.status || '') && Math.abs(r.n ?? 0) > 0);
  const parent = priced.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  const owner = new Map<string, number>();
  const pnrsOf = (r: any) => String(r.pnr || '').toUpperCase().split(/[\s,|/]+/).filter(p => /^[A-Z0-9]{6}$/.test(p));
  priced.forEach((r, i) => {
    const serials: string[] = r.serials ?? [];
    const ids = serials.length ? serials.map(s => 'S' + s) : pnrsOf(r).map(p => 'P' + p);
    for (const id of ids) { if (owner.has(id)) join(i, owner.get(id)!); else owner.set(id, i); }
  });
  const groups = new Map<number, any[]>();
  priced.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), r]); });

  const costRows: any[] = [];
  for (const rows of groups.values()) {
    const serials = [...new Set(rows.flatMap(r => r.serials ?? []))].filter(s => !voided.has(s)) as string[];
    const emds = rows.flatMap(r => String(r.sheet_row?.['EMD Number'] ?? '').match(/\d{10,13}/g)?.map(key) ?? []);
    let how = 'ticket number';
    let oursAll: any[] = serials.length || emds.length
      ? [...serials, ...emds].flatMap(s => bySerial.get(s) ?? [])
      : rows.flatMap(r => pnrsOf(r).flatMap(p => byPnr.get(p) ?? []));
    if (!serials.length) how = 'PNR';
    oursAll = [...new Map(oursAll.map(t => [t.id, t])).values()];
    const ours = oursAll.filter(t => t.amount > 0);
    const refunded = oursAll.some(t => t.amount < 0) || rows.some(r => /refund/i.test(r.status));
    const curs = [...new Set(rows.map(r => (r.currency || '').toUpperCase()))];
    const cur = curs[0];
    const theirs = r2(rows.reduce((n, r) => n + Math.abs(r.n ?? 0), 0));
    const reqsHere = [...new Set(rows.map(r => r.req_num))];
    const base = { req: reqsHere.join(', '), reqs: reqsHere,
      cell: rows.map(r => String(r.ticket_cell || '').replace(/\s+/g, ' ').slice(0, 70)).join(' + ').slice(0, 160),
      pnr: [...new Set(rows.map(r => r.pnr).filter(Boolean))].join(', '), status: rows.map(r => r.status).join(' + '),
      theirRows: rows.length, docs: serials.length, theirCost: theirs, cur, refunded };
    if (curs.length > 1) { costRows.push({ ...base, verdict: 'NOT_COMPARABLE', why: 'their rows in two currencies' }); continue; }
    if (!ours.length) { costRows.push({ ...base, verdict: 'NOT_HELD', why: 'none of these documents is in our books' }); continue; }
    const value = (t: any, field: 'amount' | 'totalDoc') => {
      const own = String(t.originalCurrency && t.originalAmount ? t.originalCurrency : t.currency).toUpperCase();
      const v = field === 'amount'
        ? Math.abs(t.originalCurrency && t.originalAmount ? t.originalAmount : t.amount)
        : Math.abs(t.originalCurrency && t.originalAmount && t.fxRate ? (t.totalDoc || t.amount) / t.fxRate : (t.totalDoc || t.amount));
      return { v, own };
    };
    const conv2 = (x: { v: number; own: string }) => (x.own === cur ? x.v : conv(x.v, x.own, cur));
    const pay = ours.map(t => conv2(value(t, 'amount'))), fare = ours.map(t => conv2(value(t, 'totalDoc')));
    if (pay.some(v => v == null) || fare.some(v => v == null)) { costRows.push({ ...base, verdict: 'NOT_COMPARABLE', why: 'currency not pegged' }); continue; }
    const converted = ours.some(t => value(t, 'amount').own !== cur);
    const payable = r2(pay.reduce((a, b) => a + b!, 0)), fareSum = r2(fare.reduce((a, b) => a + b!, 0));
    // The same figures, unconverted: an AED total written into a SAR column.
    const rawSum = r2(ours.reduce((n, t) => n + value(t, 'amount').v, 0));
    const heldDocs = new Set(ours.map(t => key(t.ticketNo) || t.id)).size;
    // A single row's figure may be each document's ("640.00" for two at 640.00).
    const readings = rows.length === 1 && heldDocs > 1 ? [theirs, theirs * heldDocs] : [theirs];
    const gap = readings.flatMap(x => [payable, fareSum].map(v => x - v)).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
    const tol = Math.max(15, (converted ? 0.01 : 0.005) * payable);
    let verdict = gap < -tol ? 'THEIRS_LOWER' : gap > tol ? 'THEIRS_HIGHER' : 'AGREES';
    let why = '';
    if (verdict !== 'AGREES' && converted && Math.abs(theirs - rawSum) <= Math.max(1, 0.002 * rawSum)) {
      verdict = 'CURRENCY_LABEL';
      why = `their ${cur} figure is our ${value(ours[0], 'amount').own} amount unconverted`;
    }
    costRows.push({ ...base, verdict, why, ours: payable, fare: fareSum, heldDocs, diff: r2(gap), converted, how });
  }

  // 3 ─ per request
  const reqs = new Map<string, any>();
  const get = (q: string) => {
    if (!reqs.has(q)) reqs.set(q, { req: q, theirRows: 0, theirTickets: new Set<string>(), onHold: 0, ourDocs: new Set<string>(), ourRows: 0,
      tickets: 0, emds: 0, refunds: 0, onlyTheirs: 0, onlyOurs: 0, misfiled: 0, refundIssues: 0, unconfirmed: 0,
      compared: 0, agrees: 0, lower: 0, lowerAmt: 0, higher: 0, higherAmt: 0, notHeld: 0, notComparable: 0, currencyLabel: 0 });
    return reqs.get(q)!;
  };
  for (const r of at) {
    const q = get(r.req_num); q.theirRows++;
    for (const s of r.serials ?? []) q.theirTickets.add(s);
    if (/hold/i.test(r.status || '') && !(r.serials ?? []).length) q.onHold++;
  }
  for (const t of tickets) for (const p of reqParts(t.reqNum)) if (reqs.has(p)) {
    const q = reqs.get(p)!; q.ourRows++;
    q.ourDocs.add(key(t.ticketNo).length === 10 ? key(t.ticketNo) : (t.pnr || t.id));
    if (t.amount < 0) q.refunds++; else if (/EMD/i.test(`${t.status} ${t.transactionType}`)) q.emds++; else q.tickets++;
    if (unconfirmed(t)) q.unconfirmed++;
  }
  for (const b of report.byRequest) if (reqs.has(b.reqNum)) {
    const q = reqs.get(b.reqNum)!; q.onlyTheirs = b.onlyTheirs; q.onlyOurs = b.onlyOurs; q.misfiled = b.misfiled;
  }
  for (const f of usFindings) if (/REFUND/.test(f.verdict))
    for (const p of new Set([...reqParts(f.reqNum), ...reqParts(f.theirReq)])) if (reqs.has(p)) reqs.get(p)!.refundIssues++;
  for (const c of costRows) {
    const q = get(c.reqs[0]);
    if (c.verdict === 'NOT_HELD') { q.notHeld++; continue; }
    if (c.verdict === 'NOT_COMPARABLE') { q.notComparable++; continue; }
    q.compared++;
    const inSar = (v: number) => conv(v, c.cur, 'SAR') ?? v;
    if (c.verdict === 'AGREES') q.agrees++;
    if (c.verdict === 'THEIRS_LOWER') { q.lower++; q.lowerAmt += inSar(Math.abs(c.diff)); }
    if (c.verdict === 'THEIRS_HIGHER') { q.higher++; q.higherAmt += inSar(c.diff); }
    if (c.verdict === 'CURRENCY_LABEL') { q.currencyLabel++; }
  }
  const byReq = [...reqs.values()].map(q => ({ ...q, theirTickets: q.theirTickets.size, ourDocs: q.ourDocs.size,
    lowerAmt: r2(q.lowerAmt), higherAmt: r2(q.higherAmt) }))
    .sort((a, b) => b.lowerAmt - a.lowerAmt || b.onlyOurs - a.onlyOurs || a.req.localeCompare(b.req));

  const findings = usFindings.map(f => ({ verdict: f.verdict, label: (VERDICT_LABEL as any)[f.verdict] ?? f.verdict,
    serial: f.serial, pnr: f.pnr, ourReq: f.reqNum, theirReq: f.theirReq, note: f.note }));

  writeFileSync(out, JSON.stringify({ byReq, costRows, findings }, null, 1));
  const tot = (k: string) => byReq.reduce((n, q) => n + q[k], 0);
  console.log({ requests: byReq.length, costRows: costRows.length, agrees: tot('agrees'), lower: tot('lower'),
    lowerSAR: r2(tot('lowerAmt')), higher: tot('higher'), higherSAR: r2(tot('higherAmt')), notHeld: tot('notHeld'),
    notComparable: tot('notComparable'), currencyLabel: tot('currencyLabel'), onlyOurs: tot('onlyOurs'), onlyTheirs: tot('onlyTheirs'), misfiled: tot('misfiled'),
    unconfirmed: tot('unconfirmed'), usFindings: findings.length });
})();
