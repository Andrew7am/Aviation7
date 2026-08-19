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

  // Ibtekar's own ledger runs "balance = prev + debit - credit" (verified
  // row-by-row against their raw sheet): issuance (debit) moves the number
  // toward positive, top-ups/refunds (credit) push it further negative.
  // Combined with the "negative = good" display flip in VendorBalances.tsx,
  // this is what makes issuance reduce the on-screen balance and refunds and
  // top-ups raise it. Every other vendor uses initial + topUps - issued.
  if (vendor.vendorName.trim().toLowerCase() === 'ibtekar') {
    return vendor.initialBalance - topUpTotal + issued;
  }
  return vendor.initialBalance + topUpTotal - issued;
}
