/**
 * Twenty-six ticket numbers in the ledger that cannot be matched to anything.
 *
 * A ticket number is the only thing that ties our books to a supplier's
 * invoice, to the aviation team's sheet and to the airline. These rows carry
 * something that is nearly a ticket number and does not reduce to one, so
 * every reconciliation silently steps over them: 53,832 SAR a row on the
 * largest, and nobody has ever seen them in a comparison.
 *
 * WHAT THIS DOES AND DOES NOT DECIDE
 *
 * Only the ticket number and the airline code are touched. No amount, date,
 * request, status or closure changes, and no row is created or deleted -
 * because the fault is in how the document was written down, not in what it
 * cost. A row whose correct number cannot be derived from what is there is
 * printed and left alone; inventing one would be worse than the fault.
 *
 * The four kinds, in descending order of certainty:
 *
 *   DOT      "065-.5066646757" - a stray dot between the airline and the
 *            serial. Both halves are present and correct. 7 rows.
 *
 *   CARRIER  "593-A7RKKF" - flynas issues no IATA ticket; the booking
 *            reference is the document, and the airline code was written in
 *            front of it. Stored the way every other flynas row is stored,
 *            with the reference as the number and 593 in the airline
 *            column. 3 rows.
 *
 *   CONJUNCTION  "1763000541793-794" - one passenger, one fare, two
 *            document numbers, which is how an airline issues an itinerary
 *            too long for one ticket. The row is already right about the
 *            money; it is the number that cannot be read. Set to the first
 *            document, and the second is REPORTED rather than written,
 *            because creating a row for it would double 53,832 SAR. 10 rows.
 *
 *   PNR      "-" on a flydubai row whose PNR is EKER1I. flydubai's
 *            reference is its document, so the PNR is the number. An
 *            inference rather than a reading, so it is off unless asked
 *            for: --from-pnr. 2 rows, flydubai and Air Arabia.
 *
 * Dry run by default. Nothing is written without --apply, and --apply takes
 * a full snapshot of every row it is about to touch first.
 *
 *   npx tsx scripts/investigations/fix-broken-ticket-numbers.ts
 *   npx tsx scripts/investigations/fix-broken-ticket-numbers.ts --apply
 *   npx tsx scripts/investigations/fix-broken-ticket-numbers.ts --apply --from-pnr
 *   npx tsx scripts/investigations/fix-broken-ticket-numbers.ts --restore scratch/<file>.json
 */
import 'dotenv/config';
import { Client } from 'pg';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { teamSerials } from '../../src/core/parsers/teamSheet';
import { ticketMatchKey } from '../../src/core/helpers/ticketIdentity';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const flag = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The canonical form of whatever is in the ticket column today. */
const key = (s: string) =>
  ticketMatchKey(String(s || '').toUpperCase().replace(/\s+/g, '')).replace(/[^A-Z0-9]/g, '');

type Kind = 'DOT' | 'CARRIER' | 'CONJUNCTION' | 'PNR' | 'MANUAL';

interface Row {
  id: string; ticket_no: string; al: string; pnr: string; source: string;
  req: string; amt: number; cur: string; date: string | null; st: string; pax: string;
  /** Exactly as stored, NULL included, so a restore puts back what was
   *  there rather than something that merely reads the same. */
  al_raw: string | null;
}

interface Plan {
  row: Row;
  kind: Kind;
  /** What the ticket number becomes, and the airline beside it. */
  ticketNo: string;
  airline: string;
  /** The other document on a conjunction, reported and never written. */
  alsoOnThisTicket: string[];
  why: string;
}

/** A booking reference: the document itself, for a carrier that issues no
 *  IATA ticket. Same shape the team-sheet reader accepts. */
const isReference = (s: string) =>
  /^[A-Z0-9]{5,15}$/.test(s) && /[A-Z]/.test(s) && (/\d/.test(s) || s.length === 6);

