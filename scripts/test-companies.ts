/**
 * Whose ticket it is, and each company's work.
 *
 * The company comes off the team's Airtable (their "MICE Account"). These
 * hold the rules the Companies screen and the All Tickets column rest on.
 */
import { companyIndex, companyOf, companyLabel, companySummaries, type CompanyRow } from '../src/core/helpers/companies';
import type { Ticket } from '../src/types';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const row = (o: Partial<CompanyRow>): CompanyRow => ({ serials: [], req_num: '', account: '', department: 'MICE Local', status: 'Issued',
  net_cost: 1000, currency: 'SAR', issued_at: null, pnr: '', ticket_cell: '', client_name: '', ...o });
const tkt = (o: Partial<Ticket>): Ticket => ({ id: Math.random().toString(36).slice(2), ticketNo: '', source: 'Ibtekar', date: '2026-10-01',
  amount: 1000, commission: 0, totalDoc: 1000, reqNum: '', status: 'ISSUE', currency: 'SAR', userId: 'u', reportName: 'Ibtekar', ...o });

console.log('\n1. A company, or the department when none is named');
check('the account', companyLabel({ account: 'Nestle', department: 'MICE Local' }), 'Nestle');
check('VIP names no company', companyLabel({ account: '', department: 'VIP' }), 'VIP (individuals)');
check('nothing at all', companyLabel({ account: '', department: '' }), 'No company');

console.log('\n2. A ticket is placed by its number, its refund\'s, or its request');
{
  const idx = companyIndex([
    row({ serials: ['4862141215'], req_num: 'KSAML2552', account: 'Allergen' }),
    row({ serials: ['5513427702'], req_num: 'KSAML2325', account: 'Nestle' }),
    row({ serials: ['5512970091', '5512970092'], req_num: 'UAEVP420', account: '', department: 'VIP' }),
  ]);
  check('by its number', companyOf(tkt({ ticketNo: '065-4862141215' }), idx), 'Allergen');
  check('a refund application by the ticket it refunds', companyOf(tkt({ ticketNo: '0079533084', relatedTicket: '5513427702' }), idx), 'Nestle');
  check('an EMD their sheet does not list, by its request', companyOf(tkt({ ticketNo: '1930576246', reqNum: 'KSAML2552' }), idx), 'Allergen');
  check('a combined request finds its part', companyOf(tkt({ ticketNo: '1', reqNum: 'KSAML43-KSAML2325' }), idx), 'Nestle');
  check('VIP by its request', companyOf(tkt({ ticketNo: '5513013142', reqNum: 'UAEVP420' }), idx), 'VIP (individuals)');
  check('nothing says', companyOf(tkt({ ticketNo: '9999999999', reqNum: 'SA1' }), idx), '');
}

console.log('\n3. Each company\'s work');
{
  const rows = [
    row({ serials: ['4862141215'], req_num: 'KSAML2552', account: 'Allergen' }),
    row({ serials: ['4862141216'], req_num: 'KSAML2552', account: 'Allergen' }),
    row({ serials: ['4862141217'], req_num: 'KSAML2552', account: 'Allergen' }),       // in nobody's books
    row({ serials: ['4862141218'], req_num: 'KSAML2552', account: 'Allergen', status: 'On Hold' }),
    row({ serials: ['4862141219'], req_num: 'KSAML2552', account: 'Allergen', status: 'Void' }),
    row({ serials: ['5513427702'], req_num: 'KSAML2325', account: 'Nestle', currency: 'AED' }),
  ];
  const ts = [
    tkt({ ticketNo: '4862141215', reqNum: 'KSAML2552', amount: 856.41, closed: true }),
    tkt({ ticketNo: '4862141216', reqNum: 'KSAML2552', amount: 856.41, reportName: 'Team sheet — reviewed' }),
    tkt({ ticketNo: '4862141215', reqNum: 'KSAML2552', amount: -500, status: 'REFUND' }),
    tkt({ ticketNo: '5513427702', reqNum: 'KSAML2325', amount: 2690, currency: 'AED', source: 'IATA BSP', reportName: 'IATA BSP' }),
    tkt({ ticketNo: 'TOPUP', amount: 5000, status: 'FUND' }),
  ];
  const s = companySummaries(ts, rows);
  const a = s.find(x => x.company === 'Allergen')!;
  check('two companies', s.map(x => x.company), ['Allergen', 'Nestle']);
  check('Allergen: two sales and a refund', [a.tickets, a.refunds], [2, 1]);
  check('net in riyals', a.money.SAR, { issued: 1712.82, refunds: -500, net: 1212.82 });
  check('billed by the supplier, recorded only from their sheet', [a.billed, a.recordedOnly], [2, 1]);
  check('in nobody\'s books - not the held or voided ones', [a.notInBooks, a.notInBooksRows.map(r => r.serials[0])], [1, ['4862141217']]);
  check('closed and open', [a.closed, a.open, a.openMoney.SAR], [1, 2, 356.41]);
  check('one request', a.requests, 1);
  check('Nestle in dirhams, never added to riyals', Object.keys(s.find(x => x.company === 'Nestle')!.money), ['AED']);
  check('a top-up is nobody\'s ticket', s.reduce((n, x) => n + x.tickets, 0), 3);
}

console.log('\n4. A request placed under a company by hand');
{
  // KSACO363 and KSACO379 are Sela's; their Airtable does not carry either.
  const rows = [row({ serials: ['4862000001'], req_num: 'KSACO363', account: '', department: 'Corporate' })];
  const idx = companyIndex(rows, [{ req_key: 'ksaco363', company: 'Sela - MICE' }, { req_key: 'KSACO379', company: 'Sela - MICE' }]);
  check('a ticket of the request', companyOf(tkt({ ticketNo: '4862999999', reqNum: 'KSACO379' }), idx), 'Sela - MICE');
  check('wins over what their sheet says', companyOf(tkt({ ticketNo: '4862000001', reqNum: 'KSACO363' }), idx), 'Sela - MICE');
  const s = companySummaries([tkt({ ticketNo: '4862999999', reqNum: 'KSACO379' })], rows, idx);
  check('their row is counted under it too', s.map(x => [x.company, x.tickets, x.notInBooks]), [['Sela - MICE', 1, 1]]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
