/**
 * extractRoute — pull an itinerary out of a cell that may hold one.
 *
 * Vendors put routes in three different shapes: a clean dedicated column
 * ("JED-RUH"), a multi-sector string ("RUH-LHR-RUH", "AHB/JED/MED/JED/AHB"),
 * or buried inside free text ("Dummy flight ticket ( DXB-MNL-DXB )"). The
 * same column also carries plenty of things that are NOT routes — invoice
 * references, "PENALTY FEE", flight briefs — and those must never be stored
 * as an itinerary.
 *
 * Returns the airport-code run if there is one, otherwise ''. Requiring at
 * least two 3-letter codes joined by - or / is what keeps ordinary words out:
 * a single "JED" on its own is not an itinerary.
 */
/** Separators seen across the vendors: "JED-RUH", "AHB/JED/MED" and — in
 *  Turkish's agency sales export — "JED\IST\BER\IST\JED". */
const ROUTE_RE = /[A-Z]{3}(?:\s*[\/\\-]\s*[A-Z]{3})+/;

export function extractRoute(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const m = s.toUpperCase().match(ROUTE_RE);
  // Backslashes are normalised to "-" so an itinerary reads the same however
  // the vendor happened to punctuate it. "/" is left alone: several vendors
  // already store routes that way and rewriting them would churn the ledger.
  return m ? m[0].replace(/\s+/g, '').replace(/\\/g, '-') : '';
}
