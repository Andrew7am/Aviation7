/**
 * Their Airtable's CSV export standing in for the API: each row matched to
 * the record we hold.
 */
import { matchExport, fromSheetTime, rowFromSheet } from '../src/core/integrations/airtableCsv';
import { SHEET_HEADERS } from '../src/core/integrations/airtable';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const sheet = (o: Record<string, string>) => Object.fromEntries(SHEET_HEADERS.map(h => [h, o[h] ?? ''])) as Record<string, string>;
const REQ = 'REQ No (Auto) (MICE) (from Aviation Quotations)';
const base = (t: string, pnr: string, req: string, extra: Record<string, string> = {}) =>
  sheet({ 'Ticket Number': t, PNR: pnr, Status: 'Issued', 'Net Cost': '1370.00', 'Total Cost with Currency': '1370 AED', 'Issued Date & Time': '26/10/2026 1:09am', [REQ]: req, ...extra });
const held = [
  rowFromSheet(base('065-5513727243', 'ZIF2YS', 'KSAML2771'), 'recA'),
  rowFromSheet(base('065-5513727244', 'ZIF2YS', 'KSAML2771'), 'recB'),
  rowFromSheet(base('\n2352540225961', 'TK1', 'KSAML1571'), 'recC'),
  { ...rowFromSheet(base('065-5513727245', 'ZIF2YT', 'KSAML2771', { 'Net Cost': '89.01' }), 'recD'), net_cost: 89.008 },
];

console.log('\n1. Times as their export prints them, Cairo time');
check('summer, +3', fromSheetTime('26/9/2026 12:50pm'), '2026-09-26T09:50:00.000Z');
check('winter, +2', fromSheetTime('5/3/2026 11:10pm'), '2026-03-05T21:10:00.000Z');

console.log('\n2. The whole table');
{
  const m = matchExport([
    base('065-5513727243', 'ZIF2YS', 'KSAML2771'),
    base('065-5513727244', 'ZIF2YS', 'KSAML2772'),
    base('\n2352540225961', 'TK1', 'KSAML1571'),
    base('065-5513727245', 'ZIF2YT', 'KSAML2771', { 'Net Cost': '89.01' }),
    base('065-5599999999', 'NEW123', 'KSAML2771'),
  ], held);
  const of = (id: string) => m.rows.find(r => r.record_id === id)!;
  const fresh = m.rows.find(r => r.record_id.startsWith('csv_'))!;
  check('every row its record; the new one named by its content', [m.rows.map(r => r.record_id).filter(id => id.startsWith('rec')).sort(), fresh.ticket_cell], [['recA', 'recB', 'recC', 'recD'], '065-5599999999']);
  check('a changed request is the same record with the new request', of('recB').req_num, 'KSAML2772');
  check('printed alike, the full figure is kept', of('recD').net_cost, 89.008);
  check('a ticket cell is trimmed as the live reader trims it', of('recC').ticket_cell, '2352540225961');
  check('the same row twice is the same new record', matchExport([base('065-5599999999', 'NEW123', 'KSAML2771')], held).rows[0].record_id, fresh.record_id);
}
{
  const m = matchExport([base('065-5513727243', 'ZIF2YS', 'KSAML2771'), base('065-5513727244', 'ZIF2YS', 'KSAML2771'), base('\n2352540225961', 'TK1', 'KSAML1571'), base('065-5599999998', 'NEW124', 'X1')], held);
  check('a record the whole table lacks is gone', [m.whole, m.gone.map(g => g.record_id)], [true, ['recD']]);
}

console.log('\n3. Part of it');
{
  const m = matchExport([base('065-5513727243', 'ZIF2YS', 'KSAML2771')], held);
  check('changes only what it carries, and says nothing is gone', [m.whole, m.rows.length, m.gone.length], [false, 1, 0]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
