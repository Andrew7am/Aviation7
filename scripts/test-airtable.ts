/**
 * The team's Airtable, read as their sheet, and what its changes mean.
 *
 *   npx tsx scripts/test-airtable.ts
 */
import { sheetTime, toSheetRow, normalize, diffRecord, rowsToCsv, type AirtableTicketRow } from '../src/core/integrations/airtable';
import { noticesFor, ledgerIndex, onePassenger, usableName, usableCabin } from '../src/core/integrations/airtableNotices';
import { parseTeamSheet } from '../src/core/parsers/teamSheet';
import { teamFixes } from '../src/core/integrations/airtableFixes';
import { requestsFor } from '../src/core/integrations/airtableRequests';
import { detailsFor } from '../src/core/integrations/airtableDetails';
import Papa from 'papaparse';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. Times as their export prints them - Cairo time');
check('summer, +3', sheetTime('2026-09-26T09:50:00.000Z'), '26/9/2026 12:50pm');
check('winter, +2: still the 5th', sheetTime('2026-03-05T21:10:00.000Z'), '5/3/2026 11:10pm');
check('nothing', sheetTime(undefined), '');

const names = new Map([['rec7HWuwM1EkCBoXj', 'Qatar Airways'], ['rec0DQpeFyZnI31G2', 'IATA Portal (UAE)'], ['rec2qRtDTXgFlJLQQ', 'Nour Douban']]);
const rec = { id: 'recA', createdTime: '2026-09-26T09:51:00.000Z', fields: {
  'Ticket Number': '157-5513427794', PNR: 'ZJZFBJ', Status: 'Void', 'Net Cost': 2560, TAX: 0, 'Total Cost with Currency': '2560 AED',
  Currency: 'AED', 'Issued Date & Time': '2026-09-26T09:50:00.000Z', Airline: ['rec7HWuwM1EkCBoXj'], Portal: ['rec0DQpeFyZnI31G2'],
  'TEAM MEMBERS': ['rec2qRtDTXgFlJLQQ'], 'Refund Recieved?': true, 'Cabin Class (Automated)': { state: 'generated', value: 'Economy', isStale: false },
  'Extracted Client Name': { state: 'generated', value: 'ABDALRAHMAN ALHAMOUD' }, 'REQ No (Auto) (Trip) (from Aviation Quotations)': ['UAEVP711'],
  'Last Modified': '2026-09-26T09:52:00.000Z' } };

console.log('\n2. A record as one row of their export');
{
  const row = toSheetRow(rec.fields, names);
  check('cost with two decimals', row['Net Cost'], '2560.00');
  check('tax with one', row['TAX'], '0.0');
  check('linked records by name', [row['Airline'], row['Portal'], row['TEAM MEMBERS']], ['Qatar Airways', 'IATA Portal (UAE)', 'Nour Douban']);
  check('an AI field by its value', row['Cabin Class (Automated)'], 'Economy');
  check('a ticked box', row['Refund Recieved?'], 'checked');
  const sheet = parseTeamSheet(rowsToCsv([row], d => Papa.unparse(d as any))).rows;
  check('read back by the sheet reader', [sheet[0].serial, sheet[0].status, sheet[0].cost, sheet[0].reqNum, sheet[0].issued],
        ['5513427794', 'VOID', 2560, 'UAEVP711', '2026-09-26']);
}

console.log('\n3. What moved between two syncs');
const a = normalize(rec, names);
{
  check('the request, from both request columns', a.req_num, 'UAEVP711');
  check('nothing moved: nothing said', diffRecord(a, { ...a }), []);
  check('a date read back in another spelling is the same', diffRecord(a, { ...a, issued_at: '2026-09-26T09:50:00+00:00' }), []);
  check('two empty dates are the same', diffRecord({ ...a, issued_at: null }, { ...a, issued_at: '' as any }), []);
  check('a new record has no changes', diffRecord(undefined, a), []);
  check('the request moved', diffRecord(a, { ...a, req_num: 'UAEVP745' }).map(c => [c.label, c.old, c.new]), [['Request', 'UAEVP711', 'UAEVP745']]);
}

