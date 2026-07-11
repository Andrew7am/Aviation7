export type NormalizedStatus = 'ISSUE' | 'REFUND' | 'FUND' | 'VOID' | 'ADM' | 'ACM' | 'UNKNOWN';

export function normalizeStatus(raw: unknown): NormalizedStatus {
  if (!raw) return 'UNKNOWN';
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const MAP: Record<string, NormalizedStatus> = {
    // ISSUE — actual sale
    TKTT: 'ISSUE', ISSU: 'ISSUE', ISSUE: 'ISSUE', TICKETED: 'ISSUE',
    CONFIRMED: 'ISSUE', CLOSED: 'ISSUE', EMDA: 'ISSUE', EMDS: 'ISSUE',
    SALE: 'ISSUE', INVOICE: 'ISSUE', INV: 'ISSUE', DEBIT: 'ISSUE',
    // REFUND — real money movement back to us
    RFND: 'REFUND', RFND_: 'REFUND', REF: 'REFUND', REFUND: 'REFUND',
    CRN: 'REFUND', CREDIT: 'REFUND', RV: 'REFUND',
    // VOID — cancelled ticket / cancelled refund. Zero-value informational
    // rows, no balance effect. Kept separate from REFUND on purpose.
    VOID: 'VOID', CANN: 'VOID', CANX: 'VOID', CANCEL: 'VOID',
    CANCELLED: 'VOID', RFNX: 'VOID',
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
    case 'VOID':   return 0;
    default:       return amount;
  }
}
