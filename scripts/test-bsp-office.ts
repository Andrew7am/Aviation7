/**
 * Which vendor a BSP sales report belongs to.
 *
 * The agency pulls the same TJQ report from two offices. The columns are
 * identical, so the only thing separating an NSA file from an IATA one is the
 * office printed in the header block — and getting it wrong files riyals as
 * dirhams against the wrong wallet.
 *
 * The two preambles here are the real ones, copied from the reports.
 *
 * Run: npx tsx scripts/test-bsp-office.ts
 */
import { sourceForOffice } from '../src/core/config/bspOffices';
import { readReportPeriod } from '../src/core/helpers/reportPeriod';
import { IATAParser } from '../src/core/parsers/IATAParser';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

const RIYADH = [
  ['Agy no', '71220763', '', 'Report date range', '01SEP-06SEP', '', 'Currency', 'SAR'],
  ['Office', 'RUHS228ZG'],
  ['Agent', 'TVC0171LX', '', 'Current date', '06-SEP-2026', '', 'Selection', ''],
  [],
];
const DUBAI = [
  ['Agy no', '86219136', '', 'Report date range', '31AUG', '', 'Currency', 'AED'],
  ['Office', 'DXBAD32AQ'],
  ['Agent', 'ALL', '', 'Current date', '01-SEP-2026', '', 'Selection', ''],
  [],
];
const HEADERS = ['SEQ NO', 'CONFIRMED', 'A/L', 'DOC NUMBER', 'TOTAL DOC', 'TAX', 'FEE',
                 'COMM', 'AGENT', 'FP', 'PAX NAME', 'AS', 'RLOC', 'TRNC', 'REPORT IND', 'NDC'];
const ROW = ['000001', '*', '176', '4861731806', '3613.00', '1371.00', '0.00', '0.00',
             '0.00', 'CA', 'ALHAZMI/AHMAD', '0171LX', '92NQEV', 'TKTT', '', 'No'];

console.log('\n1. The office maps to the vendor that owns it');
check('Riyadh is NSA', sourceForOffice('RUHS228ZG'), 'NSA');
check('lowercase', sourceForOffice('ruhs228zg'), 'NSA');
check('padded', sourceForOffice('  RUHS228ZG '), 'NSA');

console.log('\n2. Dubai is left alone — it is the parser\'s own default, and');
console.log('   claiming it here would stop the import screen re-attributing it');
check('Dubai routes nowhere', sourceForOffice('DXBAD32AQ'), '');
check('an office we do not know', sourceForOffice('JEDX999'), '');
check('no office at all', sourceForOffice(''), '');
check('undefined', sourceForOffice(undefined), '');

console.log('\n3. The office is read out of the report preamble');
check('Riyadh', readReportPeriod(RIYADH).office, 'RUHS228ZG');
check('Dubai', readReportPeriod(DUBAI).office, 'DXBAD32AQ');
check('and the currency still is', readReportPeriod(RIYADH).currency, 'SAR');
check('and the date range still is', readReportPeriod(RIYADH).from, '2026-09-01');

console.log('\n4. A Riyadh report is filed against NSA, in riyals');
{
  const r = IATAParser.parse([ROW], HEADERS, 'SAR', undefined, RIYADH);
  check('one row parsed', r.rows.length, 1);
  check('source is NSA', r.rows[0].source, 'NSA');
  check('currency is SAR', r.rows[0].currency, 'SAR');
  check('ticket number', r.rows[0].ticketNo, '4861731806');
  check('airline from the A/L column', r.rows[0].airlineCode, '176');
  check('it says so out loud',
        r.warnings.some(w => w.includes('RUHS228ZG') && w.includes('NSA')), true);
}

console.log('\n5. The same report from Dubai is untouched — no source of its own,');
console.log('   so the import screen still decides, exactly as before');
{
  const r = IATAParser.parse([ROW], HEADERS, 'SAR', undefined, DUBAI);
  check('one row parsed', r.rows.length, 1);
  check('no source forced', r.rows[0].source, undefined);
  check('currency from the report', r.rows[0].currency, 'AED');
}

console.log('\n6. A Riyadh file cannot be talked out of being NSA\'s');
// The per-row source is the one thing the import screen cannot override, which
// is the point: the file knows where it came from, a tired operator may not.
{
  const r = IATAParser.parse([ROW], HEADERS, 'AED', 'IATA', RIYADH);
  check('still NSA', r.rows[0].source, 'NSA');
  check('still SAR', r.rows[0].currency, 'SAR');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
