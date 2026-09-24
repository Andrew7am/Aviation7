/**
 * A cancelled BSP document must never reach the ledger as a sale.
 *
 *   npx tsx scripts/test-bsp-cancellations.ts
 *
 * BSP says what each document IS in a column whose name depends on which
 * export it came from: TRNC on the TJQ sales report, SERVICE on the
 * invoice. The invoice's column was never read, so every row from it
 * arrived with no transaction type and fell through to "negative is a
 * refund, positive is a sale".
 *
 * Refunds survived that, because BSP prints them negative. Cancellations
 * did not: a cancelled ticket keeps its full positive value on the
 * invoice, so three of them became live sales worth 10,740 AED — and two
 * carried the word "Void"/"CANXX" into the request column, where it sat
 * as a request nothing could ever be closed against.
 *
 * Built from the real column names: "Serial ", "Airline key",
 * "ticket number ", "total ", "tax ", "comm", "NET", "Pax Name ", "PNR ",
 * "Service ", "Req Number ".
 */
import { IATAParser } from '../src/core/parsers/IATAParser';
import { normalizeStatus } from '../src/core/helpers/normalizeStatus';
import { resolveReq } from '../src/core/helpers/resolveReq';

let passed = 0, failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`   ok   ${name}`); }
  else { failed++; console.log(`   FAIL ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

/** Their invoice export's own headers, spacing and all. */
const HEADERS = ['Serial ', 'Airline key', 'ticket number ', 'total ', 'tax ',
                 'comm', 'NET', 'Pax Name ', 'PNR ', 'Service ', 'Req Number '];
const run = (rows: string[][]) =>
  IATAParser.parse(rows, HEADERS, 'AED', 'IATA BSP', []);

console.log('\n1. The column BSP names the document type in');
{
  // The three real ones, exactly as they sit in the raw table.
  const { rows } = run([
    ['4413', '065', '5512129252', '3610', '', '', '3610', 'THAKA', 'Z8AMKI', 'canx', 'Void'],
    ['4700', '065', '5512369208', '3720', '', '', '3720', 'BONILLA', 'XX1111', 'canxx', 'UAECO210'],
    ['4701', '065', '5512369274', '3410', '', '', '3410', 'ELMORSSY', 'XX2222', 'canxx', 'canxx'],
  ]);
  check('all three are read',        rows.length, 3);
  check('every one is a void',       rows.map(r => r.status), ['VOID', 'VOID', 'VOID']);
  // A void settles at zero however big the document was, so it can never
  // move a balance. That is the whole point of reading the column.
  check('and settles at nothing',    rows.map(r => r.amount), [0, 0, 0]);
  // The document's face value is still kept, so the row can be recognised.
  check('the face value survives',   rows.map(r => r.totalDoc), [3610, 3720, 3410]);

  // The sale beside them is untouched.
  const sale = run([
    ['4414', '065', '5512129253', '2500', '', '100', '2400', 'AHMED', 'Z8AMKJ', 'TKTT', 'KSAML1276'],
  ]).rows;
  check('a TKTT is still a sale',    sale[0].status, 'ISSUE');
  check('at its net',                sale[0].amount, 2400);

  // And a refund is still a refund, which it was before this too - BSP
  // prints those negative, which is why they were never broken.
  const rfnd = run([
    ['4415', '065', '5512129254', '-3370', '', '', '-3370', 'SOLIMAN', 'Z8W7MG', 'RFND', 'KSAML1276'],
  ]).rows;
  check('an RFND is a refund',       rfnd[0].status, 'REFUND');
  check('stored negative',           rfnd[0].amount, -3370);
}

console.log('\n2. The wording BSP actually types');
{
  // Five real rows read "canxx" and one "canx". The doubled X was not in
  // the map, so those five came back UNKNOWN and were read by the amount.
  for (const w of ['canx', 'CANX', 'canxx', 'CANXX', 'Void', 'VOID', 'cann'])
    check(`"${w}" is a void`, normalizeStatus(w), 'VOID');
  check('TKTT is untouched',  normalizeStatus('TKTT'), 'ISSUE');
  check('RFND is untouched',  normalizeStatus('RFND'), 'REFUND');
  check('EMDS is untouched',  normalizeStatus('EMDS'), 'ISSUE');
}

console.log('\n3. A cancellation is not a request number');
{
  // Two of our ledger rows are filed under a request called "VOID" and
  // one under "CANXX". Nothing can ever be closed against those, and they
  // hid three cancelled tickets still sitting in the books as sales.
  for (const w of ['Void', 'VOID', 'canxx', 'CANX', 'cancelled', 'RFND'])
    check(`"${w}" is not a request`, resolveReq(w), '');

  check('a real request survives',   resolveReq(' ksaml1276 '), 'KSAML1276');
  check('and so does an odd one',    resolveReq('UAEVP420-SA1157'), 'UAEVP420-SA1157');
  check('NEED REQ is still empty',   resolveReq('Need Req'), '');
  check('and so is nothing',         resolveReq(''), '');
}

console.log('\n4. The invoice row that started this, end to end');
{
  // 5512129252: BSP cancelled it, the request column said "Void", and it
  // went into the ledger as a 3,610 sale filed under a request called
  // VOID. Everything about that row is asserted here.
  const [r] = run([
    ['4413', '065', '5512129252', '3610', '', '', '3610', 'THAKA', 'Z8AMKI', 'canx', 'Void'],
  ]).rows;
  check('void',              r.status, 'VOID');
  check('worth nothing',     r.amount, 0);
  check('no request',        r.reqNum, '');
  check('the ticket is kept', r.ticketNo, '5512129252');
  check('and the airline',   r.airlineCode, '065');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