console.log('\n4. What a change means for our books');
{
  const ours = [{ id: 't1', ticketNo: '5513427739', reqNum: 'KSAFM2611', passengerName: '', cabinClass: '', amount: 330, currency: 'AED' }];
  const row: AirtableTicketRow = { ...a, record_id: 'recB', ticket_cell: '065-5513427739', serials: ['5513427739'], req_num: 'KSAML2053',
    client_name: 'SALEEM KHADER ELDADAH', cabin: 'Economy', net_cost: 330, status: 'Reissue' };
  const changes = new Map([['recB', diffRecord({ ...row, req_num: 'KSAFM2611', net_cost: 300 }, row)]]);
  const n = noticesFor([row], changes, ledgerIndex(ours));
  check('a request moved and a cost changed - names and cabins are no notices', n.map(x => x.kind).sort(), ['PRICE', 'REQ_CHANGED']);
  const req = n.find(x => x.kind === 'REQ_CHANGED')!;
  check('accepting moves ours to theirs', [req.payload.to, req.ticket_ids], ['KSAML2053', ['t1']]);
  check('nothing moved: nothing said', noticesFor([row], new Map(), ledgerIndex(ours)).map(x => x.kind), []);
  const ref = noticesFor([{ ...row, status: 'Cancelled/Refunded', refund_amount: 1560 }],
    new Map([['recB', diffRecord(row, { ...row, status: 'Cancelled/Refunded', refund_amount: 1560 })]]), ledgerIndex(ours));
  check('a refund on theirs', ref.some(x => x.kind === 'REFUND'), true);
  const vd = noticesFor([{ ...row, status: 'Void' }], new Map([['recB', diffRecord(row, { ...row, status: 'Void' })]]), ledgerIndex(ours));
  check('a void on a ticket we hold as a sale', vd.some(x => x.kind === 'VOID'), true);
  check('a ticket we do not hold raises nothing here', noticesFor([row], changes, ledgerIndex([])), []);
}

console.log('\n5. Names and cabins only where the row is one passenger');
{
  const r = (cell: string, serials: string[]) => ({ ...a, ticket_cell: cell, serials }) as AirtableTicketRow;
  check('one ticket', onePassenger(r('065-5513427739', ['5513427739'])), true);
  check('a conjunction pair', onePassenger(r('176-5512845110-11', ['5512845110', '5512845111'])), true);
  check('two tickets in one cell', onePassenger(r('157-5513427794\n157-5513427795', ['5513427794', '5513427795'])), false);
  check('a placeholder is no name', [usableName('CLIENT NAME NOT FOUND'), usableName('CC'), usableName('ms Abrar Hamwah')], ['', '', 'ABRAR HAMWAH']);
  check('a cabin, or none', [usableCabin('Business'), usableCabin("Class couldn't be determined"), usableCabin('Economy; Business')], ['BUSINESS', '', '']);
}

console.log('\n6. What the team has to put right on their side');
{
  const row = (o: any) => ({ record_id: 'r', ticket_cell: '', serials: [], pnr: 'ABC123', status: 'Issued', req_num: 'UAEVP711',
    net_cost: 100, currency: 'AED', portal: 'IATA Portal (UAE)', team_member: 'X', issued_at: null, ...o });
  const bsp = (p: string) => /IATA/.test(p);
  const kinds = (rows: any[]) => teamFixes(rows, bsp).map(f => f.kind);
  check('"EMD" in the ticket column of a BSP row', kinds([row({ ticket_cell: 'EMD' })]), ['NO_NUMBER']);
  check('a flyadeal row under its PNR is how it is written', kinds([row({ ticket_cell: '00', portal: 'F3' })]), []);
  check('but with no PNR either, it is a fault', kinds([row({ ticket_cell: '00', portal: 'F3', pnr: '' })]), ['NO_NUMBER']);
  check('a held option needs no number', kinds([row({ status: 'On Hold' })]), []);
  check('no request', kinds([row({ ticket_cell: '065-5513427739', serials: ['5513427739'], req_num: '' })]), ['NO_REQUEST']);
  check('issued with no cost', kinds([row({ ticket_cell: '065-5513427739', serials: ['5513427739'], net_cost: null })]), ['NO_COST']);
  check('one ticket issued on two rows', kinds([row({ serials: ['5513427739'] }), row({ record_id: 'r2', serials: ['5513427739'] })]), ['ISSUED_TWICE', 'ISSUED_TWICE']);
}

