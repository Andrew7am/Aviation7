/**
 * The vendors the app knows by name.
 *
 * These are the formats a report can be detected as, and the names the import
 * screen and the manual entry form offer. It is a convenience list, not a
 * closed set: a ticket can be recorded against any vendor the agency deals
 * with, whether or not it appears here and whether or not it holds a credit
 * wallet. Tickets are bought from vendors that never hold a balance — IATA
 * settles through BSP, Gold Medal invoices directly — so restricting entry to
 * wallet holders would make those tickets unrecordable.
 */
export const BUILTIN_SOURCES = [
  'IATA', 'NSA', 'FlyAdeal KSA', 'FlyAdeal DXB',
  'Flynas', 'FlyDubai', 'AirArabia', 'RTS', 'Ibtekar', 'Gold Medal',
  'Riyadh Air', 'Turkish Airlines',
];

/**
 * Every vendor worth offering: the built-in formats, the vendors holding a
 * credit wallet, and any vendor already present in the ledger — that last one
 * matters because a vendor entered by hand once should be one click away the
 * next time.
 *
 * Compared case-insensitively so "ibtekar" typed once does not become a second
 * vendor sitting beside "Ibtekar".
 */
export function knownSources(
  vendorNames: string[] = [],
  ledgerSources: string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [...BUILTIN_SOURCES, ...vendorNames, ...ledgerSources]) {
    const name = (s || '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}
