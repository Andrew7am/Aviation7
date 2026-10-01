/**
 * Every ADM in the books, and what each one is.
 *
 *   npx tsx scripts/test-adm-register.ts
 *
 * "ADM" in the ledger was four things: an airline's debit memo, its credit
 * memo, BSP's own fee printed under DEBIT MEMOS, and a supplier's ADM passed
 * on under the request "ADM". Asserted on the real rows.
 */
import { admKind, admRegister, admTotals } from '../src/core/helpers/admRegister';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const t = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36).slice(2), ticketNo: '', pnr: '', passengerName: '',
  airlineCode: '', route: '', source: 'IATA BSP', date: '2026-03-18', amount: 0, totalDoc: 0, commission: 0, reqNum: '',
  vendorReference: '', status: 'ISSUE', currency: 'AED', isDuplicate: false, closed: true, userId: 'u', ...o } as Ticket);

console.log('\n1. What each one is');
check('an airline ADM', admKind(t({ ticketNo: '6210900650', airlineCode: '109', status: 'ADM', transactionType: 'ADMA', amount: 104.36 })), 'ADM');
check('an ADM typed as ISSUE is still an ADM', admKind(t({ ticketNo: '6206503067', airlineCode: '065', status: 'ADM', transactionType: 'ISSUE', amount: 170 })), 'ADM');
check('a credit memo', admKind(t({ ticketNo: '0820147238', airlineCode: '125', status: 'ACM', transactionType: 'ACMA', amount: -30699 })), 'ACM');
check('BSP\'s fee is not an ADM', admKind(t({ ticketNo: '6000083998', airlineCode: '953', status: 'ADM', transactionType: 'SPDR', amount: 22.08 })), 'BSP_FEE');
check('nor one somebody labelled "NOT AN ADM"', admKind(t({ ticketNo: '6895352376', airlineCode: '793', status: 'ADM', transactionType: 'ADM', amount: 146.92, reqNum: 'ADM-NOT AN ADM' })), 'BSP_FEE');
check('a supplier\'s ADM under the request "ADM"', admKind(t({ ticketNo: 'NSA_NOREF_pit3t8', source: 'NSA', reqNum: 'ADM', amount: 2281, currency: 'SAR' })), 'SUPPLIER_ADM');
check('"ADM-SHYMAA" too', admKind(t({ ticketNo: 'NSA_NOREF_m4xg5j', source: 'NSA', reqNum: 'ADM-SHYMAA', amount: 4451 })), 'SUPPLIER_ADM');
check('a ticket is not', admKind(t({ ticketNo: '5512129133', amount: 2044.1, reqNum: 'UAECO98' })), null);
check('nor a request that merely contains the letters', admKind(t({ ticketNo: '5512129134', amount: 100, reqNum: 'KSAADMIN1' })), null);

console.log('\n2. The ticket it is about');
{
  const sale = t({ ticketNo: '5512129133', amount: 2044.1, reqNum: 'UAECO98', pnr: 'ZN8S2O' });
  const reg = admRegister([sale,
    t({ ticketNo: '6210900650', airlineCode: '109', status: 'ADM', transactionType: 'ADMA', amount: 104.36, relatedTicket: '5512129133' }),
    t({ ticketNo: '6206503067', airlineCode: '065', status: 'ADM', amount: 170, relatedTicket: '6075549430', date: '2025-12-03' }),
    t({ ticketNo: '6212703201', airlineCode: '157', status: 'ADM', amount: 1140, date: '2026-09-04' })]);
  check('three memos, newest first', reg.map(r => r.ticket.ticketNo), ['6212703201', '6210900650', '6206503067']);
  check('the one on a ticket we hold finds it', reg[1].onTicketRows.map(x => x.reqNum), ['UAECO98']);
  check('the one on a ticket we do not hold says so', reg[2].flag, 'Ticket 6075549430 is not in our books.');
  check('the one naming no ticket says so', reg[0].flag, 'The memo names no ticket.');
  check('totals by kind', admTotals(reg).map(x => [x.kind, x.count, x.amount]), [['ADM', 3, 1414.36]]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
