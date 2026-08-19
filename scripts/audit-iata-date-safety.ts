/**
 * PHASE 3 FINAL SAFETY AUDIT — read-only, run BEFORE any --apply.
 *
 * Recomputes the proposed date corrections from scratch rather than trusting
 * the preview, then tries to break them:
 *   - can one matching key hit more than one ledger row? (ambiguity)
 *   - can one key hit invoice rows carrying DIFFERENT dates? (source conflict)
 *   - is every invoice date real and parseable?
 *   - does the update statement carry the IATA constraint?
 *   - would anything other than `date` change?
 *
 * Emits a rollback snapshot of every proposed change.
 *
 * STRICTLY READ-ONLY: SELECT only, plus writing the snapshot file to disk.
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { inflateSync } from 'zlib';
import path from 'path';
import { Client } from 'pg';

const IATA_VENDOR = 'IATA BSP';
const DIR = process.argv[2];
const SNAPSHOT = process.argv[3] ?? 'iata-date-snapshot.json';

/* ── invoice reading (independent of the correction script) ─────────────── */
const ESC: Record<string, string> = { n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', '(':'(', ')':')', '\\':'\\' };
const unesc = (t: string) => t
  .replace(/\\([nrtbf()\\])/g, (_, c) => ESC[c])
  .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

function pdfLines(file: string): string[] {
  const buf = readFileSync(file);
  const s = buf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let c: string;
    try { c = inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { continue; }
    if (!/\bTj\b|\bTJ\b/.test(c)) continue;
    let x = 0, y = 0;
    const runs: { x: number; y: number; t: string }[] = [];
    for (const line of c.split(/\r?\n/)) {
      const tm = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+Tm/);
      if (tm) { x = parseFloat(tm[5]); y = parseFloat(tm[6]); }
      else { const td = line.match(/^([\d.eE+-]+)\s+([\d.eE+-]+)\s+Td/); if (td) { x += parseFloat(td[1]); y += parseFloat(td[2]); } }
      for (const t of line.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) runs.push({ x, y, t: unesc(t[1]) });
      const TJ = line.match(/\[(.*)\]\s*TJ/);
      if (TJ) { const j = [...TJ[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(p => unesc(p[1])).join(''); if (j) runs.push({ x, y, t: j }); }
    }
    const byY = new Map<number, typeof runs>();
    for (const r of runs) { const k = Math.round(r.y * 2) / 2; const b = byY.get(k); if (b) b.push(r); else byY.set(k, [r]); }
    for (const [, arr] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
      out.push(arr.sort((a, b) => a.x - b.x).map(r => r.t).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

const MONTHS: Record<string, string> = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
const bspDate = (d: string) => {
  const m = d.toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  return m && MONTHS[m[2]] ? `20${m[3]}-${MONTHS[m[2]]}-${m[1]}` : '';
};
const MONEY = /-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}/g;
const TXN = /^(\d{3})\s+([A-Z]{3,5})\s+(\d{8,})\s+(\d{2}[A-Z]{3}\d{2})\b(.*)$/i;
const REFUNDY = new Set(['RFND', 'RFNC']);
const normDoc = (d: string) => d.replace(/[^0-9]/g, '').replace(/^0+/, '');
const dirOf = (trnc: string, payable: number) => (REFUNDY.has(trnc) || payable < 0 ? '-' : '+');

interface Inv { doc: string; trnc: string; date: string; channel: string; fare: number; payable: number; file: string }

/** A real calendar date, not merely a well-shaped string. */
function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const H = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  if (!DIR || !existsSync(DIR)) { console.log('usage: tsx scripts/audit-iata-date-safety.ts <invoice-dir> [snapshot.json]'); process.exit(1); }

  const files = readdirSync(DIR).filter(f => /FCAGBILLDET.*\.pdf$/i.test(f)).sort();
  const invoice: Inv[] = [];
  for (const f of files) {
    let channel = 'BSP';
    for (const line of pdfLines(path.join(DIR, f))) {
      const cat = line.match(/^CATEGORY\s+([A-Z][A-Z0-9\-\s]*?)\s*$/i);
      if (cat) { channel = cat[1].trim().toUpperCase(); continue; }
      const m = line.match(TXN);
      if (!m) continue;
      const nums = (m[5].match(MONEY) || []).map(v => parseFloat(v.replace(/,/g, '')));
      const fare = nums.length ? Math.round(nums[0] * 100) / 100 : 0;
      const payable = nums.length ? Math.round(nums[nums.length - 1] * 100) / 100 : 0;
      invoice.push({ doc: m[3], trnc: m[2].toUpperCase(), date: bspDate(m[4]), channel, fare, payable, file: f });
    }
  }

  H('3. DATE SOURCE VALIDATION — invoice side');
  const badDates = invoice.filter(t => !isValidDate(t.date));
  console.log(`  invoice transactions        : ${invoice.length}`);
  console.log(`  with a valid calendar date  : ${invoice.length - badDates.length}`);
  console.log(`  INVALID / EMPTY dates       : ${badDates.length}`);
  for (const b of badDates.slice(0, 10)) console.log(`     ${b.trnc} ${b.doc} in ${b.file} -> "${b.date}"`);

  // Group invoice rows by matching key, keeping every date seen for that key.
  const invByKey = new Map<string, Inv[]>();
  for (const t of invoice) {
    if (!isValidDate(t.date)) continue;
    const k = `${normDoc(t.doc)}|${dirOf(t.trnc, t.payable)}`;
    const b = invByKey.get(k); if (b) b.push(t); else invByKey.set(k, [t]);
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  H('7. IATA BASELINE (before any write)');
  const { rows: ib } = await c.query(`
    select count(*)::int as n,
           coalesce(sum(total_doc),0)::float8 as fare,
           coalesce(sum(commission),0)::float8 as comm,
           coalesce(sum(amount),0)::float8 as payable,
           count(*) filter (where date = '' or date is null)::int as blank_date,
           count(distinct date)::int as distinct_dates
    from tickets where source = $1`, [IATA_VENDOR]);
  console.log(`  transactions      : ${ib[0].n}`);
  console.log(`  total fare        : ${money(ib[0].fare)}`);
  console.log(`  total commission  : ${money(ib[0].comm)}`);
  console.log(`  total payable     : ${money(ib[0].payable)}`);
  console.log(`  blank dates       : ${ib[0].blank_date}`);
  console.log(`  distinct dates    : ${ib[0].distinct_dates}`);
  const { rows: cur } = await c.query(`select coalesce(currency,'(null)') as k, count(*)::int as n from tickets where source=$1 group by 1 order by 2 desc`, [IATA_VENDOR]);
  console.log(`  currency          : ${cur.map((r: any) => `${r.k}=${r.n}`).join(', ')}`);
  const { rows: st } = await c.query(`select coalesce(status,'(null)') as k, count(*)::int as n from tickets where source=$1 group by 1 order by 2 desc`, [IATA_VENDOR]);
  console.log(`  status            : ${st.map((r: any) => `${r.k}=${r.n}`).join(', ')}`);
  const { rows: ch } = await c.query(`select coalesce(channel,'(null)') as k, count(*)::int as n from tickets where source=$1 group by 1 order by 2 desc`, [IATA_VENDOR]);
  console.log(`  channel           : ${ch.map((r: any) => `${r.k}=${r.n}`).join(', ')}`);

  H('6. NON-IATA BASELINE');
  const { rows: nonIata } = await c.query(`
    select source, count(*)::int as n, coalesce(sum(amount),0)::float8 as net,
           coalesce(sum(commission),0)::float8 as comm,
           count(*) filter (where date <> '' and date is not null)::int as dated
    from tickets where source <> $1 group by source order by source`, [IATA_VENDOR]);
  console.log('  vendor              rows        net          commission   dated');
  for (const v of nonIata) {
    console.log(`  ${String(v.source).padEnd(18)} ${String(v.n).padStart(5)}  ${money(v.net).padStart(14)}  ${money(v.comm).padStart(10)}  ${String(v.dated).padStart(5)}`);
  }
  const { rows: wallets } = await c.query(`select vendor_name, initial_balance::float8 as ib, current_balance::float8 as cb from vendor_balances order by vendor_name`);
  console.log('\n  wallets:');
  for (const w of wallets) console.log(`  ${String(w.vendor_name).padEnd(18)} initial=${money(w.ib).padStart(14)} current=${money(w.cb).padStart(14)}`);

  /* ── 1 & 2: build proposals and hunt for ambiguity ────────────────────── */
  const { rows: iata } = await c.query(
    `select id, ticket_no, status, date, amount::float8 as amount,
            total_doc::float8 as total_doc, commission::float8 as commission,
            import_time::date::text as uploaded, channel
     from tickets where source = $1 order by ticket_no`, [IATA_VENDOR]);

  // Group LEDGER rows by the same key the correction uses.
  const dbByKey = new Map<string, typeof iata>();
  for (const t of iata) {
    const k = `${normDoc(t.ticket_no)}|${t.amount < 0 ? '-' : '+'}`;
    const b = dbByKey.get(k); if (b) b.push(t); else dbByKey.set(k, [t]);
  }

  H('1 & 2. MATCH VALIDATION AND AMBIGUITY');
  // A key covering more than one ledger row is only a PROBLEM if the money
  // cannot single out which invoice line belongs to which row. Resolve it the
  // same way the correction must, and re-derive it here independently.
  const near = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.011;
  const resolve = (t: any, inv: Inv[], siblings: any[]): Inv[] => {
    let cand = inv.filter(i => near(i.fare, t.total_doc));
    if (cand.length === 0) cand = inv.filter(i => near(i.payable, t.amount));
    if (cand.length === 0) return [];
    const claimants = siblings.filter(o => near(cand[0].fare, o.total_doc) || near(cand[0].payable, o.amount));
    return claimants.length > 1 ? [] : cand;
  };

  const sharedKeys: { key: string; rows: any[] }[] = [];
  const ambiguousLedger: { key: string; rows: any[] }[] = [];
  for (const [k, rows] of dbByKey) {
    if (rows.length <= 1 || !invByKey.has(k)) continue;
    sharedKeys.push({ key: k, rows });
    const inv = invByKey.get(k)!;
    // Ambiguous only if a row that DOES get a proposal cannot be singled out.
    if (rows.some(r => resolve(r, inv, rows).length > 1)) ambiguousLedger.push({ key: k, rows });
  }

  const conflictingInvoice: { key: string; dates: string[] }[] = [];
  for (const [k, rows] of invByKey) {
    const dates = [...new Set(rows.map(r => r.date))];
    if (dates.length > 1 && dbByKey.has(k)) conflictingInvoice.push({ key: k, dates: dates.sort() });
  }

  console.log(`  ledger keys shared by MORE THAN ONE IATA row : ${sharedKeys.length}`);
  for (const a of sharedKeys.slice(0, 15)) {
    const inv = invByKey.get(a.key)!;
    console.log(`     key ${a.key} -> ${a.rows.length} ledger rows, ${inv.length} invoice line(s):`);
    for (const r of a.rows) {
      const res = resolve(r, inv, a.rows);
      const verdict = res.length === 1 ? `resolved by money -> ${res[0].date}`
                    : res.length === 0 ? 'no invoice line matches its money — LEFT UNTOUCHED'
                    : 'AMBIGUOUS';
      console.log(`        id=${r.id.slice(0, 8)}… ${String(r.status).padEnd(6)} fare=${money(r.total_doc).padStart(10)} payable=${money(r.amount).padStart(10)} date="${r.date}"  ${verdict}`);
    }
    for (const i of inv) console.log(`        invoice ${i.trnc} fare=${money(i.fare).padStart(10)} payable=${money(i.payable).padStart(10)} date=${i.date}`);
  }
  if (sharedKeys.length > 15) console.log(`     ... +${sharedKeys.length - 15} more`);
  console.log(`  of those, UNRESOLVABLE (true ambiguity)      : ${ambiguousLedger.length}`);

  console.log(`\n  keys where the INVOICE offers conflicting dates : ${conflictingInvoice.length}`);
  for (const cf of conflictingInvoice.slice(0, 15)) {
    console.log(`     key ${cf.key} -> dates ${cf.dates.join(', ')}  (earliest would be chosen)`);
  }
  if (conflictingInvoice.length > 15) console.log(`     ... +${conflictingInvoice.length - 15} more`);

  // Same document appearing under both directions — expected and safe.
  const bothDirections = new Set<string>();
  for (const k of dbByKey.keys()) {
    const doc = k.split('|')[0];
    if (dbByKey.has(`${doc}|+`) && dbByKey.has(`${doc}|-`)) bothDirections.add(doc);
  }
  console.log(`\n  documents present as BOTH an issue and a refund : ${bothDirections.size}`);
  console.log('     (expected — direction is part of the key, so they never collide)');

  /* ── 10: independent proposal count ───────────────────────────────────── */
  H('10. INDEPENDENT DRY-RUN COUNT');
  const proposals: any[] = [];
  let alreadyCorrect = 0, noInvoice = 0, leftUntouched = 0;
  const earliest = (rows: Inv[]) => rows.reduce((a, b) => (a.date <= b.date ? a : b));
  const propose = (t: any, chosen: Inv) => {
    if (t.date === chosen.date) { alreadyCorrect++; return; }
    proposals.push({
      id: t.id, vendor: IATA_VENDOR, ticketNo: t.ticket_no, type: chosen.trnc,
      status: t.status, direction: t.amount < 0 ? '-' : '+',
      currentDate: t.date || null, invoiceDate: chosen.date,
      currentIsUploadDate: t.date === t.uploaded,
      invoiceFile: chosen.file, channel: chosen.channel,
      amount: t.amount, totalDoc: t.total_doc, commission: t.commission,
    });
  };
  for (const [k, rows] of dbByKey) {
    const inv = invByKey.get(k);
    if (!inv) { noInvoice += rows.length; continue; }
    if (rows.length === 1) { propose(rows[0], earliest(inv)); continue; }
    for (const t of rows) {
      const res = resolve(t, inv, rows);
      if (res.length !== 1) { leftUntouched++; continue; }
      propose(t, earliest(res));
    }
  }
  const invalidInvoiceDates = proposals.filter(p => !isValidDate(p.invoiceDate)).length;
  const nonIataTargets = proposals.filter(p => p.vendor !== IATA_VENDOR).length;

  const uniqueIds = new Set(proposals.map(p => p.id)).size;
  console.log(`  Proposed updates        : ${proposals.length}`);
  console.log(`  Unique matches          : ${uniqueIds}   (distinct ledger ids in the proposal list)`);
  console.log(`  Ambiguous matches       : ${ambiguousLedger.length}`);
  console.log(`  Invalid invoice dates   : ${invalidInvoiceDates}`);
  console.log(`  Already correct         : ${alreadyCorrect}`);
  console.log(`  Shared key, left untouched: ${leftUntouched}   (money matches no invoice line)`);
  console.log(`  IATA rows with no invoice: ${noInvoice}`);
  console.log(`  Non-IATA rows targeted  : ${nonIataTargets}`);
  console.log(`  --------------------------------`);
  console.log(`  accounted for           : ${proposals.length + alreadyCorrect + leftUntouched + noInvoice} of ${iata.length} IATA ledger rows`);

  H('3. DATE SOURCE VALIDATION — what each proposal replaces');
  const fromUpload = proposals.filter(p => p.currentIsUploadDate).length;
  const fromBlank = proposals.filter(p => !p.currentDate).length;
  const fromOther = proposals.length - fromUpload - fromBlank;
  console.log(`  current date = upload date : ${fromUpload}`);
  console.log(`  current date = blank       : ${fromBlank}`);
  console.log(`  current date = some other  : ${fromOther}`);
  console.log(`  all replaced by the BSP invoice transaction date.`);

  H('8 & 9. WHAT WILL NOT BE TOUCHED');
  const missingFromSystem = [...invByKey.keys()].filter(k => !dbByKey.has(k)).length;
  console.log(`  invoice transactions absent from the ledger : ${missingFromSystem}`);
  console.log(`     -> the correction only runs UPDATE over existing IATA rows; it issues no INSERT.`);
  console.log(`  IATA rows with no matching invoice          : ${noInvoice}`);
  console.log(`     -> never appear in the proposal list, so their dates are left exactly as they are.`);
  console.log(`  IATA rows on a shared key that money cannot single out : ${leftUntouched}`);
  console.log(`     -> also excluded from the proposal list; no date is guessed for them.`);

  /* ── 4 & 5: prove the statement is date-only and IATA-scoped ──────────── */
  H('4 & 5. STATEMENT SAFETY (read from the script source)');
  const src = readFileSync('scripts/iata-date-correction.ts', 'utf8');
  const updates = [...src.matchAll(/update\s+tickets\s+set\s+([^`]+?)where([^`]+)/gis)].map(m => ({ set: m[1].trim(), where: m[2].trim() }));
  const inserts = /insert\s+into\s+tickets/i.test(src);
  const deletes = /delete\s+from\s+tickets/i.test(src);
  const walletWrite = /update\s+vendor_balances|insert\s+into\s+vendor_balances|delete\s+from\s+vendor_balances/i.test(src);
  console.log(`  UPDATE statements found : ${updates.length}`);
  for (const u of updates) {
    console.log(`     SET   : ${u.set.replace(/\s+/g, ' ')}`);
    console.log(`     WHERE : ${u.where.replace(/\s+/g, ' ')}`);
    const setsOnlyDate = /^date\s*=\s*\$1\s*$/i.test(u.set.replace(/\s+/g, ' ').trim());
    const scoped = /source\s*=\s*\$3/.test(u.where) && /id\s*=\s*\$2/.test(u.where);
    console.log(`     sets ONLY the date column : ${setsOnlyDate ? 'YES' : 'NO  <-- PROBLEM'}`);
    console.log(`     constrained by id AND source : ${scoped ? 'YES' : 'NO  <-- PROBLEM'}`);
  }
  console.log(`  INSERT into tickets     : ${inserts ? 'PRESENT <-- PROBLEM' : 'none'}`);
  console.log(`  DELETE from tickets     : ${deletes ? 'PRESENT <-- PROBLEM' : 'none'}`);
  console.log(`  any wallet write        : ${walletWrite ? 'PRESENT <-- PROBLEM' : 'none'}`);

  /* ── 11: snapshot ─────────────────────────────────────────────────────── */
  H('11. ROLLBACK SNAPSHOT');
  const snap = {
    generatedAt: new Date().toISOString(),
    vendor: IATA_VENDOR,
    invoiceDir: DIR,
    invoiceFiles: files.length,
    proposedUpdates: proposals.length,
    iataBaseline: ib[0],
    nonIataBaseline: nonIata,
    wallets,
    records: proposals.map(p => ({
      id: p.id, vendor: p.vendor, documentNumber: p.ticketNo, type: p.type,
      status: p.status, direction: p.direction, channel: p.channel,
      currentDate: p.currentDate, proposedDate: p.invoiceDate, invoiceFile: p.invoiceFile,
    })),
  };
  writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2), 'utf8');
  console.log(`  written: ${path.resolve(SNAPSHOT)}`);
  console.log(`  records: ${snap.records.length}  (id, vendor, document, type, current date, proposed date)`);

  /* ── verdict ──────────────────────────────────────────────────────────── */
  H('SAFETY VERDICT');
  const blockers: string[] = [];
  if (ambiguousLedger.length > 0) blockers.push(`${ambiguousLedger.length} ambiguous ledger match(es)`);
  if (uniqueIds !== proposals.length) blockers.push(`a ledger row appears twice in the proposal list (${proposals.length} proposals, ${uniqueIds} distinct ids)`);
  if (invalidInvoiceDates > 0) blockers.push(`${invalidInvoiceDates} invalid invoice date(s)`);
  if (nonIataTargets > 0) blockers.push(`${nonIataTargets} proposal(s) target a non-IATA row`);
  if (inserts || deletes || walletWrite) blockers.push('the script contains an INSERT/DELETE/wallet write');
  if (updates.length !== 1) blockers.push(`expected exactly 1 UPDATE statement, found ${updates.length}`);

  if (blockers.length === 0) {
    console.log('  ALL CHECKS PASSED — safe to apply.');
  } else {
    console.log('  DO NOT APPLY. Blockers:');
    for (const b of blockers) console.log(`     - ${b}`);
  }
  console.log(`\n  proposed updates: ${proposals.length}`);
  console.log('\n  DATABASE WRITES DURING THIS AUDIT: 0 (SELECT only; snapshot written to disk)');
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
