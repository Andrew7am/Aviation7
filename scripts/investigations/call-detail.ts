import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseIbtekarInvoicePdf, PdfWord } from '../../src/core/parsers/ibtekarInvoicePdf';
const DIR = process.argv[2];
const WANT = new Set(['4860933015','6906436440','6906478163','6906536994','6906536996','6906537010','6906087276','6906136425','4861438255']);
const files = readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8'))).sort((a, b) => a.mtime - b.mtime);
const out: any[] = [];
for (const f of files) for (const inv of parseIbtekarInvoicePdf(f.words as PdfWord[]))
  for (const l of inv.lines) if (WANT.has(l.ticketNo))
    out.push({ invoice: inv.invoice, ticket: l.ticketNo, net: l.amount,
               sector: l.sector, passenger: l.passenger.slice(0, 24), file: f.file.slice(0, 30) });
console.table(out);
const priced = out.filter(o => (o.net ?? 0) > 0);
console.log(`lines billed at zero: ${out.length - priced.length}, priced: ${priced.length}`);
console.log(`value of the priced ones: ${priced.reduce((n, o) => n + o.net, 0).toFixed(2)}`);
