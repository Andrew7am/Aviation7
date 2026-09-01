/**
 * resolveCurrency — single source of truth for currency detection
 * Searches: Currency, Curr, Account Currency, Booking Currency, Total Currency
 * Falls back to selected/default currency
 */
export type SupportedCurrency = 'SAR' | 'AED' | 'USD' | 'EUR';

export function resolveCurrency(
  row: string[],
  headers: string[],
  defaultCurrency: SupportedCurrency = 'SAR'
): SupportedCurrency {
  const CURRENCY_COLS = [
    'currency', 'curr',
    'accountcurrency', 'account currency',
    'bookingcurrency', 'booking currency',
    'totalcurrency', 'total currency',
  ];
  const h = headers.map(c => (c || '').toLowerCase().replace(/\s+/g, ''));
  for (const sig of CURRENCY_COLS) {
    const idx = h.findIndex(col => col === sig || col.includes(sig));
    if (idx !== -1) {
      const val = (row[idx] || '').trim().toUpperCase();
      if (['SAR', 'AED', 'USD', 'EUR'].includes(val)) return val as SupportedCurrency;
    }
  }
  return defaultCurrency;
}

