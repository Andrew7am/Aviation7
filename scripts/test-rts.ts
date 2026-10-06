/**
 * RTS reports its own currency and its own itinerary; the parser has to read
 * both rather than assume them.
 *
 * RTS bills in AED, but the parser used to take whatever currency the UI
 * happened to default to — so every RTS ticket was filed as SAR unless the
 * operator changed the dropdown by hand. And its Route column was never read
 * at all, which left every RTS ticket with no itinerary and therefore no way
 * to tell a domestic trip from an international one.
 */
import Papa from 'papaparse';
import { RTSParser } from '../src/core/parsers/RTSParser';
import { smartDetect } from '../src/core/parsers';
import { extractRoute } from '../src/core/helpers/extractRoute';
import { classifyTravel } from '../src/core/helpers/travelScope';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runParser } from '../src/core/parsers';
import { parseGrid } from '../src/core/helpers/parseGrid';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

// The real column set from the agent's RTS export, trimmed of the columns the
// parser does not touch but keeping their positions intact.
const HEADER = 'PNR creation date,req num,Record Locator,OfficeId Bk,OfficeId Tk,SignInBooking,SignInTicketing,Passenger,PaxType,DepDate,ArrDate,NumberOfSegments,Fare basis(es),Booking class(es),Service class(es),Route,Flight numbers,Baggage,Date,No,Carrier,Type,Action,Issue type,Fare,Fare currency,Net fare,Fare equiv,Fare equiv. currency,Commission,Commission equiv,Taxes,Taxes currency,SFDiscount,HF,Service fee,SfTotal,MarkUpTotal,MarkUpVat,MarkUpDiscount,Service fee VAT,Total,Total currency,National total,National currency,Misc. fees,Grand total,Currency rate,FOP,Document credit total,SF credit total,Credit currency,Credit currency rate,Booking terminal ID,Ticketing terminal ID';

/** A real line, passenger name replaced. Fare is quoted in OMR; the TOTAL —
 *  what the agency actually owes — is AED 220. */
const ROW = '46246,KSAML1922,XRHKKX,DXBAD32AQ,DXBDN38DA,2511ND,2001ES,SURNAME GIVEN NAME,,46370,46373,2,MCMROM;TCM3OM,M;T,,MCT-RUH;RUH-MCT,WY681;WY684,,46265,910-5513376674,WY,ticket,reissue,BSP,196,OMR,,0,AED,0,0,220,AED,0,0,0,0,0,0,0,0,220,AED,220,AED,0,220,9.576,CASH,220,0,AED,1,,71847';

const parse = (rows: string[], defaultCurrency: 'SAR' | 'AED' = 'SAR') => {
  const g = Papa.parse<string[]>([HEADER, ...rows].join('\n'), { skipEmptyLines: true }).data;
  return RTSParser.parse(g.slice(1), g[0], defaultCurrency);
};

console.log('\n1. The file is still recognised as RTS');
{
  const g = Papa.parse<string[]>([HEADER, ROW].join('\n'), { skipEmptyLines: true }).data;
  eq('detect matches', RTSParser.detect(g[0]), true);
  eq('smartDetect picks RTS', smartDetect(g).parser?.id, 'RTS');
}

console.log('\n2. The currency comes from the file, not the dropdown');
{
  // The bug: with the UI defaulting to SAR, an AED report was filed as SAR.
  const r = parse([ROW], 'SAR');
  eq('AED is read from Total currency', r.rows[0].currency, 'AED');
  eq('  ...even though the default said SAR', parse([ROW], 'SAR').rows[0].currency, 'AED');
  // The row quotes its FARE in OMR and its TOTAL in AED. The total is what the
  // agency owes, so that is the currency the ledger must record.
  eq('  ...and it is the Total currency, not the Fare currency',
     String(r.rows[0].currency), 'AED');
  eq('the amount is the AED total', r.rows[0].amount, 220);
}

console.log('\n3. A file that states nothing still falls back to the default');
{
  // Same row with every currency cell blanked.
  const blank = ROW.split(',');
  [25, 28, 32, 42, 44, 51].forEach(i => { if (blank[i] !== undefined) blank[i] = ''; });
  const r = parse([blank.join(',')], 'SAR');
  eq('falls back to the chosen default', r.rows[0].currency, 'SAR');
}

console.log('\n4. The route is read, and both sectors survive');
{
  const r = parse([ROW]);
  eq('itinerary stitched from its sectors', r.rows[0].route, 'MCT-RUH-MCT');
  eq('  ...not just the outbound leg', r.rows[0].route !== 'MCT-RUH', true);
  eq('and it classifies as international', classifyTravel(r.rows[0].route), 'INTERNATIONAL');
}

console.log('\n5. Stitching sectors, in general');
eq('RTS form',        extractRoute('MCT-RUH;RUH-MCT'), 'MCT-RUH-MCT');
eq('Ibtekar form',    extractRoute('RUH-JED; JED-RUH'), 'RUH-JED-RUH');
eq('three sectors',   extractRoute('JED-IST;IST-BCN;BCN-JED'), 'JED-IST-BCN-JED');
eq('open jaw kept',   extractRoute('JED-IST;CAI-JED'), 'JED-IST-CAI-JED');
eq('a single sector is untouched', extractRoute('MCT-RUH'), 'MCT-RUH');
eq('slashes still preserved',      extractRoute('RUH/JED/RUH'), 'RUH/JED/RUH');
eq('backslashes normalised',       extractRoute('JED\\IST\\JED'), 'JED-IST-JED');
eq('free text still rejected',     extractRoute('PENALTY FEE'), '');
eq('one airport is not a route',   extractRoute('JED'), '');

