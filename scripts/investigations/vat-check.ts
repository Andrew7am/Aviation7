/**
 * Does Ibtekar charge 15% on domestic sectors and nothing on international?
 *
 * Tested rather than assumed: for every invoice in the folder, split its lines
 * by whether the sector stays inside the Kingdom, and see whether the VAT it
 * printed is 15% of the domestic half alone.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseIbtekarInvoicePdf, PdfWord } from '../../src/core/parsers/ibtekarInvoicePdf';

const DIR = process.argv[2];

/** Saudi airports as they appear in these invoices' sector strings. */
const KSA = new Set([
  'RUH', 'JED', 'DMM', 'MED', 'AHB', 'ELQ', 'TUU', 'GIZ', 'TIF', 'HAS', 'EAM',
  'AJF', 'RAH', 'WAE', 'YNB', 'BHH', 'SHW', 'EJH', 'URY', 'DWD', 'ULH', 'AQI',
  'ABT', 'NUM', 'RAE', 'KMC', 'MED', 'HOF', 'ZUL', 'EJH', 'TUI', 'GIZ', 'SLF',
]);

/**
 * A sector, when the cell holds one.
 *
 * "RUH/MED/RUH" is a sector; "PENALTY FEE" is not, and splitting it on
 * non-letters leaves "FEE", which is three letters, is not a Saudi airport,
 * and was being scored as an international flight. A real sector is two or
 * more three-letter codes with slashes between them and nothing else.
 */
const SECTOR = /^[A-Z]{3}(?:\/[A-Z]{3})+$/;

/** A line is domestic when every airport on it is inside the Kingdom. */
function isDomestic(sector: string): boolean | null {
  const s = (sector || '').toUpperCase().replace(/\s+/g, '');
  if (!SECTOR.test(s)) return null;        // a fee, or nothing at all
  return s.split('/').every(x => KSA.has(x));
}

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
  .sort((a, b) => a.mtime - b.mtime);

const seen = new Map<string, any>();
for (const f of files) {
  for (const inv of parseIbtekarInvoicePdf(f.words as PdfWord[])) {
    if (!inv.lines.length || inv.vat === null || inv.subTotal === null) continue;
    // Only invoices that were read whole can say anything about the rate. On a
    // multi-page invoice the totals block can be picked off the wrong page, and
    // a VAT figure that does not belong to the lines beside it would libel the
    // vendor either way.
    const lineSum = Math.round(inv.lines.reduce((n, l) => n + (l.amount ?? 0), 0) * 100) / 100;
    const read = Math.abs(lineSum - inv.subTotal) < 0.02
              && inv.total !== null
              && Math.abs(inv.subTotal + inv.vat - inv.total) < 0.02;
    seen.set(inv.invoice, { inv, file: f.file, read });   // later file wins
  }
}

const out: any[] = [];
let domTotal = 0, intTotal = 0, otherTotal = 0, vatTotal = 0;

const unread = [...seen.values()].filter(v => !v.read);
if (unread.length) {
  console.log(`not read whole, so left out of the test: ${unread.map(v => v.inv.invoice).join(', ')}
`);
}

for (const { inv, read } of seen.values()) {
  if (!read) continue;
  let dom = 0, intl = 0, other = 0;
  for (const l of inv.lines) {
    const d = isDomestic(l.sector);
    const a = l.amount ?? 0;
    if (d === null) other += a;
    else if (d) dom += a;
    else intl += a;
  }
  // The hypothesis being tested: everything is charged at 15% EXCEPT an
  // international sector. A penalty or service fee is not transport and is
  // taxed like a domestic one.
  const expected = Math.round((dom + other) * 0.15 * 100) / 100;
  const gap = Math.round((inv.vat! - expected) * 100) / 100;
  domTotal += dom; intTotal += intl; otherTotal += other; vatTotal += inv.vat!;
  out.push({
    invoice: inv.invoice,
    lines: inv.lines.length,
    domestic: money(dom),
    international: money(intl),
    'fees etc': other ? money(other) : '',
    'VAT printed': money(inv.vat!),
    '15% of dom + fees': money(expected),
    'rate on the whole': `${((inv.vat! / inv.subTotal!) * 100).toFixed(2)}%`,
    // Several dozen lines rounded individually will not add to the piastre.
    agrees: Math.abs(gap) < 0.06 ? 'yes' : `off by ${money(gap)}`,
  });
}

console.table(out);

const all = Math.round((domTotal + intTotal + otherTotal) * 100) / 100;
console.log(`\nacross every invoice in the folder`);
console.log(`   domestic sectors      ${money(domTotal).padStart(12)}`);
console.log(`   international sectors ${money(intTotal).padStart(12)}`);
console.log(`   fees with no sector   ${money(otherTotal).padStart(12)}`);
console.log(`   net total             ${money(all).padStart(12)}`);
console.log(`   VAT printed           ${money(vatTotal).padStart(12)}`);
console.log(`   15% of domestic + fees${money((domTotal + otherTotal) * 0.15).padStart(12)}`);
console.log(`   15% of everything     ${money(all * 0.15).padStart(12)}`);
console.log(`\n   agreeing invoices: ${out.filter(o => o.agrees === 'yes').length} of ${out.length}`);
