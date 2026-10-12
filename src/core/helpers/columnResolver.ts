/**
 * findHeaderRow — scans the first few rows of a parsed file to locate the
 * real header row, skipping vendor meta rows (report titles, date ranges,
 * agency info) that commonly sit above the actual column headers.
 */
export function findHeaderRow(rows: string[][], maxSearch = 15): number {
  const SIGNALS = [
    'ticketnumber', 'docnumber', 'seqno', 'paymentdate', 'recordlocator',
    'lponumber', 'customerno', 'referencecode', 'pnr2', 'invoiceno',
    'fileno', 'debit', 'pnr', 'ticket',
    // Emirates' sales report: "DocumentNumber", and its first data cell says "Ticket".
    'documentnumber', 'posdate',
    // Ibtekar's copy: its header says RecLoc, and its newer copy's first data
    // row says "ticket" in a Type column - taken for the header, it lost every row.
    'recloc',
  ];
  for (let i = 0; i < Math.min(rows.length, maxSearch); i++) {
    const rl = rows[i].map(c => (c || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
    if (SIGNALS.some(sig => rl.includes(sig))) return i;
  }
  return 0;
}
