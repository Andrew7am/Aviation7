/**
 * Ticket identity — the airline code must never live inside the ticket number,
 * and must never be invented when the report did not state it.
 */
import { splitTicketNo, formatTicketNo, ticketMatchKey } from '../src/core/helpers/ticketIdentity';

let pass = 0, fail = 0;

function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}\n          got  ${g}\n          want ${w}`); fail++; }
}

const split = (raw: string, code?: string) => {
  const r = splitTicketNo(raw, code);
  return `${r.ticketNo}|${r.airlineCode}`;
};

console.log('\n1. The 13-digit joined form splits into serial + airline');
eq('portal ticket 2352540225922', split('2352540225922'), '2540225922|235');
eq('NSA ticket 0655513059068',    split('0655513059068'), '5513059068|065');
eq('leading-zero code kept as 3 chars', split('0771234567890'), '1234567890|077');

console.log('\n2. The dashed form splits the same way');
eq('"065 - 5513059068"', split('065 - 5513059068'), '5513059068|065');
eq('en-dash "065–5513059068"', split('065–5513059068'), '5513059068|065');

console.log('\n3. A bare 10-digit serial carries NO airline information');
eq('BSP serial alone -> blank code', split('5513059068'), '5513059068|');
eq('the 551 bug: never scavenge from the serial', splitTicketNo('5511323126').airlineCode, '');
eq('...even when it looks like a code', splitTicketNo('2359999999').airlineCode, '');

console.log('\n4. An explicit A/L column is authoritative');
eq('BSP serial + A/L 065', split('5513059068', '065'), '5513059068|065');
eq('A/L wins over the embedded prefix', split('2352540225922', '065'), '2540225922|065');
eq('junk in the A/L column is ignored', split('2352540225922', 'TK'), '2540225922|235');
eq('blank A/L falls back to the prefix', split('2352540225922', ''), '2540225922|235');

console.log('\n5. Non-standard identifiers pass through untouched');
eq('PNR', split('SF4JXT'), 'SF4JXT|');
eq('LCC reference', split('ZB3KO9'), 'ZB3KO9|');
eq('top-up placeholder', split('FUND_1712345678'), 'FUND_1712345678|');
eq('empty', split(''), '|');
eq('11-digit oddity left alone', split('12345678901'), '12345678901|');

console.log('\n6. The portal row and its BSP line now agree');
const portal = splitTicketNo('2352540225922');            // Turkish portal export
const bsp    = splitTicketNo('2540225922', '235');        // BSP invoice line
eq('same ticket number', portal.ticketNo, bsp.ticketNo);
eq('same airline code',  portal.airlineCode, bsp.airlineCode);
eq('match key agrees across spellings',
   ticketMatchKey('2352540225922') === ticketMatchKey('2540225922'), true);

console.log('\n7. Display form rebuilds the full document number');
eq('serial + code', formatTicketNo('2540225922', '235'), '235-2540225922');
eq('no code -> bare serial', formatTicketNo('2540225922', ''), '2540225922');
eq('PNR unchanged', formatTicketNo('SF4JXT', '235'), 'SF4JXT');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
