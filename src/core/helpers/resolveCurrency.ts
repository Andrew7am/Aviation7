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
  // Most specific first. The currency has to describe the figure the parser
  // actually took, and these reports carry several: RTS states the original
  // fare in the customer's currency ("Fare currency": USD, GBP, SGD) and then
  // what it billed the agency in its own ("Total currency": AED). Searching
  // for a header merely CONTAINING "currency" found the fare's, so an amount
  // read from the AED total was filed as USD — eleven RTS tickets, 35,255 and
  // 18,860 counted against currencies the agency was never billed in. The
  // ones whose fare was in GBP or SGD came out right purely because those are
  // not currencies this ledger supports, so the search fell through to the
  // total.
  const CURRENCY_COLS = [
    'totalcurrency', 'grandtotalcurrency',
    'accountcurrency', 'bookingcurrency',
    'currency', 'curr',
  ];
  const h = headers.map(c => (c || '').toLowerCase().replace(/[^a-z]/g, ''));
  // A fare-leg currency describes the fare, not the amount billed, so it is
  // never the answer while any other candidate is on the row.
  const isFareCol = (col: string) => /^(fare|net|tax|misc|credit|national)/.test(col);

  for (const pass of [0, 1]) {
    for (const sig of CURRENCY_COLS) {
      for (let idx = 0; idx < h.length; idx++) {
        const col = h[idx];
        if (!(col === sig || col.includes(sig))) continue;
        if (pass === 0 && isFareCol(col)) continue;   // fare columns only on the second pass
        const val = (row[idx] || '').trim().toUpperCase();
        if (['SAR', 'AED', 'USD', 'EUR'].includes(val)) return val as SupportedCurrency;
      }
    }
  }
  return defaultCurrency;
}

