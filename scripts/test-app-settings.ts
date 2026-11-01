/**
 * The Settings screen's settings, read by the rules (app_settings, 0047):
 * which vendor a portal of the team's sheet is, which vendors bill on a
 * statement against a wallet, which office a request number belongs to, and
 * the Emirates limit - and the built-in rules for anything they do not name.
 */
import { applyAppSettings } from '../src/core/config/appSettings';
import { portalSource, settlesOnStatement } from '../src/core/config/teamPortals';
import { classifyOffice } from '../src/core/helpers/reqOffice';
import { EMIRATES_IATA } from '../src/core/helpers/airlineLimit';
import { sourceToCurrency } from '../src/core/helpers/sourceCurrency';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. Nothing set: the built-in rules');
applyAppSettings([]);
check('Ibtkar RUH is Ibtekar, held back', [portalSource('Ibtkar RUH').source, portalSource('Ibtkar RUH').heldBack], ['Ibtekar', true]);
check('an unknown portal is nobody', portalSource('Saudia Portal').source, '');
check('KSAML is Saudi, SA is Saudi, UAEVP Dubai', [classifyOffice('KSAML2771'), classifyOffice('SA1157'), classifyOffice('UAEVP771')], ['SAUDI', 'SAUDI', 'DUBAI']);
check('an unknown series is no office', classifyOffice('QAML100'), '');

console.log('\n2. Set on the Settings screen');
applyAppSettings([
  { key: 'vendors', value: [{ name: 'Saudia Direct', currency: 'SAR', onStatement: true }, { name: 'Ibtekar', currency: 'SAR', onStatement: false }] },
  { key: 'portals', value: [{ word: 'Saudia Portal', source: 'Saudia Direct' }, { word: 'XY', source: 'Saudia Direct' }] },
  { key: 'offices', value: { DUBAI: ['QA'], EGYPT: ['SAX'] } },
  { key: 'airline_limits', value: [{ airlineCode: '176', airline: 'Emirates', limit: 500000, warnAt: 480000, currency: 'AED', weekFrom: '2026-10-25' }] },
]);
check('a new portal names its vendor', portalSource('Saudia Portal (RUH)').source, 'Saudia Direct');
check('and a vendor set to bill on a statement is held back', portalSource('Saudia Portal').heldBack, true);
check('a word set here is read before the built-in one', portalSource('XY').source, 'Saudia Direct');
check('Ibtekar set not to bill on a statement is not held back', [settlesOnStatement('Ibtekar'), portalSource('Ibtkar RUH').heldBack], [false, false]);
check('NSA keeps the built-in rule', settlesOnStatement('NSA'), true);
check('an added prefix names its office', classifyOffice('QAML100'), 'DUBAI');
check('the longest prefix is read first: SAX is not SA', [classifyOffice('SAX12'), classifyOffice('SA1157')], ['EGYPT', 'SAUDI']);
check('KSA is still Saudi', classifyOffice('KSAML2771'), 'SAUDI');
check('the Emirates limit follows the setting', [EMIRATES_IATA.limit, EMIRATES_IATA.warnAt, EMIRATES_IATA.weekFrom], [500000, 480000, '2026-10-25']);
check('a vendor\'s currency follows the setting', sourceToCurrency('Saudia Direct'), 'SAR');

console.log('\n3. Cleared again');
applyAppSettings([{ key: 'vendors', value: [] }, { key: 'portals', value: [] }, { key: 'offices', value: {} }]);
check('back to the built-in rules', [portalSource('XY').source, settlesOnStatement('Ibtekar'), classifyOffice('QAML100')], ['Flynas', true, '']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
