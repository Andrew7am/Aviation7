/**
 * Domestic vs international, from the itinerary.
 *
 * The rule is only as good as the Saudi airport list, so the cases that matter
 * most are the near-misses — Gulf airports a few hundred miles away that are
 * emphatically not domestic — and the routes where the answer is unknown and
 * has to stay unknown rather than defaulting into a bucket.
 */
import { classifyTravel, SAUDI_AIRPORTS } from '../src/core/helpers/travelScope';

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

console.log('\n1. Every airport in Saudi Arabia — domestic');
for (const r of ['RUH/JED/RUH', 'DMM/JED/DMM', 'AHB/JED/AHB', 'MED/RUH', 'GIZ/JED/GIZ',
                 'ELQ/JED/ELQ', 'TUU/JED/TUU', 'HAS/JED/HAS', 'MED/DMM', 'AHB/RUH/AHB']) {
  eq(r, classifyTravel(r), 'DOMESTIC');
}

console.log('\n2. Any airport abroad — international');
for (const r of ['RUH/AMM/RUH', 'JED/IST/JED', 'JED/CAI/JED', 'RUH/LHR/RUH',
                 'RUH/IST/RUH', 'JED/IST/BCN/IST/JED', 'DMM/IST/BER/IST/DMM']) {
  eq(r, classifyTravel(r), 'INTERNATIONAL');
}

console.log('\n3. The near-misses — Gulf neighbours are NOT domestic');
for (const [r, why] of [
  ['RUH/SLL/RUH', 'SLL is Salalah, Oman'],
  ['JED/DOH/JED', 'Doha, Qatar'],
  ['RUH/BAH/RUH', 'Bahrain'],
  ['JED/AUH/JED', 'Abu Dhabi'],
  ['RUH/DXB/RUH', 'Dubai'],
  ['JED/MCT/JED', 'Muscat, Oman'],
  ['RUH/AMM/RUH', 'Amman, Jordan'],
] as [string, string][]) {
  eq(`${r} — ${why}`, classifyTravel(r), 'INTERNATIONAL');
}

console.log('\n4. Separators do not change the answer');
eq('slashes',      classifyTravel('RUH/JED/RUH'), 'DOMESTIC');
eq('dashes',       classifyTravel('RUH-JED-RUH'), 'DOMESTIC');
eq('backslashes',  classifyTravel('RUH\\JED\\RUH'), 'DOMESTIC');
eq('spaces',       classifyTravel('RUH JED RUH'), 'DOMESTIC');
eq('lower case',   classifyTravel('ruh/jed/ruh'), 'DOMESTIC');
eq('mixed abroad', classifyTravel('jed\\ist\\jed'), 'INTERNATIONAL');

console.log('\n5. Unknown stays unknown — never defaulted');
eq('no route',            classifyTravel(''), '');
eq('undefined',           classifyTravel(undefined), '');
eq('null',                classifyTravel(null), '');
eq('a lone backslash',    classifyTravel('\\'), '');
eq('free text',           classifyTravel('PENALTY FEE'), '');
eq('one airport only',    classifyTravel('JED'), '');
eq('  ...even a Saudi one', classifyTravel('RUH'), '');

console.log('\n6. The airport list itself');
eq('Salalah is not treated as Saudi', SAUDI_AIRPORTS.has('SLL'), false);
eq('Dubai is not', SAUDI_AIRPORTS.has('DXB'), false);
eq('Istanbul is not', SAUDI_AIRPORTS.has('IST'), false);
eq('Neom is', SAUDI_AIRPORTS.has('NUM'), true);
eq('Al-Ula is', SAUDI_AIRPORTS.has('ULH'), true);
eq('every code is three letters',
   [...SAUDI_AIRPORTS].every(c => /^[A-Z]{3}$/.test(c)), true);

console.log('\n7. The twenty codes this ledger actually uses');
{
  // Taken from the routes stored today; each must resolve the way the agency
  // would expect on a same-country trip.
  const inLedger = ['RUH','JED','DMM','AHB','MED','GIZ','ELQ','TUU','HAS','AQI',
                    'AJF','EAM','TIF','RAE','URY','BHH','YNB','HOF','ABT','RAH'];
  eq('all recognised as Saudi', inLedger.filter(c => !SAUDI_AIRPORTS.has(c)), []);
  eq('a trip between any two of them is domestic',
     inLedger.every(c => classifyTravel(`${c}/JED`) === 'DOMESTIC'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
