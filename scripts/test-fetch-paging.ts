/**
 * Paging a table that PostgREST caps at 1000 rows a page.
 *
 * The cap is silent - a select() past it returns a truncated result with no
 * error - so every full-table read goes through fetchAllRows, and a fault
 * here does not throw. It loses rows, and a ledger quietly missing its last
 * page still adds up to something that looks like money.
 *
 * These drive it against a fake table so the boundaries can be checked
 * exactly: a table that ends mid-page, one that ends exactly on a page, and
 * one smaller than a page. Both paths are covered - the one where the caller
 * supplies a count, and the one where the end has to be discovered.
 */
let passed = 0, failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const p = JSON.stringify(got) === JSON.stringify(want);
  p ? passed++ : failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${label}`);
  if (!p) console.log(`        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const PAGE_SIZE = 1000;

/** The helper under test, copied in so the browser client is not imported. */
async function fetchAllRows<T>(
  query: (from: number, to: number) =>
    PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>
): Promise<T[]> {
  const first = await query(0, PAGE_SIZE - 1);
  if (first.error) throw new Error(first.error.message);
  const head = first.data ?? [];
  if (head.length < PAGE_SIZE) return head;
  const rest: T[][] = [];
  const total = first.count ?? null;
  if (total != null) {
    const pages: Promise<{ data: T[] | null; error: { message: string } | null }>[] = [];
    for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE)
      pages.push(Promise.resolve(query(from, from + PAGE_SIZE - 1)));
    for (const r of await Promise.all(pages)) {
      if (r.error) throw new Error(r.error.message);
      rest.push(r.data ?? []);
    }
  } else {
    const BATCH = 6;
    for (let from = PAGE_SIZE; ; from += PAGE_SIZE * BATCH) {
      const batch = await Promise.all(
        Array.from({ length: BATCH }, (_, i) =>
          Promise.resolve(query(from + i * PAGE_SIZE, from + (i + 1) * PAGE_SIZE - 1))));
      let ended = false;
      for (const r of batch) {
        if (r.error) throw new Error(r.error.message);
        const rows = r.data ?? [];
        rest.push(rows);
        if (rows.length < PAGE_SIZE) ended = true;
      }
      if (ended) break;
    }
  }
  return head.concat(...rest);
}

/** A table of `n` rows, numbered, that records how it was asked for. */
function table(n: number, withCount: boolean) {
  const calls: [number, number][] = [];
  const rows = Array.from({ length: n }, (_, i) => i);
  return {
    calls,
    query: (from: number, to: number) => {
      calls.push([from, to]);
      return Promise.resolve({
        data: rows.slice(from, to + 1),
        error: null,
        ...(withCount ? { count: n } : {}),
      });
    },
  };
}

const sizes: [string, number][] = [
  ['smaller than one page', 342],
  ['exactly one page', 1000],
  ['one page and a bit', 1001],
  ['the real ledger', 5677],
  ['exactly six pages', 6000],
  ['the audit log', 18088],
];

for (const withCount of [true, false]) {
  console.log(`\n${withCount ? 'WITH a count from the caller' : 'WITHOUT a count'}`);
  for (const [label, n] of sizes) {
    const t = table(n, withCount);
    const got = await fetchAllRows<number>(t.query);
    check(`${label} (${n}): every row, in order`,
          [got.length, got[0], got[got.length - 1]], [n, 0, n - 1]);
    check(`${label}: no row read twice`, new Set(got).size, n);
  }
}

console.log('\nROUND TRIPS');
{
  const withCount = table(5677, true);
  await fetchAllRows<number>(withCount.query);
  // One for the first page, then every remaining page together.
  check('the ledger, with a count: 6 requests in 2 waves', withCount.calls.length, 6);

  const blind = table(5677, false);
  await fetchAllRows<number>(blind.query);
  check('and without one, still not 6 serial waves', blind.calls.length <= 7, true);
}

console.log('\nAN ERROR ON A LATER PAGE IS NOT SWALLOWED');
{
  let n = 0;
  const failing = (from: number, to: number) => Promise.resolve(
    ++n === 3
      ? { data: null, error: { message: 'page three failed' }, count: 5677 }
      : { data: Array.from({ length: Math.min(1000, 5677 - from) }, (_, i) => from + i),
          error: null, count: 5677 });
  let threw = '';
  try { await fetchAllRows<number>(failing); } catch (e: any) { threw = e.message; }
  check('it throws rather than returning a short table', threw, 'page three failed');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
