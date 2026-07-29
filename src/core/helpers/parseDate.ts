export function parseDate(raw: unknown): string {
  // Blank/unparseable input returns '' — NEVER "today". A "today" fallback
  // is non-deterministic: the same source row gets a different date every
  // time it's re-parsed, which silently breaks duplicate detection (dupKey
  // includes date) for any row with a missing date field — exactly the kind
  // of no-ticket/no-PNR placeholder row this happens to correlate with.
  if (raw === null || raw === undefined || raw === '') return '';
  const s = String(raw).trim();
  if (!s || s === '0') return '';

  // Excel serial. Lower bound is 10000 (1927) rather than 40000 so a genuine
  // old date survives — Ibtekar's export writes epoch dates, and 25569 is
  // exactly 1970-01-01. Bare small numbers ("1", "0", "2070") are NOT serials
  // in any real report and are left to fall through, so they can't be turned
  // into an invented date.
  const serial = Number(s);
  if (!isNaN(serial) && serial >= 10000 && serial < 60000)
    return new Date((serial - 25569) * 86400000).toISOString().split('T')[0];

  // yyyy-MM-dd or ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (s.includes('T')) return s.split('T')[0];

  // dd-MMM or dd-MMM-yy / dd-MMM-yyyy
  // Built as a literal yyyy-MM-dd string rather than via `new Date(...)`:
  // a non-ISO string like "23-Jul-2026" is parsed as LOCAL midnight, and
  // .toISOString() then shifts it back a day in every UTC+ timezone (the
  // agency runs at UTC+3, so every such date landed one day early).
  if (/^\d{1,2}-[A-Za-z]{3}(-\d{2,4})?$/.test(s)) {
    const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const parts = s.split('-');
    const mi = MONTHS.indexOf(parts[1].toLowerCase());
    if (mi !== -1) {
      const yr = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
      const day = parts[0].padStart(2, '0');
      if (Number(day) >= 1 && Number(day) <= 31) {
        return `${yr}-${String(mi + 1).padStart(2, '0')}-${day}`;
      }
    }
  }

  // MM/dd/yy or MM/dd/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    const yr = y.length === 2 ? `20${y}` : y;
    const parsed = new Date(`${yr}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }

  // dd/MM/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    const parsed = new Date(`${y}-${m}-${d}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }

  // Last resort. Whatever date the vendor wrote is kept EXACTLY as written,
  // however odd the year looks — Ibtekar's report genuinely contains
  // 1970-01-01 rows, and blanking them would hide a real data problem the
  // agency needs to see and chase with the vendor. A wrong-looking date on
  // screen is honest; a silently emptied one is not.
  //
  // The one thing not allowed is INVENTING a date: JS happily turns "1" into
  // 2001 and "2070" into the year 2070, so a bare number — which is never a
  // date in any of these reports — is rejected rather than parsed.
  if (/^-?\d+(\.\d+)?$/.test(s)) return '';
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback.toISOString().split('T')[0];
  return '';
}
