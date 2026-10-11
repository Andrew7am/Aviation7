/**
 * Emirates' agency sales report, and the BSP invoice that settles it.
 *
 * The rows are the agency's real lines of 2026-10-08, pasted as the user did.
 * The report carries no passenger names. Like Turkish, these documents are
 * invoiced later by IATA BSP, and that invoice must land on the Emirates row
 * rather than become a second one.
 */
import { parseGrid } from '../src/core/helpers/parseGrid';
import { runParser, smartDetect } from '../src/core/parsers';
import { detectDuplicates, detectDuplicatesAgainstExisting } from '../src/core/ImportEngine';
import type { Ticket } from '../src/types';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

const H = 'POSDate\tTransDesc\tValidatingCarrier\tPOSTime\tPCC\tAgentID\tFLXRecLoc\tType\tConjunctiveIndicator\tDocumentNumber\tCheckDigit\tBaseAmt\tTax1Amt2\tTax1Designator\tTax2Amt2\tTax2Designator\tTax3Amt2\tTax3Designator\tExemptedTax1_Amount\tExemptedTax1_Designator\tExemptedTax2_Amount\tExemptedTax2_Designator\tExemptedTax3_Amount\tExemptedTax3_Designator\tBaseCheck\tBaseCash\tBaseOther\tTotalAmt\tFees\tGrandDailyTotal\tNetDueAirline\tComm\tNegativeComm\tCurrency\tFOP\tApprovalCode\tExchangedFor\tFareRulesTourCode\tRefundPenalty\tEMDDescription';
const line = (doc: string, check: string, base: string, total: string) =>
  `2026-10-08\tTicket\tEK\t18:57:35\tEY0F\tYahiaH\tPFTOQZ\tTKTT\t\t${doc}\t${check}\t${base}\t1390\tYQ\t1390\tYQ\t290\tXT\t0\t\t0\t\t0\t\t\t${total}\t\t${total}\t\t${total}\t${total}\t\t\tAED\tCASH\t\t\tZZNDC2ZZ\t\t`;
const PASTE = [H,
  line('1769019146724', '4', '13840', '16910'),
  line('1769019146725', '5', '13840', '16910'),
  line('1769019146726', '6', '10380', '13450'),
].join('\n');

console.log('\n1. The report is recognised as Emirates');
const grid = parseGrid(PASTE).rows;
{
  const d = smartDetect(grid);
  eq('detected', d.parser?.id, 'EMIRATES');
  eq('filed under its own vendor', d.parser?.name, 'Emirates');
}

console.log('\n2. Each document, at what the agency owes on it');
const r = runParser(grid, undefined, 'SAR', 'pasted');
{
  eq('three documents', r.rows.map(t => t.ticketNo), ['9019146724', '9019146725', '9019146726']);
  eq('Emirates\' code off the document number', [...new Set(r.rows.map(t => t.airlineCode))], ['176']);
  eq('at Net Due Airline', r.rows.map(t => t.amount), [16910, 16910, 13450]);
  eq('in dirhams, as the report says', [...new Set(r.rows.map(t => t.currency))], ['AED']);
  eq('dated on the sale', r.rows[0].date, '2026-10-08');
  eq('with their booking', r.rows[0].pnr, 'PFTOQZ');
  eq('sales', [...new Set(r.rows.map(t => t.status))], ['ISSUE']);
  eq('no errors', r.errors, []);
}

console.log('\n3. A refund, a void and a card sale');
{
  const g = parseGrid([H,
    `2026-10-09\tRefund\tEK\t10:00:00\tEY0F\tYahiaH\tPFTOQZ\tRFND\t\t1769019146724\t4\t13840\t0\t\t0\t\t0\t\t0\t\t0\t\t0\t\t\t15000\t\t15000\t\t15000\t15000\t\t\tAED\tCASH\t\t\t\t1910\t`,
    `2026-10-09\tVoid\tEK\t10:00:00\tEY0F\tYahiaH\tABCDEF\tCANX\t\t1769019146799\t1\t1000\t0\t\t0\t\t0\t\t0\t\t0\t\t0\t\t\t1000\t\t1000\t\t1000\t1000\t\t\tAED\tCASH\t\t\t\t\t`,
    `2026-10-09\tTicket\tEK\t10:00:00\tEY0F\tYahiaH\tGHIJKL\tTKTT\t\t1769019146800\t2\t1000\t0\t\t0\t\t0\t\t0\t\t0\t\t0\t\t\t1000\t\t1000\t\t1000\t1000\t\t\tAED\tCC\t\t\t\t\t`,
  ].join('\n')).rows;
  const x = runParser(g, undefined, 'SAR', 'pasted');
  eq('the refund is a credit', [x.rows[0].status, x.rows[0].amount], ['REFUND', -15000]);
  eq('the void carries nothing', [x.rows[1].status, x.rows[1].amount], ['VOID', 0]);
  eq('a card sale settles nothing through the agency', x.rows[2].amount, 0);
}

console.log('\n4. The BSP invoice settles the Emirates row, like Turkish');
{
  const portal: Ticket = { id: 'ek-1', ticketNo: '9019146724', airlineCode: '176', source: 'Emirates', date: '2026-10-08',
    amount: 16910, commission: 0, totalDoc: 16910, reqNum: 'KSAML2800', status: 'ISSUE', currency: 'AED', pnr: 'PFTOQZ', userId: 'u' } as Ticket;
  const bsp: Ticket = { ...portal, id: 'bsp-1', source: 'IATA BSP', amount: 16600, commission: 310, channel: 'BSP', reqNum: '' } as Ticket;
  const res = detectDuplicatesAgainstExisting(detectDuplicates([bsp]), [portal]);
  eq('not a second row', res.fresh.length, 0);
  eq('settles the Emirates row', res.settlements.map(s => s.id), ['ek-1']);
  eq('  ...still an Emirates sale', res.settlements[0]?.source, 'Emirates');
  eq('  ...at the invoice\'s payable', [res.settlements[0]?.amount, res.settlements[0]?.commission], [16600, 310]);
  eq('  ...through BSP', res.settlements[0]?.channel, 'BSP');
  eq('  ...its request kept', res.settlements[0]?.reqNum, 'KSAML2800');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
