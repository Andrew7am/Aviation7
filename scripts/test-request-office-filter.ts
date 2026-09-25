/**
 * Filtering the requests list by the office that raised it.
 *
 * Two things can go wrong here and neither one looks wrong on screen.
 *
 * The first is a request that belongs to no office. Seventy-odd req numbers
 * in this ledger are not office codes at all - ADM, ACM, VOID, CANXX, CREDIT
 * MEMO, a few people's names - and they carry real money. A filter with only
 * three buttons leaves them reachable from All and from nowhere else, which
 * is how a row stops being looked at.
 *
 * The second is the counts. A tab reading "Part closed 8" above a list of two
 * is worse than no number: the eight is true of the ledger and false of the
 * screen, and nothing tells you which was meant. So each row of tabs counts
 * what the other filters have already left.
 */
import {
  matchOffice, matchState, matchSearch, selectRequests, stateCounts, officeTabCounts,
  sheetName, type Facet,
} from '../src/components/Requests';
import { classifyOffice } from '../src/core/helpers/reqOffice';

let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

/** A request, with its office read the way the screen reads it. */
const req = (reqNum: string, state: Facet['state'], sources: string[] = ['NSA']): Facet =>
  ({ reqNum, state, sources, office: classifyOffice(reqNum) });

const LIST: Facet[] = [
  req('KSAML1452', 'PART'),
  req('KSACO0091', 'OPEN'),
  req('SA-2201',   'DONE'),
  req('UAEVP205',  'PART'),
  req('UAECO228',  'OPEN', ['Ibtekar']),
  req('REQ11662',  'DONE'),
  req('DXB4410',   'OPEN'),
  req('EGPML0770', 'OPEN'),
  req('ADM',       'OPEN'),
  req('CREDIT MEMO', 'DONE'),
];

console.log('\n1. Each office picks up its own req numbers');
{
  const of = (sel: Parameters<typeof matchOffice>[1]) =>
    LIST.filter(r => matchOffice(r, sel)).map(r => r.reqNum);
  check('Saudi is KSA and SA',   of('SAUDI'), ['KSAML1452', 'KSACO0091', 'SA-2201']);
  check('Dubai is UAE, REQ, DXB', of('DUBAI'), ['UAEVP205', 'UAECO228', 'REQ11662', 'DXB4410']);
  check('Egypt is EGP',          of('EGYPT'), ['EGPML0770']);
  check('All is everything',     of('ALL').length, LIST.length);
}

console.log('\n2. A request belonging to no office is still reachable');
{
  // The one that would go missing if the filter had three buttons.
  const none = LIST.filter(r => matchOffice(r, 'NONE')).map(r => r.reqNum);
  check('ADM and CREDIT MEMO have their own bucket', none, ['ADM', 'CREDIT MEMO']);
  check('and they are in none of the three offices',
    (['DUBAI', 'SAUDI', 'EGYPT'] as const)
      .flatMap(o => LIST.filter(r => matchOffice(r, o)))
      .filter(r => none.includes(r.reqNum)).length, 0);
  // Every request lands in exactly one bucket, so nothing is lost or doubled.
  const buckets = (['DUBAI', 'SAUDI', 'EGYPT', 'NONE'] as const)
    .map(o => LIST.filter(r => matchOffice(r, o)).length);
  check('the buckets add up to the whole list',
    buckets.reduce((a, b) => a + b, 0), LIST.length);
}

console.log('\n3. Office and state narrow together, not instead of each other');
{
  const names = (only: Parameters<typeof matchState>[1], office: Parameters<typeof matchOffice>[1]) =>
    selectRequests(LIST, only, office, '').map(r => r.reqNum);
  check('Saudi + part closed',  names('PART', 'SAUDI'), ['KSAML1452']);
  check('Dubai + not closed',   names('OPEN', 'DUBAI'), ['UAECO228', 'DXB4410']);
  check('Egypt + closed is empty', names('DONE', 'EGYPT'), []);
  check('all + all is the list', names('ALL', 'ALL').length, LIST.length);
}

console.log('\n4. Search still applies on top of both');
{
  check('a req number', selectRequests(LIST, 'ALL', 'ALL', 'ksaml').map(r => r.reqNum),
    ['KSAML1452']);
  check('a supplier',   selectRequests(LIST, 'ALL', 'ALL', 'ibtekar').map(r => r.reqNum),
    ['UAECO228']);
  check('a supplier inside one office',
    selectRequests(LIST, 'ALL', 'SAUDI', 'ibtekar').map(r => r.reqNum), []);
  check('untrimmed input is still matched', matchSearch(LIST[0], '  ksaml  '), true);
}

