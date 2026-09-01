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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
