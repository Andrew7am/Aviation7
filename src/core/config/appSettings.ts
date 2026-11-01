/**
 * Settings an admin changes on the Settings screen (app_settings, 0047).
 *
 * Held here once loaded, and read by the rules that used to carry them in
 * the code: a vendor's currency (sourceCurrency.ts), the vendors offered in
 * every vendor list (sources.ts), an airline's weekly limit (airlineLimit.ts).
 * Until they load, and for anything they do not name, the built-in rules
 * stand - so a screen drawn before the load is right for every vendor the
 * code already knows.
 *
 * Pure: no network. AppSettingsService reads and writes the table.
 */

export type VendorCurrencyCode = 'SAR' | 'AED' | 'USD' | 'EUR';
export interface VendorSetting { name: string; currency: VendorCurrencyCode }

let vendors: VendorSetting[] = [];

/** The vendors set by hand, as the Settings screen saved them. */
export const configuredVendors = (): VendorSetting[] => vendors;

export function setConfiguredVendors(list: VendorSetting[]): void {
  vendors = list.filter(v => (v.name || '').trim()).map(v => ({ name: v.name.trim(), currency: v.currency }));
}

/** A vendor's currency as set by hand, if it was: matched on the whole name. */
export function configuredCurrency(source?: string | null): VendorCurrencyCode | null {
  const s = (source || '').trim().toLowerCase();
  if (!s) return null;
  return vendors.find(v => v.name.toLowerCase() === s)?.currency ?? null;
}
