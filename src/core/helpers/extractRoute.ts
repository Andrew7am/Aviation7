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
const ROUTE_RE = /[A-Z]{3}(?:\s*[\/\\-]\s*[A-Z]{3})+/g;

export function extractRoute(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const matches = s.toUpperCase().match(ROUTE_RE);
  if (!matches || matches.length === 0) return '';

  // One run is the common case: return it as written, only tidying spaces and
  // normalising backslashes so an itinerary reads the same however the vendor
  // punctuated it. "/" is left alone — several vendors already store routes
  // that way and rewriting them would churn the ledger.
  if (matches.length === 1) return matches[0].replace(/\s+/g, '').replace(/\\/g, '-');

  // Several runs means the vendor listed the journey a sector at a time —
  // RTS writes "MCT-RUH;RUH-MCT", Ibtekar "RUH-JED; JED-RUH". Read as one run
  // that would give only the outbound leg and lose the return, so the sectors
  // are stitched back into a single itinerary. Where one sector ends and the
  // next begins on the same airport it is written once, which turns the two
  // sectors above into MCT-RUH-MCT rather than MCT-RUH-RUH-MCT.
  const codes: string[] = [];
  for (const run of matches) {
    for (const code of run.split(/[^A-Z]+/).filter(Boolean)) {
      if (codes[codes.length - 1] !== code) codes.push(code);
    }
  }
  return codes.join('-');
}
