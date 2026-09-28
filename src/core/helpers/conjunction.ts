/**
 * The second coupon of a conjunction ticket is not a ticket.
 *
 * A long itinerary does not fit on one document, so the airline issues it on
 * two consecutive numbers — one passenger, one fare, two document numbers.
 * Their sheet writes it the way the industry does:
 *
 *     157-5511323226-27
 *
 * the first number in full, the second as its last two digits. The fare is
 * on the first. The second carries nothing of its own.
 *
 * But their sheet also puts a booking's whole value in one cell and names
 * every number in it, so a cell of 8,020 naming "157-5511323226-27 ,
 * 157-5511323228-29" reads as four tickets at 2,005 each when it is two
 * passengers. The review queue proposed the two second coupons as tickets of
 * their own, and confirming them would have recorded 4,010 against documents
 * that have no fare — beside the two first coupons already in the books at
 * 3,390 each. Across the queue, sixteen rows were exactly this: 42,617.
 */

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);

/* Only the very next number. "180-5512938088-92" is a run of five documents,
   and whether that is five passengers or not, their sheet does not say —
   so a run is left as the list of tickets it always was. */
const isNext = (first: string, second: string) => Number(second) === Number(first) + 1;

/**
 * The first coupon, when this document is the second coupon of a conjunction
 * the cell writes out. Null when it is not.
 *
 * Only the pattern their sheet actually uses — a full number followed by a
 * dash and the trailing digits of the next one. A plain list of numbers is
 * not a conjunction and is left alone.
 */
export function conjunctionFirst(ticketNo: string, cell: string): string | null {
  const me = serial(ticketNo);
  if (!me || !cell) return null;
  for (const hit of cell.matchAll(/(?:\d{3}-?)?(\d{10})-(\d{1,2})(?!\d)/g)) {
    const first = hit[1];
    const tail = hit[2].padStart(2, '0');
    const second = first.slice(0, 10 - tail.length) + tail;
    if (second === me && isNext(first, second)) return first;
  }
  return null;
}

/** How many passengers a cell really covers: a conjunction is one, not two. */
export function passengersInCell(cell: string): number {
  if (!cell) return 0;
  return [...cell.matchAll(/(?:\d{3}-?)?\d{10}(?:-\d{1,2}(?!\d))?/g)].length;
}

/** Every second coupon the cell writes out, by serial. */
export function secondCouponsIn(cell: string): Set<string> {
  const out = new Set<string>();
  if (!cell) return out;
  for (const hit of cell.matchAll(/(?:\d{3}-?)?(\d{10})-(\d{1,2})(?!\d)/g)) {
    const tail = hit[2].padStart(2, '0');
    const second = hit[1].slice(0, 10 - tail.length) + tail;
    if (isNext(hit[1], second)) out.add(second);
  }
  return out;
}
