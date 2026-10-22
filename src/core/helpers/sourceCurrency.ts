const AED_KEYS = ['iata', 'rts', 'flyadeal dxb', 'air arabia', 'airarabia', 'flydubai', 'fly dubai', 'riyadh air', 'riyadhair', 'turkish', 'emirates', 'websales'];

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
  return vendorCurrency(t.source) ?? (own || sourceToCurrency(t.source || ''));
}

/**
 * The currency a vendor bills in, which every ticket of theirs is in - or
 * null where the ticket's own currency stands: a purchase on an airline's
 * website is in whatever the site charged (JetBlue, 1,323.40 USD).
 *
 * The user set it (22 Oct 2026): the vendor's currency, whatever a sheet or
 * a row says. Their team sheet had put NSA's refund of 4861731806 in AED,
 * and three RTS sales in SAR. A purchase in another currency is converted on
 * the way in and keeps that currency in originalCurrency, not here.
 *
 * The database holds the same rule (vendor_currency(), migration 0043), so a
 * row written by any path takes it. A vendor added to AED_KEYS goes there too.
 */
export function vendorCurrency(source?: string | null): 'SAR' | 'AED' | null {
  const s = (source || '').trim();
  if (!s || /^airline website$/i.test(s)) return null;
  return sourceToCurrency(s);
}

/** Order for showing several currencies side by side. */
export const CURRENCY_ORDER = ['SAR', 'AED', 'USD', 'EUR'];
export const byCurrencyOrder = (a: string, b: string) => {
  const i = (c: string) => { const k = CURRENCY_ORDER.indexOf(c); return k < 0 ? 99 : k; };
  return i(a) - i(b) || a.localeCompare(b);
};