console.log('\n7. A ticket with no request takes the one their sheet gives');
{
  const row = (o: any) => ({ serials: [], emd: '', pnr: '', req_num: '', status: 'Issued', ...o });
  const fill = (t: any, rows: any[]) => requestsFor([{ id: 'a', ticketNo: '', pnr: '', ...t }], rows).map(f => [f.req, f.how]);
  check('by its number', fill({ ticketNo: '5513427739' }, [row({ serials: ['5513427739'], req_num: 'KSAML2053' })]), [['KSAML2053', 'ticket number']]);
  check('an EMD by their EMD column', fill({ ticketNo: '1949933377' }, [row({ serials: [], emd: '065-1949933377', req_num: 'UAEVP711' })]), [['UAEVP711', 'ticket number']]);
  // ZWE5AG: their cell names two of nine passengers; the booking is one request.
  const zwe = [row({ serials: ['5512845110', '5512845111'], pnr: 'ZWE5AG', req_num: 'UAEVP420' }), row({ serials: ['5512878176'], pnr: 'ZWE5AG', req_num: 'UAEVP420' })];
  // A ticket their sheet does not name is one they forgot - to be sent back
  // to them, not filed from the rest of its booking.
  check('never by its booking: a ticket they did not write stays without one', fill({ ticketNo: '5512845112', pnr: 'ZWE5AG' }, zwe), []);
  check('not from a row naming two requests', fill({ ticketNo: '5513427739' }, [row({ serials: ['5513427739'], req_num: 'UAEVP420, KSAML2053' })]), []);
  check('not from a held booking', fill({ ticketNo: 'X', pnr: 'YFMA7K' }, [row({ pnr: 'YFMA7K', status: 'On Hold', req_num: 'KSAML1271' })]), []);
  check('a number their sheet files under two requests is not settled',
    fill({ ticketNo: '5513427739', pnr: 'P1' }, [row({ serials: ['5513427739'], pnr: 'P1', req_num: 'A1' }), row({ serials: ['5513427739'], pnr: 'P1', req_num: 'B2' })]), []);
}

console.log('\n7b. Flyadeal by its PNR - its report has no ticket number');
{
  const f3row = { serials: ['9152641826'], emd: '', pnr: 'H692FC', req_num: 'KSAML2706', status: 'Issued', portal: 'F3', airline: 'Flyadeal' };
  check('a flyadeal ticket of ours, held under its PNR, takes their request',
    requestsFor([{ id: 'a', ticketNo: 'H692FC', pnr: 'H692FC', source: 'FlyAdeal DXB' }], [f3row]).map(f => [f.req, f.how]), [['KSAML2706', 'flyadeal PNR']]);
  check('any other vendor still only by number',
    requestsFor([{ id: 'a', ticketNo: 'H692FC', pnr: 'H692FC', source: 'IATA BSP' }], [f3row]), []);
  check('and its name and cabin too',
    detailsFor([{ id: 'a', ticketNo: 'H692FC', pnr: 'H692FC', source: 'FlyAdeal DXB', passengerName: '', cabinClass: '', route: 'RUH/JED' }],
      [{ serials: ['9152641826'], ticket_cell: '5609152641826', status: 'Issued', client_name: 'ZAKI ATTAR', cabin: 'Economy', pnr: 'H692FC', portal: 'F3', airline: 'Flyadeal', sheet_row: {} }])
      .map(f => [f.field, f.value]), [['passenger_name', 'ZAKI ATTAR'], ['cabin_class', 'ECONOMY']]);
}

console.log('\n8. Names, cabins and routes we lack are filled, by number, without asking');
{
  const live = (o: any) => ({ serials: ['5513427739'], ticket_cell: '065-5513427739', status: 'Issued', client_name: 'SALEEM KHADER ELDADAH',
    cabin: 'Economy', sheet_row: { 'Origin Airports (from Aviation Quotations)': 'RUH', 'Destination Airports (from Aviation Quotations)': 'JED,DMM' }, ...o });
  const ours = (o: any = {}) => [{ id: 't', ticketNo: '5513427739', passengerName: '', cabinClass: '', route: '', ...o }];
  const fills = (o: any, rows: any[]) => detailsFor(ours(o), rows).map(f => [f.field, f.value]);
  check('name, cabin and route', fills({}, [live({})]), [['passenger_name', 'SALEEM KHADER ELDADAH'], ['cabin_class', 'ECONOMY'], ['route', 'RUH/JED']]);
  check('nothing already there is touched', fills({ passengerName: 'X', cabinClass: 'BUSINESS', route: 'RUH/LHR' }, [live({})]), []);
  check('no name from a cell of two tickets', fills({}, [live({ serials: ['5513427739', '5513427740'], ticket_cell: '065-5513427739\n065-5513427740' })]).map(f => f[0]), ['cabin_class', 'route']);
  check('two rows giving two cabins: none', fills({}, [live({}), live({ cabin: 'Business' })]).map(f => f[0]), ['passenger_name', 'route']);
  check('never by booking: a ticket their sheet does not name gets nothing', fills({ ticketNo: '5513427799' }, [live({})]), []);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
