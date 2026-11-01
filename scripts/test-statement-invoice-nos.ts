/**
 * Reading Ibtekar's statement files each ticket under the invoice number it
 * is billed on - what a request for its ZATCA tax invoice quotes.
 */
import { invoiceNumbersFromStatement, confirmationsFromStatement } from '../src/core/helpers/statementInvoiceNos';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const tkt = (o: Partial<Ticket>): Ticket => ({ id: o.ticketNo! + (o.amount! < 0 ? 'R' : 'S'), ticketNo: '', source: 'Ibtekar', date: '2026-10-01', amount: 100,
  commission: 0, totalDoc: 100, reqNum: 'R1', status: 'ISSUE', currency: 'SAR', userId: 'u', vendorReference: '', ...o } as Ticket);
const line = (ticketNo: string, document: string, debit: number, credit = 0) =>
  ({ section: 'TICKET', date: '2026-10-16', document, airline: '065', ticketNo, debit, credit, balance: null });
const st = (lines: any[]) => ({ periodStart: '2026-10-01', periodEnd: '2026-10-19', currency: 'SAR', openingBalance: 0, closingBalance: 0,
  billed: 0, paid: 0, lines, impliedClosing: 0, foots: true }) as any;

console.log('\n1. A sale and a refund, each under its own document');
{
  const r = invoiceNumbersFromStatement(st([line('4862479109', 'INV264783', 271.01), line('4861588756', 'RFD260615', 0, 492.2)]), [
    tkt({ ticketNo: '4862479109', amount: 271, vendorReference: '8V2DEA' }),
    tkt({ ticketNo: '4861588756', amount: 732, vendorReference: 'INV261683' }),
    tkt({ ticketNo: '4861588756', amount: -492.2, vendorReference: '' }),
  ]);
  check('the sale takes INV, over its booking reference', r.fill.map(f => [f.ticketNo, f.was, f.doc]).filter(f => f[2] === 'INV264783'), [['4862479109', '8V2DEA', 'INV264783']]);
  check('the refund takes RFD', r.fill.filter(f => f.doc === 'RFD260615').map(f => f.id), ['4861588756R']);
  check('the earlier sale keeps its own invoice - not this statement\'s refund', r.fill.some(f => f.id === '4861588756S'), false);
  check('nothing in conflict', r.conflicts, []);
}

console.log('\n2. What it leaves alone');
{
  const r = invoiceNumbersFromStatement(st([line('4862479109', 'INV264783', 271.01), line('4862479110', 'INV264783', 300),
    line('4862479111', 'INV264700', 100), line('4862479111', 'INV264701', 100), line('4862479112', 'RV12345', 0, 500)]), [
    tkt({ ticketNo: '4862479109', vendorReference: 'INV264783' }),
    tkt({ ticketNo: '4862479110', vendorReference: 'INV260000' }),
    tkt({ ticketNo: '4862479111' }),
    tkt({ ticketNo: '4862479112' }),
    tkt({ ticketNo: '4862479110', source: 'NSA' }),
  ]);
  check('already right: nothing to do', r.fill.some(f => f.ticketNo === '4862479109'), false);
  check('another document already there: kept, and listed', r.conflicts, [{ ticketNo: '4862479110', has: 'INV260000', statement: 'INV264783' }]);
  check('billed on two invoices: nothing filled', r.fill.some(f => f.ticketNo === '4862479111'), false);
  check('a receipt line is not an invoice', r.fill.some(f => f.ticketNo === '4862479112'), false);
  check('another supplier\'s ticket is not touched', r.fill.length, 0);
}

console.log('\n4. What we keyed by hand, billed at our figure, is confirmed by it');
{
  const hand = (o: Partial<Ticket>) => tkt({ reportName: 'Team sheet — reviewed', ...o });
  const c = confirmationsFromStatement(st([line('1950195673', 'INV264913', 180), line('1950195674', 'INV264913', 180),
    line('4862676450', 'INV264883', 5560), line('4862606961', 'RFD260698', 0, 520.95)]), [
    hand({ ticketNo: '1950195673', amount: 180 }),
    hand({ ticketNo: '1950195674', amount: 170 }),
    tkt({ ticketNo: '4862676450', amount: 5560, reportName: 'Ibtekar' }),
    hand({ ticketNo: '4862606961', amount: -520.95 }),
    hand({ ticketNo: '4862607005', amount: 10 }),
    hand({ ticketNo: '1950195673', amount: 180, source: 'NSA' }),
  ]);
  check('the sale and the refund it bills as recorded', c.map(x => x.id).sort(), ['1950195673S', '4862606961R']);
  check('said by the statement', c[0]?.by, "Ibtekar's statement 2026-10-01 to 2026-10-19");
  check('a figure it bills differently is not confirmed', c.some(x => x.ticketNo === '1950195674'), false);
  check('one it never bills is not confirmed', c.some(x => x.ticketNo === '4862607005'), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
