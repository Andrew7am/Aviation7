/**
 * Turkish "Agency Sales Report" — the newer 43-column portal export.
 *
 * The rows below are real lines from the agent's 16–25 August file, with the
 * passenger names replaced: the arithmetic is what is under test, and real
 * passenger names do not belong in the repository.
 *
 * The number that matters is the discount. It is the agency's earning on the
 * sale and the same figure BSP later invoices as commission, so reading it
 * makes the portal row agree with the invoice instead of differing by it.
 */
import Papa from 'papaparse';
import { runParser, smartDetect } from '../src/core/parsers';
import { TurkishAgencySalesParser } from '../src/core/parsers/TurkishAgencySalesParser';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

const HEADER = 'Type of Transaction,req num,Ticket Number,Issue Date,Transaction Date,Domestic Line/International Line,Agent Initial ID,Cash Payment,Negative Cash Payment,Credit Card Payment,Invoice Payment,Fare Amount,Discount Amount,Commission Amount,Tax on Commission Amount,Total Tax Amount,Total Fees Amount,Total Remittence,Currency,Vat Amount,Route,DU Amount,Reporting Agent Code,Issue Agent Code,Passenger Name,YR Amount,management.ndcSalesReport.m6TaxAmount,Paid DU Amount,Product Type,Pax Type,DU Fee,CP Fee,KD Fee,Document Class,Document Type,Deal Code,Point of Turn Around,Invol Ticket,IT BT Flag,Inad Deport Flag,YR Exc VAT,PNR,Markup Amount';

const ROWS = [
  // discounted sale — 13840 + 2410 - 415.2 = 15834.80
  String.raw`Sales,,2352540225917,16.08.2026,16.08.2026,International, ,15834.8,0,0,0,13840,-415.2,0,0,2410,0,15834.8,AED,0,JED\IST\BER\IST\JED,0,,8621913,SURNAMEA/GIVENA MR,1880,20,0, , ,0,0,0,PAX,OP4,,BER,No,No,No,1880,V8MTRZ,0`,
  // no discount — 1380 + 1560 = 2940
  String.raw`Sales,,2352540225922,23.08.2026,23.08.2026,International, ,2940,0,0,0,1380,0,0,0,1560,0,2940,AED,0,JED\IST\BCN\IST\JED,0,,8621913,SURNAMEB/GIVENB MR,1160,20,0, , ,0,0,0,PAX,OP4,,BCN,No,No,No,1160,SF4JXT,0`,
  // discounted — 1490 + 910 - 44.7 = 2355.30
  String.raw`Sales,,2352540225926,23.08.2026,23.08.2026,International, ,2355.3,0,0,0,1490,-44.7,0,0,910,0,2355.3,AED,0,MED\IST\MED,0,,8621913,SURNAMEC/GIVENC MS,580,20,0, , ,0,0,0,PAX,OP4,,IST,No,No,No,580,S7746A,0`,
];

const parse = (lines: string[]) => {
  const csv = [HEADER, ...lines].join('\n');
  const grid = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
  return { headers: grid[0], body: grid.slice(1) };
};

/** The same header as Turkish now exports it: semicolon-delimited. Papa picks
 *  ONE delimiter per file, so a semicolon row needs a semicolon header. */
const HEADER_SEMI = HEADER.replace(/,/g, ';');

const parseSemi = (lines: string[]) => {
  const g = Papa.parse<string[]>([HEADER_SEMI, ...lines].join('\n'), { skipEmptyLines: true }).data;
  return TurkishAgencySalesParser.parse(g.slice(1), g[0], 'AED');
};

console.log('\n1. The new format is recognised');
{
  const { headers } = parse(ROWS);
  eq('its own detect matches', TurkishAgencySalesParser.detect(headers), true);
  const d = smartDetect([headers, ...parse(ROWS).body]);
  eq('smartDetect picks it', d.parser?.id, 'TURKISH_AGENCY');
  eq('and files it under the existing vendor', d.parser?.name, 'Turkish Airlines');
}

console.log('\n2. The vendor arithmetic is read, not re-derived');
const { headers, body } = parse(ROWS);
const out = TurkishAgencySalesParser.parse(body, headers, 'AED');
eq('all three rows parsed', out.rows.length, 3);
eq('no errors', out.errors, []);
{
  const [a, b, c] = out.rows;
  eq('discounted sale: payable', a.amount, 15834.8);
  eq('  ...gross fare', a.totalDoc, 16250);
  eq('  ...discount recorded as commission', a.commission, 415.2);
  eq('  ...gross - commission = payable', Number((a.totalDoc - a.commission).toFixed(2)), a.amount);

  eq('undiscounted sale: payable', b.amount, 2940);
  eq('  ...commission is zero', b.commission, 0);
  eq('  ...gross equals payable', b.totalDoc, 2940);

  eq('third sale: payable', c.amount, 2355.3);
  eq('  ...commission', c.commission, 44.7);
  eq('  ...gross', c.totalDoc, 2400);
}

