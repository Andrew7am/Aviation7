/**
 * An exchange is a sale, and an exchange that collects nothing is still a
 * document that exists.
 *
 * RTS writes "reissue" in its Action column. The shared status map did not
 * know the word, so it came back UNKNOWN, met a rule reading a zero total as
 * a cancellation, and five real tickets were discarded as voids — including
 * one the agency then searched for and could not find.
 */
import Papa from 'papaparse';
import { normalizeStatus, isVoidRow, statusToAmount } from '../src/core/helpers/normalizeStatus';
import { runParser } from '../src/core/parsers';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

console.log('\n1. The vendors\' words for an exchange');
{
  for (const w of ['reissue', 'REISSUE', 'Reissue', 'exchange', 'EXCH', 'revalidation', 'reval']) {
    check(`"${w}" is a sale`, normalizeStatus(w), 'ISSUE');
  }
  check('a cancellation is still a void', normalizeStatus('CANX'), 'VOID');
  check('a refund is still a refund',     normalizeStatus('RFND'), 'REFUND');
  check('a word nobody uses is unknown',  normalizeStatus('wibble'), 'UNKNOWN');
}

console.log('\n2. An exchange that collects nothing');
{
  check('is not a void',        isVoidRow({ status: 'ISSUE' }), false);
  check('and is worth nothing', statusToAmount(0, 'ISSUE'), 0);
}

console.log('\n3. The sheet that exposed it, read end to end');
{
  const HEAD = 'Record Locator,Passenger,Route,Date,req num,No,Carrier,Type,Action,Total,Commission';
  const csv = [
    HEAD,
    // A reissue collecting nothing — the case that was being dropped.
    'ZO8TOX,HUGHES ALBERT,ONT-ORD,9/13/26,,016-5513437053,UA,ticket,reissue,0,0',
    // A reissue collecting a difference.
    'Y2UVWT,KAIYYALAKKATH,SIN-MAA,9/11/26,UAECO716,618-5513436984,SQ,ticket,reissue,460,0',
    // An ordinary sale.
    'Y66FYZ,WEHBE TIARA,LHR-BEY,9/11/26,UAEVP705,076-5513436986,ME,ticket,issue,5280,0',
  ].join('\n');
  const grid = Papa.parse(csv, { skipEmptyLines: true }).data as string[][];
  const r = runParser(grid, 'RTS', 'AED', 'rts.xlsx');

  check('all three lines are read', r.rows.length, 3);
  check('the zero-collection reissue survives', r.rows[0]?.ticketNo, '5513437053');
  check('as a sale, not a void',                r.rows[0]?.status, 'ISSUE');
  check('worth nothing',                        r.rows[0]?.amount, 0);
  check('the paid reissue keeps its value',     r.rows[1]?.amount, 460);
  check('and the plain sale is untouched',      r.rows[2]?.amount, 5280);
  check('none of them is discarded',
        r.rows.filter(t => isVoidRow(t as any)).length, 0);
}

console.log('\n4. A genuine cancellation is still dropped');
{
  const HEAD = 'Record Locator,Passenger,Route,Date,req num,No,Carrier,Type,Action,Total,Commission';
  const csv = `${HEAD}\nZO8TOX,SOMEONE,ONT-ORD,9/13/26,,016-5513437099,UA,ticket,cancelled,0,0`;
  const grid = Papa.parse(csv, { skipEmptyLines: true }).data as string[][];
  const r = runParser(grid, 'RTS', 'AED', 'rts.xlsx');
  check('a cancellation reads as VOID', r.rows[0]?.status, 'VOID');
  check('and settles at zero',          r.rows[0]?.amount, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
