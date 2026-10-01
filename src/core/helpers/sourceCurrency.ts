const AED_KEYS = ['iata', 'rts', 'flyadeal dxb', 'air arabia', 'airarabia', 'flydubai', 'fly dubai', 'riyadh air', 'riyadhair', 'turkish', 'websales'];

export function sourceToCurrency(source: string): 'SAR' | 'AED' {
  const s = (source || '').toLowerCase();
  if (AED_KEYS.some(k => s.includes(k))) return 'AED';
  return 'SAR';
}

/**
 * The currency a TICKET is in: its own, as recorded, and the vendor's only
 * when it has none.
 *
 * `sourceToCurrency` answers a different question — what a vendor's wallet
 * is kept in — and the ticket list was using it for every row. So a JetBlue
 * ticket bought on the airline's site for 1,323.40 USD was shown, totalled
 * and exported as 1,323.40 SAR, because "Airline Website" is not one of the
 * AED vendors; 44 tickets read in the wrong currency that way.
 */
export function ticketCurrency(t: { currency?: string | null; source?: string | null }): string {
  const own = (t.currency || '').trim().toUpperCase();
  return own || sourceToCurrency(t.source || '');
}

/** Order for showing several currencies side by side. */
export const CURRENCY_ORDER = ['SAR', 'AED', 'USD', 'EUR'];
export const byCurrencyOrder = (a: string, b: string) => {
  const i = (c: string) => { const k = CURRENCY_ORDER.indexOf(c); return k < 0 ? 99 : k; };
  return i(a) - i(b) || a.localeCompare(b);
};
