/**
 * The order the wallets are listed in on Vendor Credit, as an admin set it.
 *
 * The list on screen only. The wallets themselves stay in the order they are
 * read: a top-up is matched to the first wallet whose name fits, and moving a
 * row up the screen must not move anybody's money.
 */
export function orderWallets<T extends { id: string }>(wallets: T[], order: string[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]));
  // A wallet opened since the order was saved goes to the end, as it came.
  return wallets
    .map((w, i) => ({ w, k: at.get(w.id) ?? order.length + i }))
    .sort((a, b) => a.k - b.k)
    .map(x => x.w);
}

/** A copy with the item at `from` put at `to`; out of range changes nothing. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = list.slice();
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
}

/** Today where the user is, not in UTC: before 3 in the morning the two differ. */
export const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A day a payment can have been made on: a real one, and not yet to come. */
export const isPaymentDay = (d: string, today = localToday()): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d && d <= today;