function plan(r: Row): Plan | null {
  const raw = (r.ticket_no || '').trim();
  const current = key(raw);
  const docs = teamSerials(raw);

  // Already a clean document: nothing to do.
  if (docs.length === 1 && docs[0].serial === current) return null;
  // Our own deliberate placeholders for "the vendor gave no reference".
  if (/_NOREF_/.test(raw)) return null;

  const base = { row: r, alsoOnThisTicket: [] as string[] };

  // "065-.5066646757" - a dot where nothing belongs.
  const dot = raw.match(/^(\d{3})-\.(\d{10})$/);
  if (dot) return {
    ...base, kind: 'DOT', ticketNo: dot[2], airline: r.al || dot[1],
    why: 'a stray dot between the airline code and the serial',
  };

  // "593-A7RKKF" - an airline code in front of a carrier's own reference.
  const carrier = raw.match(/^(\d{3})-([A-Z0-9]{5,15})$/i);
  if (carrier && isReference(carrier[2].toUpperCase())) return {
    ...base, kind: 'CARRIER', ticketNo: carrier[2].toUpperCase(), airline: r.al || carrier[1],
    why: 'the carrier issues no IATA ticket, so its reference is the document',
  };

  // "1763000541793-794" - one fare, two document numbers.
  if (docs.length > 1) return {
    row: r, kind: 'CONJUNCTION', ticketNo: docs[0].serial, airline: r.al || docs[0].airlineCode,
    alsoOnThisTicket: docs.slice(1).map(d => d.serial),
    why: 'one passenger and one fare across two documents; the money stays where it is',
  };

  // "-" with a usable PNR, for a carrier whose reference is its document.
  const pnr = (r.pnr || '').trim().toUpperCase();
  if (docs.length === 0 && isReference(pnr) && /flydubai|airarabia|flyadeal|flynas/i.test(r.source))
    return {
      ...base, kind: 'PNR', ticketNo: pnr, airline: r.al,
      why: `read from the PNR, which for ${r.source} IS the document number`,
    };

  return { ...base, kind: 'MANUAL', ticketNo: '', airline: r.al,
    why: 'no ticket number can be read from this, and none will be guessed' };
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;

  /* ── restore ────────────────────────────────────────────────────────── */
  const restore = flag('restore');
  if (restore) {
    const snap = JSON.parse(readFileSync(restore, 'utf8'));
    let back = 0;
    for (const r of snap.rows) {
      const res = await c.query(
        `update tickets set ticket_no = $2, airline_code = $3 where id = $1`,
        [r.id, r.ticket_no, r.al ?? null]);
      back += res.rowCount ?? 0;
    }
    console.log(`put ${back} of ${snap.rows.length} ticket numbers back as they were`);
    await c.end();
    return;
  }

  const rows: Row[] = await q(
    `select id, ticket_no, coalesce(airline_code,'') al, airline_code al_raw,
            coalesce(pnr,'') pnr, source, coalesce(req_num,'') req, amount::float8 amt,
            coalesce(currency,'') cur, date::text, coalesce(status,'') st,
            coalesce(passenger_name,'') pax
       from tickets where coalesce(status,'') <> 'FUND' order by date, ticket_no`);

  const plans = rows.map(plan).filter((x): x is Plan => x !== null);
  const doable = plans.filter(p => p.kind !== 'MANUAL'
    && (p.kind !== 'PNR' || has('from-pnr')));
  const manual = plans.filter(p => p.kind === 'MANUAL'
    || (p.kind === 'PNR' && !has('from-pnr')));

  /* ── a new number must not collide with a row that already exists ───── */
  const seen = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.source}|${key(r.ticket_no)}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k)!.push(r);
  }
  const collisions = doable.filter(p =>
    (seen.get(`${p.row.source}|${p.ticketNo}`) ?? []).some(x => x.id !== p.row.id));
  const safe = doable.filter(p => !collisions.includes(p));

  /* ── say what it found ──────────────────────────────────────────────── */
  console.log('='.repeat(94));
  console.log(`TICKET NUMBERS THAT MATCH NOTHING — ${has('apply') ? 'APPLYING' : 'DRY RUN'}`);
  console.log('='.repeat(94));
  console.log(`   rows in the ledger        ${String(rows.length).padStart(6)}`);
  console.log(`   unreadable numbers        ${String(plans.length).padStart(6)}`);
  console.log(`   this can correct          ${String(safe.length).padStart(6)}`);
  console.log(`   left for a person         ${String(manual.length).padStart(6)}`);
  if (collisions.length)
    console.log(`   REFUSED, would collide    ${String(collisions.length).padStart(6)}`);

  for (const kind of ['DOT', 'CARRIER', 'CONJUNCTION', 'PNR'] as Kind[]) {
    const group = safe.filter(p => p.kind === kind);
    if (!group.length) continue;
    console.log(`\n${kind} — ${group.length} row(s): ${group[0].why}`);
    for (const p of group) {
      // The two stored fields, not a joined display form: on a carrier row
      // the joined form is unchanged and it would read as doing nothing.
      const before = `"${p.row.ticket_no}" al="${p.row.al}"`;
      const after = `"${p.ticketNo}" al="${p.airline}"`;
      console.log(`   ${p.row.date}  ${p.row.source.padEnd(10)} ${before.padEnd(34)} -> ${after.padEnd(28)}`
        + ` ${m(p.row.amt).padStart(11)} ${p.row.cur}  req ${p.row.req}  ${p.row.pax}`);
      for (const also of p.alsoOnThisTicket)
        console.log(`        (the same fare also names document ${also}, which stays unrecorded)`);
    }
  }

  if (collisions.length) {
    console.log(`\nREFUSED — the corrected number already exists on another row:`);
    for (const p of collisions)
      console.log(`   ${String(p.row.ticket_no).padEnd(22)} -> ${p.ticketNo}`
        + `   already: ${(seen.get(`${p.row.source}|${p.ticketNo}`) ?? [])
            .filter(x => x.id !== p.row.id).map(x => `${x.date}/${m(x.amt)} ${x.cur}`).join(' ; ')}`);
  }

  if (manual.length) {
    console.log(`\nLEFT ALONE — nothing here says what the number should be:`);
    for (const p of manual)
      console.log(`   ${p.row.date}  ${p.row.source.padEnd(10)} "${p.row.ticket_no}"`.padEnd(48)
        + ` ${m(p.row.amt).padStart(11)} ${p.row.cur}  pnr ${p.row.pnr.padEnd(8)} req ${p.row.req}`
        + `  ${p.row.pax}`
        + (p.kind === 'PNR' ? `
        --from-pnr would set it to "${p.ticketNo}"` : ''));
    if (!has('from-pnr') && plans.some(p => p.kind === 'PNR'))
      console.log(`\n   (--from-pnr would take the PNR as the number on the`
        + ` ${plans.filter(p => p.kind === 'PNR').length} carrier row(s) above)`);
  }

  const money = safe.reduce((s, p) => s + Math.abs(p.row.amt), 0);
  console.log(`\n   ${safe.length} rows, ${m(money)} of value, become matchable.`);

  if (!safe.length) { await c.end(); return; }
  if (!has('apply')) {
    console.log('\nDry run. Nothing was written. Add --apply to correct them.');
    await c.end();
    return;
  }

  /* ── snapshot, then write ───────────────────────────────────────────── */
  mkdirSync('scratch', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `scratch/ticket-numbers-before-${stamp}.json`;
  writeFileSync(file, JSON.stringify({
    takenAt: new Date().toISOString(),
    rows: safe.map(p => ({ id: p.row.id, ticket_no: p.row.ticket_no, al: p.row.al_raw })),
  }, null, 2));
  console.log(`\n   snapshot  ${file}`);

  let done = 0;
  for (const p of safe) {
    const res = await c.query(
      `update tickets set ticket_no = $2, airline_code = $3 where id = $1`,
      [p.row.id, p.ticketNo, p.airline || null]);
    done += res.rowCount ?? 0;
  }
  console.log(`   corrected ${done} row(s). The database's own trigger has recorded each one.`);
  console.log(`\nTo undo: npx tsx scripts/investigations/fix-broken-ticket-numbers.ts --restore ${file}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
