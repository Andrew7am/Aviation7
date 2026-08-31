/**
 * Ticket identity — the single place that decides what a "ticket number" is.
 *
 * A standard IATA document number is 3-digit airline code + 10-digit serial:
 *
 *     065 5513059068
 *     └┬┘ └────┬────┘
 *   airline   serial   ← the document's real identity
 *
 * Vendors disagree about which half they print. IATA BSP reports the bare
 * 10-digit serial with the airline in its own A/L column; the airline portals
 * (Turkish, NSA, RTS, Ibtekar, Riyadh Air) print all 13 digits joined. Storing
 * whatever the vendor happened to print means the SAME document arrives as
 * "2352540225899" from the portal and "2540225899" from BSP, so duplicate
 * detection and reconciliation — which key on the ticket string — never match
 * the two, and the week's BSP upload lands as a pile of brand-new tickets.
 *
 * So the ledger keeps ONE canonical form: `ticketNo` is always the 10-digit
 * serial, and the airline code lives only in `airlineCode`. Both spellings
 * above normalize to serial 2540225899 + airline 235, and they match.
 *
 * The other half of this is what NOT to do. The old code derived the airline
 * from the ticket with /^(\d{3})\d{7,}/, which on a BARE 10-digit serial
 * happily returns the serial's own first three digits — that is where the
 * ~1,400 rows stamped airline "551" came from (551 is not an airline; it is
 * how Saudia serials begin). A 10-digit serial carries no airline information
 * at all, so when there is no explicit code column the answer is '' — an
 * honest blank, never a guess.
 */

export interface TicketIdentity {
  /** Document serial WITHOUT the airline prefix — 10 digits for a standard
   *  IATA document. Non-standard identifiers (PNRs, LCC references,
   *  placeholders) are returned unchanged. */
  ticketNo: string;
  /** 3-digit numeric IATA airline code, or '' when it cannot be known. */
  airlineCode: string;
}

/** "065 - 5513059068" / "065–5513059068" — airline and serial, separated. */
const SPLIT_FORM = /^(\d{3})\s*[-–—]\s*(\d{10})$/;
/** "0655513059068" — the two halves run together. */
const JOINED_FORM = /^(\d{3})(\d{10})$/;
/** "5513059068" — the serial on its own, as BSP prints it. */
const BARE_SERIAL = /^\d{10}$/;

const isAirlineCode = (s: string): boolean => /^\d{3}$/.test(s);

/**
 * Split a raw vendor ticket value into its serial and airline halves.
 *
 * @param raw            whatever the vendor's ticket/document column held
 * @param explicitCode   a 3-digit code read from the report's own airline
 *                       column (BSP "A/L"). Authoritative when present — it is
 *                       stated data rather than something inferred from digits.
 */
export function splitTicketNo(raw: string, explicitCode?: string): TicketIdentity {
  const s = (raw || '').replace(/\s+/g, '').toUpperCase();
  const stated = isAirlineCode((explicitCode || '').trim()) ? (explicitCode as string).trim() : '';

  if (!s) return { ticketNo: '', airlineCode: stated };

  // Re-check the dashed form against the ORIGINAL string: stripping whitespace
  // above leaves the dash intact, so "065 - 5513059068" is still matchable.
  const dashed = (raw || '').trim().match(SPLIT_FORM);
  if (dashed) return { ticketNo: dashed[2], airlineCode: stated || dashed[1] };

  const joined = s.match(JOINED_FORM);
  // Prefer the stated code, but split positionally either way — the last 10
  // digits are the serial regardless of which airline claims the document.
  if (joined) return { ticketNo: joined[2], airlineCode: stated || joined[1] };

  // A bare serial says nothing about its airline. Only the explicit column can.
  if (BARE_SERIAL.test(s)) return { ticketNo: s, airlineCode: stated };

  // PNRs, LCC references, FUND_/NOREF_ placeholders, and any malformed length
  // pass through untouched — inventing structure here would corrupt them.
  return { ticketNo: s, airlineCode: stated };
}

/** The canonical serial for a raw vendor ticket value. */
export function toSerial(raw: string, explicitCode?: string): string {
  return splitTicketNo(raw, explicitCode).ticketNo;
}

/** The airline code for a raw vendor ticket value, or '' when unknowable. */
export function toAirlineCode(raw: string, explicitCode?: string): string {
  return splitTicketNo(raw, explicitCode).airlineCode;
}

/**
 * Display form — how a full document number reads on a report or an export:
 * "065-5513059068". Falls back to the bare serial when the airline is unknown.
 */
export function formatTicketNo(ticketNo: string, airlineCode?: string): string {
  const code = (airlineCode || '').trim();
  if (!isAirlineCode(code) || !BARE_SERIAL.test(ticketNo)) return ticketNo;
  return `${code}-${ticketNo}`;
}

/**
 * Matching key for comparing documents ACROSS vendors — the serial alone.
 * A portal row and its BSP invoice line agree on the serial and that is the
 * only half both are guaranteed to print.
 */
export function ticketMatchKey(ticketNo: string): string {
  const s = (ticketNo || '').replace(/\s+/g, '').toUpperCase();
  const joined = s.match(JOINED_FORM);
  return joined ? joined[2] : s;
}
