/**
 * A ticket found by what it cost.
 *
 * The figure to hand is usually off another document - a statement line, a
 * card charge, their sheet - and is typed however it was printed: "2,320.00",
 * "2320", sometimes negative for a refund. It is matched against the two
 * figures a row carries, what we pay (Balance Payable) and the fare, as sizes:
 * a refund of 2,320 is found by 2320 as well.
 *
 *   2,320.50    that exact figure, to the halala
 *   2320        any figure whose whole part is 2320 (2,320.00 and 2,320.50)
 *   1000-2000   anything from 1,000 to 2,000 inclusive
 *
 * Anything that is not one of those matches nothing, rather than everything.
 */
export function costMatches(query: string, figures: (number | null | undefined)[]): boolean {
  const q = (query || '').replace(/[,\s]/g, '').replace(/^[-−]/, '');
  if (!q) return true;
  const values = figures.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map(Math.abs);
  const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(q);
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    return values.some(v => v >= lo - 0.005 && v <= hi + 0.005);
  }
  if (!/^\d+(?:\.\d+)?$/.test(q)) return false;
  const n = Number(q);
  return q.includes('.')
    ? values.some(v => Math.abs(v - n) < 0.005)
    : values.some(v => Math.trunc(v + 1e-9) === n);
}
