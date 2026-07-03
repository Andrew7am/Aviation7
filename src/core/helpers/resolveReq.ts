/**
 * resolveReq — single source of truth for req num extraction
 * Rules: accept any text in the column, return empty ONLY if empty or "Need Req"
 */
export function resolveReq(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim().replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  if (s === 'NEEDREQ' || s === 'NEED REQ' || s === 'N/A' || s === '-' || s === '--' || s === 'NONE' || s === '0') return '';
  return s;
}

/**
 * findReqColumn — search headers for any req-related column name
 * Never use hardcoded column index
 */
export function findReqColumn(headers: string[]): number {
  const REQ_SIGNALS = [
    'req number', 'req. number', 'req num', 'reqnumber', 'reqnum',
    'request number', 'request no', 'requestnumber',
    'file no', 'file number', 'fileno',
    'po number', 'po no', 'ponumber',
    'lpo number', 'lpo no', 'lponumber',
    'reference', 'ref no', 'ref number',
  ];
  const h = headers.map(c => (c || '').toLowerCase().replace(/\s+/g, ''));
  for (const signal of REQ_SIGNALS) {
    const sig = signal.replace(/\s+/g, '');
    const idx = h.findIndex(col => col === sig || col.includes(sig));
    if (idx !== -1) return idx;
  }
  return -1;
}
