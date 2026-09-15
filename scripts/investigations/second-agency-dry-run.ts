/**
 * What happens if a second agency gets this app with only the name changed.
 *
 * Not an argument — a run. Four rows as a Jeddah agency would actually have
 * them, through the same functions the Dashboard, the ledger table and every
 * export call, with nothing altered but the company name.
 *
 * Each row is stored CORRECTLY. The database has the right currency, the file
 * said the right currency, the parser read the right currency. The wrong
 * answers below all come from code that decides things from the vendor's name.
 *
 *   npx tsx scripts/investigations/second-agency-dry-run.ts
 */
import { sourceToCurrency } from '../../src/core/helpers/sourceCurrency';
import { sourceForOffice } from '../../src/core/config/bspOffices';
import { classifyOffice, OFFICE_LABEL } from '../../src/core/helpers/reqOffice';

const m = (n: number) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A Jeddah agency: Saudi only, riyals only, its own consolidator and offices. */
const AGENCY_B = [
  { source: 'IATA BSP', req: 'JED-1041', amount: 18400, stored: 'SAR', office: 'JEDS4471K' },
  { source: 'IATA BSP', req: 'JED-1042', amount: 9250,  stored: 'SAR', office: 'JEDS4471K' },
  { source: 'Flynas',   req: 'JED-1043', amount: 3120,  stored: 'SAR', office: '' },
  { source: 'Turkish Airlines', req: 'JED-1044', amount: 7600, stored: 'SAR', office: '' },
];

console.log('='.repeat(84));
console.log('A SECOND AGENCY, WITH ONLY THE COMPANY NAME CHANGED');
console.log('='.repeat(84));
console.log('\nFour rows. Every one of them stored correctly, in riyals, as their file said.\n');

console.table(AGENCY_B.map(t => ({
  vendor: t.source,
  'req num': t.req,
  amount: m(t.amount),
  'stored as': t.stored,
  'the app shows': sourceToCurrency(t.source),
  wrong: sourceToCurrency(t.source) !== t.stored ? 'YES' : '',
  'office reads as': classifyOffice(t.req) ? OFFICE_LABEL[classifyOffice(t.req) as 'SAUDI'] : '(nothing)',
})));

const shown = (cur: string) =>
  AGENCY_B.filter(t => sourceToCurrency(t.source) === cur).reduce((n, t) => n + t.amount, 0);
const real = (cur: string) =>
  AGENCY_B.filter(t => t.stored === cur).reduce((n, t) => n + t.amount, 0);

console.log('What the Dashboard would add up, using the same code it uses today:\n');
console.log(`   SAR   the agency's books say   ${m(real('SAR')).padStart(12)}`);
console.log(`         the dashboard would show ${m(shown('SAR')).padStart(12)}`);
console.log(`   AED   the agency's books say   ${m(real('AED')).padStart(12)}`);
console.log(`         the dashboard would show ${m(shown('AED')).padStart(12)}`);

console.log('\nAnd their Riyadh-equivalent BSP office:');
const routed = sourceForOffice('JEDS4471K');
console.log(`   office JEDS4471K routes to: ${routed || '(nothing — falls through to the default vendor)'}`);
console.log(`   office RUHS228ZG routes to: ${sourceForOffice('RUHS228ZG')}   <- this agency's, still in the code`);

console.log('\n' + '='.repeat(84));
console.log('None of the above throws. None of it shows a warning. Every screen looks');
console.log('normal. That is the whole problem: a wrong answer that announces itself');
console.log('gets fixed on day one, and this kind gets found when a balance will not');
console.log('reconcile months later.');
console.log('='.repeat(84));
