/**
 * Settings an admin changes on the Settings screen (app_settings, 0047).
 *
 * Held here once loaded, and read by the rules that used to carry them in
 * the code: a vendor's currency (sourceCurrency.ts), the vendors offered in
 * every vendor list (sources.ts), which vendors bill on a statement against
 * a wallet and which portal of the team's sheet is which vendor
 * (teamPortals.ts), the office a request belongs to (reqOffice.ts), an
 * airline's weekly limit (airlineLimit.ts). Until they load, and for
 * anything they do not name, the built-in rules stand - so a screen drawn
 * before the load is right for every vendor the code already knows.
 *
 * Loaded in the browser by AppSettingsService and on the server by the
 * Airtable sync, through the one applyAppSettings below. No network here.
 */
import { EMIRATES_IATA, type AirlineLimit } from '../helpers/airlineLimit';

export type VendorCurrencyCode = 'SAR' | 'AED' | 'USD' | 'EUR';
export interface VendorSetting {
  name: string;
  currency: VendorCurrencyCode;
  /** Bills on a statement and settles against a credit wallet: its tickets
   *  are never keyed by hand. Unset: the built-in rule (Ibtekar, NSA). */
  onStatement?: boolean;
}
/** A word in the team sheet's Portal column, and the vendor it means. */
export interface PortalSetting { word: string; source: string }
export type OfficeKey = 'SAUDI' | 'DUBAI' | 'EGYPT';
/** Request-number prefixes added to an office, beside the built-in ones. */
export type OfficeSetting = Partial<Record<OfficeKey, string[]>>;

let vendors: VendorSetting[] = [];
let portals: PortalSetting[] = [];
let offices: OfficeSetting = {};

/** The vendors set by hand, as the Settings screen saved them. */
export const configuredVendors = (): VendorSetting[] => vendors;
export const configuredPortals = (): PortalSetting[] => portals;
export const configuredOffices = (): OfficeSetting => offices;

export function setConfiguredVendors(list: VendorSetting[]): void {
  vendors = list.filter(v => (v.name || '').trim()).map(v => ({ ...v, name: v.name.trim() }));
}
export function setConfiguredPortals(list: PortalSetting[]): void {
  portals = list.filter(p => (p.word || '').trim() && (p.source || '').trim())
    .map(p => ({ word: p.word.trim(), source: p.source.trim() }));
}
export function setConfiguredOffices(o: OfficeSetting): void {
  offices = Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
    [k, [...new Set((v ?? []).map(x => x.trim().toUpperCase()).filter(Boolean))]]));
}

const byName = (source?: string | null) => {
  const s = (source || '').trim().toLowerCase();
  return s ? vendors.find(v => v.name.toLowerCase() === s) : undefined;
};

/** A vendor's currency as set by hand, if it was: matched on the whole name. */
export function configuredCurrency(source?: string | null): VendorCurrencyCode | null {
  return byName(source)?.currency ?? null;
}

/** Whether a vendor was set by hand to bill on a statement; undefined when not set. */
export function configuredOnStatement(source?: string | null): boolean | undefined {
  return byName(source)?.onStatement;
}

export interface LoadedSettings {
  vendors: VendorSetting[];
  airlineLimits: AirlineLimit[];
  portals: PortalSetting[];
  offices: OfficeSetting;
}

/** app_settings rows as settings, put where the rules read them. */
export function applyAppSettings(rows: { key: string; value: unknown }[]): LoadedSettings {
  const of = (k: string) => rows.find(r => r.key === k)?.value;
  const list = <T,>(v: unknown) => (Array.isArray(v) ? v as T[] : []);
  const s: LoadedSettings = {
    vendors: list<VendorSetting>(of('vendors')),
    airlineLimits: list<AirlineLimit>(of('airline_limits')),
    portals: list<PortalSetting>(of('portals')),
    offices: (of('offices') && typeof of('offices') === 'object' ? of('offices') : {}) as OfficeSetting,
  };
  setConfiguredVendors(s.vendors);
  setConfiguredPortals(s.portals);
  setConfiguredOffices(s.offices);
  // Emirates is the one limit the header shows; its figures come from here.
  const ek = s.airlineLimits.find(l => l.airlineCode === EMIRATES_IATA.airlineCode);
  if (ek) Object.assign(EMIRATES_IATA, ek);
  return s;
}
