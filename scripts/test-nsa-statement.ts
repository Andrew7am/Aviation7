/**
 * NSA's statement of account (Ticketwise), uploaded or pasted: its header
 * found under the address block, an ADM as NSA's earlier ones are recorded,
 * a sale, its refund and a receipt; the balance lines left out.
 */
import { readFileSync } from 'fs';
import { parseGrid } from '../src/core/helpers/parseGrid';
import { runParser } from '../src/core/parsers/index';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const T = '\t';
const head = ['STATEMENT OF ACCOUNT', '', `Client:${T}Luxury travel${T}${T}VAT Reg No${T}3.1015E+14`, `Currency${T}SAR`,
  `From${T}26/10/2026${T}${T}To${T}31/10/2026`, `File No${T}${T}${T}${T}${T}${T}Reference`, `VAT Reg No${T}3.11739E+14`, '',
  ['Date', 'File No', 'Doc No', 'Ticket', 'PNR', 'Issue Date', 'LPO No', 'Passenger', 'Sector', 'Debit', 'Credit', 'Balance', 'Narration',
    'Travel Date', 'Return Date', 'Class', 'Matched Date', 'Payment Date', 'Due Days', 'Due Date', 'Ticketing staff', 'Employee No'].join(T)];
const row = (c: Record<number, string>) => Array.from({ length: 22 }, (_, i) => c[i] ?? '').join(T);
const parse = (lines: string[]) => runParser(parseGrid([...head, ...lines].join('\n')).rows, undefined, 'SAR');

console.log('\n1. The 26-31 Oct 2026 statement, as pasted');
{
  const r = parse([
    row({ 7: 'Balance B/F', 9: '30342.24' }),
    row({ 0: '27/10/2026', 2: 'DMA-26-10-0080', 3: 'ADM-26-10-0060', 9: '218.66', 10: '0', 11: '30560.9', 12: '6059308297', 18: '4 days', 19: '27/10/2026' }),
    row({ 8: 'TOTAL', 9: '30560.9', 10: '0' }),
    row({ 8: 'Amount Due To Us', 9: '30560.9' }),
  ]);
  check('read as NSA\'s statement', r.parserName, 'NSA');
  check('one document: the ADM', r.rows.length, 1);
  const a = r.rows[0];
  check('under its ADM number and the request "ADM"', [a?.ticketNo, a?.reqNum, a?.status], ['ADM-26-10-0060', 'ADM', 'ISSUE']);
  check('at its debit, on its date', [a?.amount, a?.date], [218.66, '2026-10-27']);
  check('its debit memo and the ticket it is raised on kept', a?.vendorReference, 'DMA-26-10-0080 / 6059308297');
  check('the ticket in the narration is not a request', a?.reqNum === '6059308297', false);
}

console.log('\n2. A sale, its refund and a payment');
{
  const r = parse([
    row({ 0: '28/10/2026', 2: 'INV-26-10-1234', 3: '065-4861731900', 4: '9AB3CD', 6: 'KSAML2771', 7: 'MR AHMED ALI', 8: 'RUH/JED/RUH', 9: '1250', 10: '0' }),
    row({ 0: '29/10/2026', 2: 'RFD-26-10-0400', 3: '065-4861731900', 4: '9AB3CD', 7: 'MR AHMED ALI', 9: '0', 10: '1100' }),
    row({ 0: '30/10/2026', 2: 'RV-26-10-0099', 9: '0', 10: '20000' }),
  ]);
  check('three documents', r.rows.length, 3);
  check('the sale', [r.rows[0]?.ticketNo, r.rows[0]?.airlineCode, r.rows[0]?.amount, r.rows[0]?.status, r.rows[0]?.reqNum, r.rows[0]?.route],
    ['4861731900', '065', 1250, 'ISSUE', 'KSAML2771', 'RUH/JED/RUH']);
  check('its refund, negative', [r.rows[1]?.ticketNo, r.rows[1]?.amount, r.rows[1]?.status, r.rows[1]?.vendorReference], ['4861731900', -1100, 'REFUND', 'RFD-26-10-0400']);
  check('the payment, a top-up', [r.rows[2]?.status, r.rows[2]?.amount, r.rows[2]?.isTopUp], ['FUND', 20000, true]);
}

console.log('\n3. Their sales report is still their sales report');
{
  const r = runParser(parseGrid(['DATE\tDoc No\tPNR\tDescription\tDEBIT\tCREDIT\tLPO NUMBER\tRequest Number',
    '01/09/2026\t065 - 4861731806\t92NQEV\tAHMAD ALHAZMI\t3613\t0\tINV-26-09-1\tKSAML2064'].join('\n')).rows, undefined, 'SAR');
  check('read by the sales report reader', [r.parserName, r.rows[0]?.ticketNo, r.rows[0]?.amount], ['NSA', '4861731806', 3613]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