console.log('\n6. The rest of the row is unchanged');
{
  const r = parse([ROW]);
  const t = r.rows[0];
  eq('ticket is the bare serial', t.ticketNo, '5513376674');
  eq('airline kept apart', t.airlineCode, '910');
  eq('PNR', t.pnr, 'XRHKKX');
  eq('req num', t.reqNum, 'KSAML1922');
  eq('status', t.status, 'ISSUE');
  eq('no errors', r.errors, []);
}

console.log('\n7. A file with no Req column says so, instead of inventing one');
{
  /* The agent's own export carries "req num" as its second column. The raw
     export out of RTS's portal does not carry it at all — and the parser
     used to fall back to column 4, which in that file is SignInBooking: the
     agent's sign-in code. Every ticket then arrived filed under "2511ND",
     a request nobody raised, and nothing warned, because the column was
     full. Missing has to read as missing. */
  const drop = (csv: string) => csv.split(',').filter((_, i) => i !== 1).join(',');
  const bare = drop(HEADER), bareRow = drop(ROW);
  const g = Papa.parse<string[]>([bare, bareRow].join('\n'), { skipEmptyLines: true }).data;
  const r = RTSParser.parse(g.slice(1), g[0], 'AED');

  eq('still recognised as RTS', RTSParser.detect(g[0]), true);
  eq('column 4 of that file is the sign-in code', g[0][4], 'SignInBooking');
  eq('  ...and it is not empty, which is why it was believed', g[1][4], '2511ND');
  eq('the req is left empty', r.rows[0].reqNum, '');
  eq('  ...not the sign-in code', r.rows[0].reqNum !== '2511ND', true);
  eq('the sign-in code is not kept as a reference either',
     r.rows[0].vendorReference, '');
  eq('and the import says it is missing',
     r.warnings.includes('Ticket 5513376674: Missing Req Num'), true);
  eq('the rest of the row still reads', r.rows[0].amount, 220);
}

console.log('\n8. An explicit Req column is still read where it exists');
{
  const r = parse([ROW]);
  eq('from the header, not from a position', r.rows[0].reqNum, 'KSAML1922');
  eq('no missing-req warning', r.warnings.filter(w => w.includes('Missing Req')), []);
}

console.log('\n9. A ticket is dated the day it was issued, not the day its booking was opened');
{
  // The row's booking was opened on day 46246 and the reissue sold on 46265.
  const r = parse([ROW]);
  eq('the issue date', r.rows[0].date, '2026-08-31');
  // ZWE5AG: opened 6 June, tickets issued 10 June.
  const zwe = ROW.replace(/^46246,/, '6/6/2026,').replace(',46265,', ',6/10/2026,');
  eq('a booking opened earlier', parse([zwe]).rows[0].date, '2026-06-10');
  const noIssue = ROW.replace(',46265,', ',,');
  eq('no issue date: the booking date, as before', parse([noIssue]).rows[0].date, '2026-08-12');
}

console.log('\n10. The General Ticket Report - one row per ticket, its state in DisplayStatus');
{
  const file = readFileSync(resolve('scripts/fixtures/rts-general-ticket-report.csv'), 'utf8');
  const fromFile = runParser(parseGrid(file).rows, undefined, 'SAR', 'Agent_RTS_General_Ticket_Report.csv');
  eq('recognised as RTS on its own', fromFile.parserName, 'RTS');
  eq('the ticket, at its total, on the day it was ticketed',
    fromFile.rows.map(r => [r.ticketNo, r.status, r.amount, r.currency, r.date, r.pnr, r.route]),
    [['5513574474', 'ISSUE', 2240, 'AED', '2026-10-03', 'XC4UK4', 'LAS-LAX-LAS']]);
  eq('no request guessed from any column', fromFile.rows[0].reqNum, '');

  // The same, pasted from RTS's screen: tab-separated.
  const pasted = file.split(/\r?\n/).filter(Boolean).map(l => Papa.parse<string[]>(l).data[0].join('\t')).join('\n');
  const fromPaste = runParser(parseGrid(pasted).rows, undefined, 'SAR', 'pasted');
  eq('pasted, it reads the same', fromPaste.rows.map(r => [r.ticketNo, r.amount, r.date]), [['5513574474', 2240, '2026-10-03']]);

  // A refunded and a voided ticket, written the way the report writes them.
  const grid = parseGrid(file).rows;
  const H = grid[0];
  const row = (o: Record<string, string>) => H.map((h, i) => (h in o ? o[h] : grid[1][i]));
  const more = [H,
    row({ 'Ticket No': '006-5513574475', DisplayStatus: 'refunded', 'Refund date': '2026-10-05', Refund: '1950.00', 'Refund Fee': '290.00', Balance: '290.00' }),
    row({ 'Ticket No': '006-5513574476', DisplayStatus: 'voided', 'Void date': '2026-10-03' }),
  ];
  const r = runParser(more, undefined, 'SAR', 'x');
  eq('a refunded ticket: its sale, and the refund on its refund date',
    r.rows.filter(x => x.ticketNo === '5513574475').map(x => [x.status, x.amount, x.date]),
    [['ISSUE', 2240, '2026-10-03'], ['REFUND', -1950, '2026-10-05']]);
  eq('a voided ticket: a void, at nothing', r.rows.filter(x => x.ticketNo === '5513574476').map(x => [x.status, x.amount]), [['VOID', 0]]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
