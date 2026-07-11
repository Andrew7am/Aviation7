export function parseDate(raw: unknown): string {
  // Blank/unparseable input returns '' — NEVER "today". A "today" fallback
  // is non-deterministic: the same source row gets a different date every
  // time it's re-parsed, which silently breaks duplicate detection (dupKey
  // includes date) for any row with a missing date field — exactly the kind
  // of no-ticket/no-PNR placeholder row this happens to correlate with.
  if (raw === null || raw === undefined || raw === '') return '';
  const s = String(raw).trim();
  if (!s || s === '0') return '';

  // Excel serial
  const serial = Number(s);
  if (!isNaN(serial) && serial > 40000 && serial < 60000)
    return new Date((serial - 25569) * 86400000).toISOString().split('T')[0];

  // yyyy-MM-dd or ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (s.includes('T')) return s.split('T')[0];

  // dd-MMM or dd-MMM-yy / dd-MMM-yyyy
  if (/^\d{1,2}-[A-Za-z]{3}(-\d{2,4})?$/.test(s)) {
    const parts = s.split('-');
    const yr = parts[2] ? (parts[2].length === 2 ? `20${parts[2]}` : parts[2]) : new Date().getFullYear().toString();
    const d = new Date(`${parts[0].padStart(2,'0')}-${parts[1]}-${yr}`);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
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

  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback.toISOString().split('T')[0];
  return '';
}