console.log('\n5. Each row of tabs counts what the others left');
{
  // The whole ledger.
  check('states across every office',
    stateCounts(LIST, 'ALL', ''), { ALL: 10, PART: 2, OPEN: 5, DONE: 3 });
  // Narrowed to Saudi: the state tabs must drop to Saudi's own figures, or
  // they promise rows the list below will not show.
  check('states within Saudi',
    stateCounts(LIST, 'SAUDI', ''), { ALL: 3, PART: 1, OPEN: 1, DONE: 1 });
  check('states within the unfiled group',
    stateCounts(LIST, 'NONE', ''), { ALL: 2, PART: 0, OPEN: 1, DONE: 1 });

  check('offices across every state',
    officeTabCounts(LIST, 'ALL', ''),
    { ALL: 10, DUBAI: 4, SAUDI: 3, EGYPT: 1, NONE: 2 });
  check('offices within not closed',
    officeTabCounts(LIST, 'OPEN', ''),
    { ALL: 5, DUBAI: 2, SAUDI: 1, EGYPT: 1, NONE: 1 });

  // The invariant that makes the numbers trustworthy: whatever a tab says,
  // clicking it produces exactly that many rows.
  for (const office of ['ALL', 'DUBAI', 'SAUDI', 'EGYPT', 'NONE'] as const)
    for (const only of ['ALL', 'PART', 'OPEN', 'DONE'] as const)
      check(`${office}/${only}: the tab's number is the list's length`,
        stateCounts(LIST, office, '')[only],
        selectRequests(LIST, only, office, '').length);
}

console.log('\nA request number as an Excel tab name');
{
  // Excel refuses : \ / ? * [ ] in a sheet name, caps it at 31
  // characters, and CORRUPTS a workbook that names two sheets the same —
  // silently, so the first anyone knows is a file that will not open.
  const fresh = () => new Set<string>();

  check('an ordinary one is itself', sheetName('KSAML2218', fresh()), 'KSAML2218');
  // A combined request is the normal shape here and must survive whole.
  check('a combined one survives',   sheetName('KSAML43-SA1157', fresh()), 'KSAML43-SA1157');

  for (const [raw, want] of [
    ['UAEVP420/SA1168', 'UAEVP420-SA1168'],
    ['REQ:2218',        'REQ-2218'],
    ['REQ*2218',        'REQ-2218'],
    ['REQ[2218]',       'REQ-2218-'],
    ['A\\B',             'A-B'],
    ['REQ?2218',        'REQ-2218'],
  ] as [string, string][])
    check(`"${raw}" is safe`, sheetName(raw, fresh()), want);

  // 31 characters, and not one more.
  const long = 'KSAML' + '1234567890'.repeat(4);
  check('a long one is cut to 31', sheetName(long, fresh()).length, 31);

  // TWO requests that differ only past the 31st character would collide,
  // and a collision loses a whole request's tickets.
  {
    const taken = fresh();
    const a = sheetName(long + 'AAA', taken);
    const b = sheetName(long + 'BBB', taken);
    check('the first is cut',        a.length, 31);
    check('the second differs',      a === b, false);
    check('and still fits',          b.length <= 31, true);
  }

  // The same request twice in one workbook — which the summary tab
  // already occupies, so the very first name can collide too.
  {
    const taken = new Set<string>(['SUMMARY']);
    check('Summary is not reused', sheetName('Summary', taken) === 'Summary', false);
  }
  {
    const taken = fresh();
    check('first',  sheetName('KSAML1', taken), 'KSAML1');
    check('second', sheetName('KSAML1', taken), 'KSAML1~2');
    check('third',  sheetName('KSAML1', taken), 'KSAML1~3');
  }

  // Case is not identity in Excel either: two tabs named ksaml1 and
  // KSAML1 are the same tab.
  {
    const taken = fresh();
    sheetName('KSAML1', taken);
    check('case does not make it new', sheetName('ksaml1', taken), 'ksaml1~2');
  }

  // Nothing at all still has to produce a usable name.
  check('an empty request', sheetName('', fresh()), 'REQUEST');
  check('and blanks',       sheetName('   ', fresh()), 'REQUEST');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
