export type NormalizedStatus = 'ISSUE' | 'REFUND' | 'FUND' | 'VOID' | 'ADM' | 'ACM' | 'UNKNOWN';

export function normalizeStatus(raw: unknown): NormalizedStatus {
  if (!raw) return 'UNKNOWN';
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const MAP: Record<string, NormalizedStatus> = {
    // ISSUE — actual sale
    TKTT: 'ISSUE', ISSU: 'ISSUE', ISSUE: 'ISSUE', TICKETED: 'ISSUE',
    CONFIRMED: 'ISSUE', CLOSED: 'ISSUE', EMDA: 'ISSUE', EMDS: 'ISSUE',
    SALE: 'ISSUE', INVOICE: 'ISSUE', INV: 'ISSUE', DEBIT: 'ISSUE',
    // An exchange settles like a sale: a document is issued and the agency
    // collects the difference, which is nothing at all when the new fare
    // matches the old. Every other part of the app already knew this — the
    // Turkish parsers read it, manual entry offers it — but this shared map
    // did not, so a reissue arrived UNKNOWN. On an RTS sheet that then met a
    // rule reading a zero total as a cancellation, and five real exchanges
    // were dropped as voids and never reached the ledger.
    REISSUE: 'ISSUE', EXCHANGE: 'ISSUE', EXCH: 'ISSUE',
    REVALIDATION: 'ISSUE', REVALIDATE: 'ISSUE', REVAL: 'ISSUE',
    // REFUND — real money movement back to us
    RFND: 'REFUND', RFND_: 'REFUND', REF: 'REFUND', REFUND: 'REFUND',
    CRN: 'REFUND', CREDIT: 'REFUND', RV: 'REFUND',
    // VOID — cancelled ticket / cancelled refund. Zero-value informational
    // rows, no balance effect. Kept separate from REFUND on purpose.
    VOID: 'VOID', CANN: 'VOID', CANX: 'VOID', CANCEL: 'VOID',
    CANCELLED: 'VOID', RFNX: 'VOID',
    // BSP's own hand-typed variants. Five real rows read "canxx" and one
    // "canx"; the doubled X was not in this map, so those five came back
    // UNKNOWN and were read as sales by the amount.
    CANXX: 'VOID', CNX: 'VOID', CNCL: 'VOID', CANCELLATION: 'VOID',
    // FUND
    FUND: 'FUND', TOPUP: 'FUND', 'TOP-UP': 'FUND', DEPOSIT: 'FUND',
    OPENING: 'FUND',
    // ADM / ACM
    ADMA: 'ADM', ADM: 'ADM',
    ACMA: 'ACM', ACM: 'ACM',
  };
  return MAP[s] ?? 'UNKNOWN';
}

/**
 * A voided document: cancelled ticket, cancelled refund, void.
 *
 * These always settle at zero (see statusToAmount below), so the row carries
 * no money and no obligation. Import discards them rather than storing them —
 * a stored void only pads the ticket count and the "not closed" list with
 * documents nobody has to act on.
 *
 * Deliberately keyed on the STATUS, not on the amount. A zero amount can also
 * mean a genuinely free ticket or a fare the report failed to state, and
 * neither of those should silently disappear.
 */
export function isVoidRow(t: { status?: unknown }): boolean {
  return normalizeStatus(t.status) === 'VOID';
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
