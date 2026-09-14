/** Is the leftover VAT on an invoice carrying an international ticket a real
 *  charge, or just per-line rounding added up? */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseIbtekarInvoicePdf, PdfWord } from '../../src/core/parsers/ibtekarInvoicePdf';
const KSA = new Set(['RUH','JED','DMM','MED','AHB','ELQ','TUU','GIZ','TIF','HAS','EAM','AJF','RAH','WAE','YNB','BHH','SHW','EJH','URY','DWD','ULH','AQI','ABT','NUM','RAE','KMC','HOF','ZUL','TUI','SLF']);
const SECTOR = /^[A-Z]{3}(?:\/[A-Z]{3})+$/;
const r2 = (n: number) => Math.round(n * 100) / 100;
for (const f of readdirSync(process.argv[2]).filter(x => x.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(join(process.argv[2], f), 'utf8'));
  for (const inv of parseIbtekarInvoicePdf(d.words as PdfWord[])) {
    if (!['INV261733', 'INV263283'].includes(inv.invoice) || inv.vat === null) continue;
    let bulk = 0, perLine = 0, intl = 0;
    for (const l of inv.lines) {
      const s = (l.sector || '').toUpperCase().replace(/\s+/g, '');
      const dom = !SECTOR.test(s) || s.split('/').every(x => KSA.has(x));
      const a = l.amount ?? 0;
      if (dom) { bulk += a; perLine += r2(a * 0.15); } else intl += a;
    }
    console.log(`${inv.invoice}  lines=${inv.lines.length}  file=${d.file.slice(0, 26)}`);
    console.log(`   domestic net        ${r2(bulk).toFixed(2).padStart(12)}`);
    console.log(`   international net   ${r2(intl).toFixed(2).padStart(12)}`);
    console.log(`   VAT printed         ${inv.vat.toFixed(2).padStart(12)}`);
    console.log(`   15% of the bulk     ${r2(bulk * 0.15).toFixed(2).padStart(12)}   leftover ${r2(inv.vat - bulk * 0.15).toFixed(2)}`);
    console.log(`   15% line by line    ${r2(perLine).toFixed(2).padStart(12)}   leftover ${r2(inv.vat - perLine).toFixed(2)}`);
    console.log(`   15% of everything   ${r2((bulk + intl) * 0.15).toFixed(2).padStart(12)}   leftover ${r2(inv.vat - (bulk + intl) * 0.15).toFixed(2)}\n`);
  }
}
