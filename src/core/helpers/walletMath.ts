import { VENDOR_ALIASES } from '../config/vendorAliases';
import type { VendorBalance, BalanceTopUp } from '../../types';

/**
 * Vendor↔ledger matching and balance arithmetic.
 *
 * Extracted from WalletService purely so these rules can be exercised outside
 * the browser: WalletService imports the Supabase client at module load, which
 * makes its business rules untestable in a plain Node script. The logic below
 * is unchanged and WalletService still exposes it under the same names, so
 * every existing call site behaves exactly as before.
 */

/** Match vendor to tickets by source name using alias table. */
export function vendorMatchesSource(vendorName: string, ticketSource: string): boolean {
  const vn  = vendorName.toLowerCase().trim();
  const src = ticketSource.toLowerCase().trim();
  if (!vn || !src) return false;
  const aliases = (VENDOR_ALIASES as Record<string, string[]>)[vn];
  if (aliases) return aliases.some(a => src.includes(a));
  return src.includes(vn) || vn.includes(src);
}

/**
 * Is this ticket drawn against the wallet, or was it settled before it opened?
 *
 * An opening balance is a statement about a moment: "as of this day, we hold
 * this much credit". Tickets issued before that day were paid for out of
 * whatever came before, and charging them again to a balance opened afterwards
 * double-counts them. Adding an IATA balance of 817,284.78 subtracted 1,884
 * historical tickets worth 6.29 million and reported the account five and a
 * half million in the red.
 *
 * No opening date means the wallet covers the whole ledger, which is what
 * every wallet did before this existed and what the ones opened alongside the
 * data still want.
 *
 * A ticket with no date cannot be shown to fall after the opening day, so a
 * dated wallet does not charge it. Every undated ticket left in this ledger is
 * old — the forty that remain are legacy rows, and the sales report parser now
 * dates everything it imports — so charging them to a balance opened later
 * would double-count exactly the sales that balance already accounts for.
 * A wallet with NO opening date still charges them, because it charges
 * everything.
 *
 * They are not lost: undatedCharged() counts them so a balance never quietly
 * omits money without saying so.
 */
export function drawsOnWallet(
  vendor: { openingDate?: string },
  ticketDate?: string,
): boolean {
  const from = (vendor.openingDate || '').trim();
  if (!from) return true;
  const d = (ticketDate || '').slice(0, 10);
  if (!d) return false;
  return d >= from;
}

/**
 * Tickets this wallet skipped for having no date — the figure that keeps the
 * rule above honest. A balance that silently drops rows is the same fault as
 * one that silently charges them twice.
 */
export function undatedSkipped(
  vendor: VendorBalance,
  tickets: { source: string; amount: number; status?: string; date?: string }[],
): { count: number; amount: number } {
  if (!(vendor.openingDate || '').trim()) return { count: 0, amount: 0 };
  const skipped = tickets.filter(t =>
    vendorMatchesSource(vendor.vendorName, t.source)
    && (t.status || '').toUpperCase() !== 'FUND'
    && !(t.date || '').slice(0, 10));
  return {
    count: skipped.length,
    amount: skipped.reduce((s, t) => s + t.amount, 0),
  };
}

/**
 * Recalculate a vendor balance from the ledger.
 *
 * Note what this does NOT do: it never looks at the settlement channel.
 * Matching is on `source` alone, and WEBSALES-EDIS rows carry source
 * 'IATA BSP' with the channel in its own column. So if an IATA wallet is ever
 * created, WEBSALES-EDIS would be drawn against it alongside BSP — and the two
 * settle separately in reality, so such a wallet would need a channel filter
 * here before it could be trusted. No IATA wallet exists today, which is why
 * the question has not had to be answered yet.
 */
export function calcVendorBalance(
  vendor: VendorBalance,
  tickets: { source: string; amount: number; status?: string; date?: string }[],
  topUps: BalanceTopUp[],
): number {
  const linked = tickets.filter(t => vendorMatchesSource(vendor.vendorName, t.source));
  const issued = linked
    .filter(t => (t.status || '').toUpperCase() !== 'FUND')
    .filter(t => drawsOnWallet(vendor, t.date))
    .reduce((s, t) => s + t.amount, 0);
  const topUpTotal = topUps
    .filter(tu => tu.vendorId === vendor.id)
    .reduce((s, tu) => s + tu.amount, 0);

  // One convention for every vendor: money paid in raises the balance, tickets
  // issued lower it, and a positive balance is credit the agency still holds.
  //
  // Ibtekar used to be special-cased to "initial - topUps + issued", mirroring
  // how Ibtekar's own sheet prints the running total (credit as a negative).
  // That inverted sign then had to be undone again in the display layer, and
  // the top-up dialog never got the memo — so it promised a HIGHER balance
  // while the arithmetic moved the number down. Topping up 200 made the
  // vendor look 200 further overdrawn.
  //
  // Ibtekar's opening balance is 0, so dropping the special case leaves the
  // number it produces identical in magnitude and meaning (an agency that owes
  // 3,896.52 reads as -3,896.52 here, and still shows red). What changes is
  // only that a top-up now adds, exactly as it does for everyone else. Reading
  // Ibtekar's own sheet is a presentation concern and belongs in the parser,
  // not in the balance arithmetic every vendor shares.
  return vendor.initialBalance + topUpTotal - issued;
}