console.log('\n3. The fields that were previously missing');
{
  const [a, , c] = out.rows;
  eq('route, backslashes normalised', a.route, 'JED-IST-BER-IST-JED');
  eq('  ...short route too', c.route, 'MED-IST-MED');
  eq('passenger name, title removed and reordered', a.passengerName, 'GIVENA SURNAMEA');
  eq('  ...MS title too', c.passengerName, 'GIVENC SURNAMEC');
  eq('date, day-first dotted form', a.date, '2026-08-16');
  eq('  ...and the 23rd', c.date, '2026-08-23');
}

console.log('\n4. Identity is the serial, with the airline kept apart');
{
  const [a] = out.rows;
  eq('ticket is the bare serial', a.ticketNo, '2540225917');
  eq('airline held separately', a.airlineCode, '235');
  eq('PNR', a.pnr, 'V8MTRZ');
  eq('currency', a.currency, 'AED');
  eq('status', a.status, 'ISSUE');
}

console.log('\n5. These rows now agree with the BSP invoice');
{
  // What the agent's own FCAGBILLDET invoices state for the same documents.
  const invoice: Record<string, { payable: number; commission: number }> = {
    '2540225917': { payable: 15834.8, commission: 415.2 },
    '2540225922': { payable: 2940,    commission: 0 },
    '2540225926': { payable: 2355.3,  commission: 44.7 },
  };
  for (const r of out.rows) {
    const inv = invoice[r.ticketNo];
    eq(`${r.ticketNo}: payable matches the invoice`, r.amount, inv.payable);
    eq(`${r.ticketNo}: commission matches the invoice`, r.commission, inv.commission);
  }
}

console.log('\n6. A card sale settles nothing through the agency');
{
  const card = String.raw`Sales,,2352540225999,23.08.2026,23.08.2026,International, ,0,0,2940,0,1380,0,0,0,1560,0,0,AED,0,JED\IST\JED,0,,8621913,SURNAMED/GIVEND MR,1160,20,0, , ,0,0,0,PAX,OP4,,IST,No,No,No,1160,ZZZZZZ,0`;
  const { headers: h, body: bd } = parse([card]);
  const r = TurkishAgencySalesParser.parse(bd, h, 'AED');
  eq('payable is zero', r.rows[0].amount, 0);
  eq('but the fare is still recorded', r.rows[0].totalDoc, 2940);
  eq('and it is called out', r.warnings.some(w => /credit card/i.test(w)), true);
}

console.log('\n7. A refund is negative');
{
  const refund = String.raw`Refund,,2352540225917,16.08.2026,26.08.2026,International, ,0,15834.8,0,0,13840,-415.2,0,0,2410,0,-15834.8,AED,0,JED\IST\BER\IST\JED,0,,8621913,SURNAMEA/GIVENA MR,1880,20,0, , ,0,0,0,PAX,OP4,,BER,No,No,No,1880,V8MTRZ,0`;
  const { headers: h, body: bd } = parse([refund]);
  const r = TurkishAgencySalesParser.parse(bd, h, 'AED');
  eq('status', r.rows[0].status, 'REFUND');
  eq('amount is negative', r.rows[0].amount, -15834.8);
}

console.log('\n8. A file whose own totals disagree is flagged, not trusted');
{
  const bad = String.raw`Sales,,2352540225888,23.08.2026,23.08.2026,International, ,9999,0,0,0,1380,0,0,0,1560,0,9999,AED,0,JED\IST\JED,0,,8621913,SURNAMEE/GIVENE MR,1160,20,0, , ,0,0,0,PAX,OP4,,IST,No,No,No,1160,YYYYYY,0`;
  const { headers: h, body: bd } = parse([bad]);
  const r = TurkishAgencySalesParser.parse(bd, h, 'AED');
  eq('the mismatch is reported', r.warnings.some(w => /arithmetic does not agree/i.test(w)), true);
}

