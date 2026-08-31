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
  tickets: { source: string; amount: number; status?: string }[],
  topUps: BalanceTopUp[],
): number {
  const linked = tickets.filter(t => vendorMatchesSource(vendor.vendorName, t.source));
  const issued = linked
    .filter(t => (t.status || '').toUpperCase() !== 'FUND')
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
