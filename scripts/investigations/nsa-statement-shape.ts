/**
 * What NSA's own statement rows actually say, before anything is built on them.
 *
 * nsa_rows holds their Ticketwise statement as imported: a date, a document
 * number, a debit or a credit, and a running outstanding balance. If that
 * running balance is trustworthy then the opening and closing figures for any
 * period can be read straight off it rather than derived - which is the whole
 * point, because a derived balance is our arithmetic and a stated one is
 * theirs.
 *
 * So: does the column walk? Does row n's balance equal row n-1's plus its own
 * movement? Where it does not, by how much, and is the break a gap in the data
 * or a change of sign convention.
 *
 *   npx tsx scripts/investigations/nsa-statement-shape.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const m = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
/** The import writes dates as ISO timestamps or as dd/mm/yyyy; take both. */
const iso = (v: unknown) => {
  const s = String(v ?? '').trim();
  let mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (mm) return mm[0];
  mm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return mm ? `${mm[3]}-${mm[2]}-${mm[1]}` : '';
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows } = await c.query(
    `select r.source_row_num n, r.date, r.doc_no, r.description, r.request_number req,
            r.debit_sar debit, r.credit_sar credit, r.c_0utstanding_balances balance,
            r.reason_for_pending reason, r.col_13 status, i.source_file
       from nsa_rows r
       left join vendor_imports i on i.id = r.vendor_import_id
      order by r.source_row_num`);

  console.log(`nsa_rows: ${rows.length}`);
  console.log(`files: ${[...new Set(rows.map((r: any) => r.source_file))].join(', ')}\n`);

  const dated = rows.filter((r: any) => iso(r.date));
  const ds = dated.map((r: any) => iso(r.date)).sort();
  console.log(`rows with a date        : ${dated.length}  ${ds[0]} -> ${ds[ds.length - 1]}`);
  console.log(`rows with no date       : ${rows.length - dated.length}`);
  console.log(`rows with a balance     : ${rows.filter((r: any) => String(r.balance ?? '').trim()).length}`);

  const debits = rows.filter((r: any) => num(r.debit) !== 0);
  const credits = rows.filter((r: any) => num(r.credit) !== 0);
  console.log(`\ndebits  : ${debits.length}, ${m(debits.reduce((n: number, r: any) => n + num(r.debit), 0))}`);
  console.log(`credits : ${credits.length}, ${m(credits.reduce((n: number, r: any) => n + num(r.credit), 0))}`);

  // What the credits are. A deposit we paid and a refund they credited are
  // both credits on their statement and are not the same thing to us.
  const kinds = new Map<string, { n: number; v: number }>();
  for (const r of credits as any[]) {
    const k = (String(r.reason ?? '').trim() || String(r.description ?? '').trim().slice(0, 24) || '(nothing said)').toUpperCase();
    const e = kinds.get(k) ?? { n: 0, v: 0 };
    e.n++; e.v += num(r.credit);
    kinds.set(k, e);
  }
  console.log('\nwhat the credits are, by what the row says about itself:');
  console.table([...kinds.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 12)
    .map(([k, v]) => ({ reason: k.slice(0, 40), rows: v.n, total: m(v.v) })));

  // Does the running balance walk?
  let prev: number | null = null;
  let breaks = 0, checked = 0;
  const worst: any[] = [];
  for (const r of rows as any[]) {
    const bal = String(r.balance ?? '').trim() ? num(r.balance) : null;
    if (bal === null) { continue; }
    if (prev !== null) {
      checked++;
      const move = num(r.debit) - num(r.credit);
      const drift = Math.round((bal - (prev + move)) * 100) / 100;
      if (Math.abs(drift) > 0.011) {
        breaks++;
        if (worst.length < 8) worst.push({
          row: r.n, date: iso(r.date) || '(none)', doc: r.doc_no,
          debit: m(num(r.debit)), credit: m(num(r.credit)),
          expected: m(prev + move), stated: m(bal), drift: m(drift),
        });
      }
    }
    prev = bal;
  }
  console.log(`\nrunning balance checked over ${checked} step(s): ${breaks} break(s)`);
  if (worst.length) console.table(worst);
  console.log(`\nfirst balance : ${m(num((rows as any[])[0].balance))}`);
  console.log(`last balance  : ${m(num((rows as any[])[rows.length - 1].balance))}`);
  console.log(`\nfirst three rows:`);
  console.table((rows as any[]).slice(0, 3).map(r => ({
    n: r.n, date: iso(r.date) || '-', doc: r.doc_no, desc: String(r.description ?? '').slice(0, 20),
    debit: r.debit, credit: r.credit, balance: r.balance, reason: r.reason })));

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