console.log('\n9. A refund states its discount POSITIVE — the commission coming back');
{
  // Real line from the 01-28 August file, semicolon-delimited as Turkish now
  // exports it. -7280 + -2370 + 240.9 = -9409.10, so the sign must be used as
  // written; taking the magnitude broke the identity on every refund.
  const refund = String.raw`Refund;;2352540225915;13.08.2026;28.08.2026;International; ;-9409.1;0;0;0;-7280;240.9;0;0;-2370;0;-9409.1;AED;0;DMM\IST\BER\IST\DMM;0;;8621913;SURNAMEF/GIVENF MR;-1880;20;0; ; ;0;0;0;PAX;OP4;;BER;No;No;No;-1880;RMYM5F;0`;
  const r = parseSemi([refund]);
  eq('the vendor arithmetic agrees', r.warnings.some(w => /does not agree/.test(w)), false);
  eq('status', r.rows[0].status, 'REFUND');
  eq('payable is negative', r.rows[0].amount, -9409.1);
  eq('commission is handed back, so negative', r.rows[0].commission, -240.9);
  eq('gross is held as a magnitude', r.rows[0].totalDoc, 9650);
}

console.log('\n10. An issue and its refund cancel out');
{
  const sale   = String.raw`Sales;;2352540225915;13.08.2026;13.08.2026;International; ;10179.1;0;0;0;8030;-240.9;0;0;2390;0;10179.1;AED;0;DMM\IST\BER\IST\DMM;0;;8621913;SURNAMEF/GIVENF MR;1880;20;0; ; ;0;0;0;PAX;OP4;;BER;No;No;No;1880;RMYM5F;0`;
  const refund = String.raw`Refund;;2352540225915;13.08.2026;28.08.2026;International; ;-9409.1;0;0;0;-7280;240.9;0;0;-2370;0;-9409.1;AED;0;DMM\IST\BER\IST\DMM;0;;8621913;SURNAMEF/GIVENF MR;-1880;20;0; ; ;0;0;0;PAX;OP4;;BER;No;No;No;-1880;RMYM5F;0`;
  const r = parseSemi([sale, refund]);
  const comm = r.rows.reduce((s, x: any) => s + x.commission, 0);
  eq('the commission nets to nothing', Number(comm.toFixed(2)), 0);
  eq('and only the unrefunded tax is left', Number(r.rows.reduce((s, x: any) => s + x.amount, 0).toFixed(2)), 770);
}

console.log('\n11. An exchange is a sale, and may carry only fees');
{
  const exch = String.raw`Exchange;;2352540225911;06.08.2026;06.08.2026;International; ;469.7;0;0;0;10;-0.3;0;0;90;370;469.7;AED;0;JED\IST\BCN\IST\JED;0;;8621913;SURNAMEG/GIVENG MR;0;10;0; ; ;0;370;0;PAX;OP4;;BCN;No;No;No;0;U2URZS;0`;
  const r = parseSemi([exch]);
  eq('treated as a sale', r.rows[0].status, 'ISSUE');
  eq('fees are part of the gross', r.rows[0].totalDoc, 470);
  eq('payable', r.rows[0].amount, 469.7);
  eq('and the arithmetic holds', r.warnings.some(w => /does not agree/.test(w)), false);
}

console.log('\n12. A semicolon-delimited export parses the same as a comma one');
{
  const semi = String.raw`Sales;;2352540225922;23.08.2026;23.08.2026;International; ;2940;0;0;0;1380;0;0;0;1560;0;2940;AED;0;JED\IST\BCN\IST\JED;0;;8621913;SURNAMEB/GIVENB MR;1160;20;0; ; ;0;0;0;PAX;OP4;;BCN;No;No;No;1160;SF4JXT;0`;
  const g = Papa.parse<string[]>([HEADER_SEMI, semi].join('\n'), { skipEmptyLines: true }).data;
  eq('the header splits into columns', g[0].length > 40, true);
  const r = TurkishAgencySalesParser.parse(g.slice(1), g[0], 'AED');
  eq('payable', r.rows[0]?.amount, 2940);
  eq('route', r.rows[0]?.route, 'JED-IST-BCN-IST-JED');
}

console.log('\n13. The old Turkish export still parses as before');
{
  const oldCsv = 'Ticket Number,PNR,Transaction Date,Operation Type,Total Fare,Base Fare,Taxes,Currency\n2352540225917,V8MTRZ,16.08.2026,ISSUE,16250,13840,2410,AED';
  const grid = Papa.parse<string[]>(oldCsv, { skipEmptyLines: true }).data;
  const d = smartDetect(grid);
  eq('still routed to the older parser', d.parser?.id, 'TURKISH');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
