/**
 * One file per request, in a zip, and what a file may be called.
 *
 * The export used to be one workbook with a tab per request, and a tab is
 * the better thing to read. But the file is not read where it is made — it
 * is taken apart and sent on, one request to whoever is chasing it, and a
 * tab cannot be sent. Handing operations a twenty-tab workbook to close
 * four tickets sends each of them the other nineteen requests as well.
 *
 * A file name is a different problem from a tab name. A tab is capped at 31
 * characters and forbids five specific characters. A file name has no
 * length problem here but must survive Windows, which forbids a different
 * set, silently drops a trailing dot or space, reserves device names like
 * CON and NUL outright, and — the one that actually loses data — compares
 * names case-insensitively. A zip holding KSAML1685.xlsx and
 * ksaml1685.xlsx extracts to ONE file on Windows, and the second quietly
 * replaces the first, so a request's tickets never reach anybody.
 */
import { requestFileName } from '../src/core/helpers/requestFileName';
import { sheetName } from '../src/components/Requests';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const fresh = () => new Set<string>();

console.log('\n1. An ordinary request keeps its own name');
{
  check('as itself', requestFileName('KSAML2218', fresh()), 'KSAML2218.xlsx');
  // A combined request is the normal shape here and must survive whole —
  // it is not truncated the way a tab name is.
  check('a combined one survives', requestFileName('KSAML43-SA1157', fresh()),
        'KSAML43-SA1157.xlsx');
  const long = 'KSAML' + '1234567890'.repeat(4);
  check('and a long one is NOT cut', requestFileName(long, fresh()), `${long}.xlsx`);
  check('  ...unlike the tab inside it', sheetName(long, fresh()).length, 31);
}

console.log('\n2. What Windows will not accept in a file name');
{
  for (const [raw, want] of [
    ['UAEVP420/SA1168', 'UAEVP420-SA1168.xlsx'],
    ['REQ:2218',        'REQ-2218.xlsx'],
    ['REQ*2218',        'REQ-2218.xlsx'],
    ['REQ?2218',        'REQ-2218.xlsx'],
    ['A\\B',            'A-B.xlsx'],
    ['REQ<2218>',       'REQ-2218-.xlsx'],
    ['REQ"2218',        'REQ-2218.xlsx'],
    ['REQ|2218',        'REQ-2218.xlsx'],
  ] as [string, string][])
    check(`"${raw}"`, requestFileName(raw, fresh()), want);

  // Square brackets are fine in a file name even though a tab forbids them,
  // so the two rules are genuinely different and one cannot stand in for
  // the other.
  check('brackets are allowed here', requestFileName('REQ[1]', fresh()), 'REQ[1].xlsx');
  check('  ...but not in a tab', sheetName('REQ[1]', fresh()), 'REQ-1-');
}

console.log('\n3. What Windows silently changes');
{
  // A trailing dot or space is dropped on save, which would turn a distinct
  // name into a collision nobody typed.
  check('a trailing dot goes', requestFileName('REQ12141.', fresh()), 'REQ12141.xlsx');
  check('a trailing space goes', requestFileName('REQ12141 ', fresh()), 'REQ12141.xlsx');
  {
    const taken = fresh();
    const a = requestFileName('REQ12141', taken);
    const b = requestFileName('REQ12141.', taken);
    check('and the two do not collide after it', a === b, false);
    check('  ...the second is marked', b, 'REQ12141 (2).xlsx');
  }
}

console.log('\n4. The names Windows reserves whatever the extension');
{
  // CON.xlsx cannot be written on Windows at all — the extraction fails or
  // the file is skipped, depending on the tool.
  check('CON', requestFileName('CON', fresh()), 'CON-request.xlsx');
  check('NUL', requestFileName('nul', fresh()), 'nul-request.xlsx');
  check('COM1', requestFileName('COM1', fresh()), 'COM1-request.xlsx');
  check('LPT9', requestFileName('LPT9', fresh()), 'LPT9-request.xlsx');
  // Not reserved, and must not be mangled.
  check('CONTRACT is not CON', requestFileName('CONTRACT', fresh()), 'CONTRACT.xlsx');
  check('COM10 is not reserved', requestFileName('COM10', fresh()), 'COM10.xlsx');
}

console.log('\n5. The collision that actually loses a request');
{
  // Windows file names are case-insensitive. These two are different
  // requests and must extract to two files.
  const taken = fresh();
  const a = requestFileName('KSAML1685', taken);
  const b = requestFileName('ksaml1685', taken);
  check('the first is plain', a, 'KSAML1685.xlsx');
  check('the second is not the same file', a.toUpperCase() === b.toUpperCase(), false);
  check('  ...and says which it is', b, 'ksaml1685 (2).xlsx');

  // The same request twice in one list.
  const t2 = fresh();
  check('first', requestFileName('UAEVP420', t2), 'UAEVP420.xlsx');
  check('second', requestFileName('UAEVP420', t2), 'UAEVP420 (2).xlsx');
  check('third', requestFileName('UAEVP420', t2), 'UAEVP420 (3).xlsx');
}

console.log('\n6. A request with no number still gets a file');
{
  // Tickets filed under nothing still have to reach somebody.
  check('empty', requestFileName('', fresh()), 'UNFILED.xlsx');
  check('whitespace', requestFileName('   ', fresh()), 'UNFILED.xlsx');
  check('only forbidden characters', requestFileName('///', fresh()), '---.xlsx');
  {
    const taken = fresh();
    requestFileName('', taken);
    check('and two of them do not collide', requestFileName('', taken), 'UNFILED (2).xlsx');
  }
}

console.log('\n7. The summary keeps its place at the top of the zip');
{
  // The export seeds `taken` with the summary's own name, so a request
  // that happens to be called that cannot overwrite it.
  const taken = new Set<string>(['_SUMMARY.XLSX']);
  check('a request named _Summary is moved aside',
        requestFileName('_Summary', taken), '_Summary (2).xlsx');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
