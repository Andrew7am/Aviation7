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
 * findExplicitReqColumn — matches ONLY an unambiguous, user-added
 * "Req Number" / "Request Number" / "Req Num" column. Deliberately excludes
 * the weaker vendor-specific signals findReqColumn() also accepts (File No,
 * PO Number, LPO Number, Reference) so that a Req column the user adds to a
 * report ALWAYS wins — in every vendor — without hijacking Ibtekar's File No
 * or Gold Medal's fixed layout when the user has NOT added one.
 *
 * This is what makes "add a Req Number column to any report and it's read
 * automatically" a reliable guarantee rather than a per-vendor coincidence.
 */
export function findExplicitReqColumn(headers: string[]): number {
  const norm = (c: string) => (c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const EXACT = new Set(['req', 'reqno', 'reqnum', 'reqnumber', 'requestno', 'requestnum', 'requestnumber']);
  const CONTAINS = ['reqnumber', 'requestnumber']; // multi-word, safe to substring-match
  const h = headers.map(norm);
  // exact match first (so a lone "REQ" column counts, without substring risk)
  let idx = h.findIndex(col => EXACT.has(col));
  if (idx !== -1) return idx;
  for (const sig of CONTAINS) {
    idx = h.findIndex(col => col.includes(sig));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * pickReqColumn — the standard req-column resolution every parser should use:
 * an explicit user-added Req column wins; otherwise fall back to the vendor's
 * own known aliases (passed in), then the broad findReqColumn() heuristic.
 * Returns -1 if nothing matches.
 */
export function pickReqColumn(
  headers: string[],
  vendorColIdx: number,
): number {
  const explicit = findExplicitReqColumn(headers);
  if (explicit !== -1) return explicit;
  if (vendorColIdx !== -1) return vendorColIdx;
  return findReqColumn(headers);
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
