/**
 * IATA numeric airline codes to carrier names.
 *
 * The numeric code is what a ticket carries — it is the first three digits of
 * the document number and what the BSP invoice prints in its A/L column — so
 * the code stays the identifier everywhere and the name is only ever a label
 * beside it.
 *
 * Supplied by the agency. Codes are written here as they are spoken (65, not
 * 065); airlineName() pads before looking up, because the ledger stores them
 * zero-padded to three digits.
 *
 * Deliberately partial. A code that is not listed shows as a bare code rather
 * than a guess — a wrong carrier name in an accounting report is worse than no
 * name at all, and this list is the agency's own, not an inferred one.
 */
const AIRLINE_NAMES: Record<number, { name: string; iata: string }> = {
  1:   { name: 'American Airlines',              iata: 'AA' },
  6:   { name: 'Delta Air Lines',                iata: 'DL' },
  14:  { name: 'Air Canada',                     iata: 'AC' },
  16:  { name: 'United Airlines',                iata: 'UA' },
  27:  { name: 'Alaska Airlines',                iata: 'AS' },
  44:  { name: 'Aerolineas Argentinas',          iata: 'AR' },
  47:  { name: 'TAP Air Portugal',               iata: 'TP' },
  53:  { name: 'Aer Lingus',                     iata: 'EI' },
  55:  { name: 'ITA Airways',                    iata: 'AZ' },
  57:  { name: 'Air France',                     iata: 'AF' },
  64:  { name: 'Czech Airlines',                 iata: 'OK' },
  65:  { name: 'Saudia',                         iata: 'SV' },
  71:  { name: 'Ethiopian Airlines',             iata: 'ET' },
  72:  { name: 'Gulf Air',                       iata: 'GF' },
  74:  { name: 'KLM',                            iata: 'KL' },
  75:  { name: 'Iberia',                         iata: 'IB' },
  76:  { name: 'Middle East Airlines',           iata: 'ME' },
  77:  { name: 'EgyptAir',                       iata: 'MS' },
  79:  { name: 'Philippine Airlines',            iata: 'PR' },
  80:  { name: 'LOT Polish Airlines',            iata: 'LO' },
  81:  { name: 'Qantas Airways',                 iata: 'QF' },
  82:  { name: 'Brussels Airlines',              iata: 'SN' },
  83:  { name: 'South African Airways',          iata: 'SA' },
  86:  { name: 'Air New Zealand',                iata: 'NZ' },
  96:  { name: 'Iran Air',                       iata: 'IR' },
  98:  { name: 'Air India',                      iata: 'AI' },
  108: { name: 'Icelandair',                     iata: 'FI' },
  114: { name: 'EL AL Israel Airlines',          iata: 'LY' },
  117: { name: 'SAS Scandinavian Airlines',      iata: 'SK' },
  124: { name: 'Air Algerie',                    iata: 'AH' },
  125: { name: 'British Airways',                iata: 'BA' },
  131: { name: 'Japan Airlines',                 iata: 'JL' },
  134: { name: 'Avianca',                        iata: 'AV' },
  139: { name: 'Aeromexico',                     iata: 'AM' },
  147: { name: 'Royal Air Maroc',                iata: 'AT' },
  157: { name: 'Qatar Airways',                  iata: 'QR' },
  160: { name: 'Cathay Pacific Airways',         iata: 'CX' },
  176: { name: 'Emirates',                       iata: 'EK' },
  180: { name: 'Korean Air',                     iata: 'KE' },
  205: { name: 'ANA All Nippon Airways',         iata: 'NH' },
  214: { name: 'Pakistan International Airlines', iata: 'PK' },
  220: { name: 'Lufthansa',                      iata: 'LH' },
  229: { name: 'Kuwait Airways',                 iata: 'KU' },
  232: { name: 'Malaysia Airlines',              iata: 'MH' },
  235: { name: 'Turkish Airlines',               iata: 'TK' },
  297: { name: 'China Airlines',                 iata: 'CI' },
  406: { name: 'UPS Airlines',                   iata: '5X' },
  555: { name: 'Aeroflot',                       iata: 'SU' },
  603: { name: 'SriLankan Airlines',             iata: 'UL' },
  607: { name: 'Etihad Airways',                 iata: 'EY' },
  618: { name: 'Singapore Airlines',             iata: 'SQ' },
  784: { name: 'China Southern Airlines',        iata: 'CZ' },
  932: { name: 'Virgin Atlantic',                iata: 'VS' },
  999: { name: 'Air China',                      iata: 'CA' },
};

/** The carrier's name, or '' when the code is not one we have been given. */
export function airlineName(code: string | undefined | null): string {
  const n = Number(String(code ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return '';
  return AIRLINE_NAMES[n]?.name ?? '';
}

/** The two-letter designator (TK, SV), or '' when unknown. */
export function airlineIata(code: string | undefined | null): string {
  const n = Number(String(code ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return '';
  return AIRLINE_NAMES[n]?.iata ?? '';
}
