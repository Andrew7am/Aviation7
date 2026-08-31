/**
 * Run a vendor report through the parsers and print what comes out, without
 * touching the database. Useful for a new export before trusting an import:
 *
 *   npx tsx scripts/try-report.ts "path/to/report.csv"
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { smartDetect, runParser } from '../src/core/parsers';

const file = process.argv[2];
const csv = readFileSync(file, 'utf8');
const grid = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;

const d = smartDetect(grid);
console.log('parser:', d.parser?.name, `(${d.parser?.id})`, 'confidence:', d.confidence);
console.log('header row:', d.headerRowIdx, '| missing cols:', d.missingCols.join(', ') || 'none');

const res = runParser(grid, 'AED');
console.log(`\nrows parsed: ${res.rows.length}`);
console.log(`errors: ${res.errors.length}`);
res.errors.forEach(e => console.log('   ERR', e));
console.log(`warnings: ${res.warnings.length}`);
res.warnings.forEach(w => console.log('   WARN', w));

console.table(res.rows.map((r: any) => ({
  ticket: r.ticketNo, 'A/L': r.airlineCode, date: r.date,
  payable: r.amount, gross: r.totalDoc, comm: r.commission,
  route: r.route, pax: (r.passengerName || '').slice(0, 22), pnr: r.pnr,
  cur: r.currency, status: r.status,
})));

const sum = (f: (r: any) => number) => res.rows.reduce((s, r) => s + f(r), 0);
console.log('\ntotals');
console.table([{
  rows: res.rows.length,
  gross: sum(r => r.totalDoc).toFixed(2),
  commission: sum(r => r.commission).toFixed(2),
  payable: sum(r => r.amount).toFixed(2),
  'gross - commission': (sum(r => r.totalDoc) - sum(r => r.commission)).toFixed(2),
}]);
