export type NormalizedStatus = 'ISSUE' | 'REFUND' | 'FUND' | 'ADM' | 'ACM' | 'UNKNOWN';

export function normalizeStatus(raw: unknown): NormalizedStatus {
  if (!raw) return 'UNKNOWN';
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const MAP: Record<string, NormalizedStatus> = {
    // ISSUE
    TKTT: 'ISSUE', ISSU: 'ISSUE', ISSUE: 'ISSUE', TICKETED: 'ISSUE',
    CONFIRMED: 'ISSUE', CLOSED: 'ISSUE', EMDA: 'ISSUE', EMDS: 'ISSUE',
    SALE: 'ISSUE', INVOICE: 'ISSUE', INV: 'ISSUE', DEBIT: 'ISSUE',
    // REFUND
    RFND: 'REFUND', RFND_: 'REFUND', REF: 'REFUND', REFUND: 'REFUND',
    VOID: 'REFUND', CANN: 'REFUND', CANX: 'REFUND', CANCEL: 'REFUND',
    CANCELLED: 'REFUND', CRN: 'REFUND', CREDIT: 'REFUND', RV: 'REFUND',
    // FUND
    FUND: 'FUND', TOPUP: 'FUND', 'TOP-UP': 'FUND', DEPOSIT: 'FUND',
    OPENING: 'FUND',
    // ADM / ACM
    ADMA: 'ADM', ADM: 'ADM',
    ACMA: 'ACM', ACM: 'ACM',
  };
  return MAP[s] ?? 'UNKNOWN';
}

export function statusToAmount(amount: number, status: NormalizedStatus): number {
  switch (status) {
    case 'REFUND': return -Math.abs(amount);
    case 'FUND':   return Math.abs(amount);
    case 'ISSUE':  return Math.abs(amount);
    default:       return amount;
  }
}
