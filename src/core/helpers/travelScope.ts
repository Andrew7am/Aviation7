/**
 * Domestic or international, decided by the itinerary.
 *
 * A ticket that never leaves Saudi Arabia is domestic; one that touches any
 * airport outside it is international. So the question is really "is every
 * airport on this route a Saudi one", and the only thing needed to answer it
 * is the list of Saudi airports — anything absent from that list is abroad,
 * which is what makes this hold for destinations nobody has flown yet.
 *
 * Derived from the route rather than stored. The route is already on the
 * ticket, so a stored copy would be a second version of the same fact, free to
 * drift the moment a route is corrected.
 */

/**
 * Every civil airport in Saudi Arabia, by IATA code.
 *
 * The twenty that appear in this ledger's own routes are here, plus the rest
 * of the country's airports so a first flight to Al-Ula or Neom is not
 * mistaken for an international one on the day it happens.
 *
 * Watch for the near-misses: SLL is Salalah in OMAN and DOH, BAH, AUH, MCT and
 * AMM are all Gulf neighbours — close by, and none of them domestic.
 */
export const SAUDI_AIRPORTS: ReadonlySet<string> = new Set([
  'RUH', // Riyadh — King Khalid
  'JED', // Jeddah — King Abdulaziz
  'DMM', // Dammam — King Fahd
  'MED', // Medina — Prince Mohammad bin Abdulaziz
  'AHB', // Abha
  'GIZ', // Jizan — King Abdullah bin Abdulaziz
  'ELQ', // Qassim — Buraidah
  'TUU', // Tabuk
  'HAS', // Hail
  'AQI', // Hafr Al-Batin — Al Qaisumah
  'AJF', // Al-Jouf — Sakaka
  'EAM', // Najran
  'TIF', // Taif
  'RAE', // Arar
  'URY', // Gurayat
  'BHH', // Bisha
  'YNB', // Yanbu
  'HOF', // Al-Ahsa — Hofuf
  'ABT', // Al-Baha
  'RAH', // Rafha
  'DWD', // Dawadmi
  'SHW', // Sharurah
  'ULH', // Al-Ula — Prince Abdul Majeed bin Abdulaziz
  'WAE', // Wadi Al-Dawasir
  'EJH', // Wedjh
  'NUM', // Neom Bay
  'TUI', // Turaif
  'KMX', // Khamis Mushait
  'ZUL', // Zilfi
  'SLF', // Sulayel
  'KMC', // King Khalid Military City
  'AKH', // Prince Sultan Air Base
  'GIZ', // (kept for readability alongside its neighbours)
]);

export type TravelScope = 'DOMESTIC' | 'INTERNATIONAL' | '';

/** Airport codes in a route, however the vendor punctuated it. */
function airportsIn(route: string): string[] {
  return (route || '').toUpperCase().split(/[^A-Z]+/).filter(p => p.length === 3);
}

/**
 * Classify an itinerary.
 *
 * Returns '' when the route says nothing — no route recorded, or a value with
 * no airport codes in it. That is deliberately not the same as "domestic": a
 * ticket whose itinerary is unknown must read as unknown, never quietly land
 * in whichever bucket happens to be the default.
 *
 * A single airport is not enough either. "JED" alone could be a leg of
 * anything, and one endpoint cannot tell you whether the other was abroad.
 */
export function classifyTravel(route: string | undefined | null): TravelScope {
  const codes = airportsIn(route || '');
  if (codes.length < 2) return '';
  return codes.every(c => SAUDI_AIRPORTS.has(c)) ? 'DOMESTIC' : 'INTERNATIONAL';
}

export const TRAVEL_LABEL: Record<Exclude<TravelScope, ''>, string> = {
  DOMESTIC:      'Domestic',
  INTERNATIONAL: 'International',
};
