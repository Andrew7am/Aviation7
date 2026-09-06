/**
 * Which vendor a BSP sales report (TJQ) belongs to, by the office that ran it.
 *
 * The agency pulls the same TJQ report from more than one BSP office, and the
 * report's columns are identical every time — only the header block differs:
 *
 *     Agy no  86219136   Report date range  31AUG   Currency  AED
 *     Office  DXBAD32AQ
 *
 *     Agy no  71220763   Report date range  01SEP-06SEP   Currency  SAR
 *     Office  RUHS228ZG
 *
 * Identical columns mean one parser reads both, and without this map the
 * second one would be filed under the first one's vendor: wrong wallet, and
 * wrong currency everywhere the source name decides it (see AED_KEYS in
 * sourceCurrency.ts, where anything matching "iata" is read as dirhams).
 *
 * The file states its own office, so that is what decides the vendor — not the
 * dropdown on the import screen, which is a person's memory and is wrong on
 * the day it is forgotten.
 *
 * Dubai (DXBAD32AQ) is deliberately absent. It is the parser's own default and
 * lands on IATA BSP with no help; listing it here would only take away the
 * import screen's ability to re-attribute one of those reports by hand.
 */
export const OFFICE_SOURCE: Record<string, string> = {
  // Riyadh. Ticketed through NSA, settled against NSA's credit wallet, and
  // denominated in riyals — the report says so in its own Currency field.
  RUHS228ZG: 'NSA',
};

/** The vendor an office belongs to, or '' when the office is not one we route.
 *  Blank means "leave it alone": the import screen's own choice still applies. */
export function sourceForOffice(office: string | undefined): string {
  return OFFICE_SOURCE[(office ?? '').trim().toUpperCase()] ?? '';
}
