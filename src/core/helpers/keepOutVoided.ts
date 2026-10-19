/**
 * Sales in an import whose document is in our Voids register.
 *
 * A void is decided once and kept: 4862343304 and 4862405623 were voided by
 * accounting on 12 October 2026 while Ibtekar's own report still printed
 * them as issued. Every later Ibtekar report would have put them straight
 * back as sales, charged against the wallet again, with nothing on the
 * preview to say a voided document was being sold a second time.
 *
 * So a new SALE of a voided document is kept out of the import and named
 * on the preview. A refund is not: money coming back on it is still money.
 * If the supplier really did issue it, the void is the mistake, and taking
 * it out of the Voids register lets the next import record it.
 */
export function keepOutVoided<T extends { ticketNo: string; amount: number }>(
  fresh: T[], voided: Iterable<string>,
): { kept: T[]; out: T[] } {
  const v = new Set([...voided].map(serial).filter(Boolean));
  const out = fresh.filter(t => (t.amount || 0) >= 0 && v.has(serial(t.ticketNo)));
  return { kept: fresh.filter(t => !out.includes(t)), out };
}

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);

/**
 * Sales already in our books that this report voids.
 *
 * The other half of the rule above. BSP's report of 12 Oct carried
 * 5513427890 and 5513427891 as sales, 16,670 AED each; the next day's
 * carried both as VOID. The voids went to the register and the sales stayed
 * in the ledger - 33,340 AED charged against the IATA wallet for two tickets
 * nobody bills. A void of a sale we hold takes the sale out, from the same
 * supplier only, and never one with a refund against it: money already back
 * on a ticket is a refund, not a void.
 */
export function salesVoided<T extends { id: string; ticketNo: string; amount: number; source?: string; status?: string }>(
  voidedRows: { ticketNo: string; source?: string }[], held: T[],
): T[] {
  const bySerial = new Map<string, Set<string>>();
  for (const v of voidedRows) {
    const k = serial(v.ticketNo);
    if (k) bySerial.set(k, (bySerial.get(k) ?? new Set()).add((v.source || '').toLowerCase()));
  }
  const refunded = new Set(held.filter(t => (t.amount || 0) < 0).map(t => serial(t.ticketNo)));
  return held.filter(t => {
    const k = serial(t.ticketNo);
    const srcs = bySerial.get(k);
    return !!srcs && (t.amount || 0) > 0 && (t.status || '').toUpperCase() !== 'FUND' && !refunded.has(k)
      && (srcs.has('') || srcs.has((t.source || '').toLowerCase()));
  });
}

export function salesVoidedWarning(out: { ticketNo: string; amount: number; currency?: string; reqNum?: string }[]): string {
  if (!out.length) return '';
  return `${out.length} ticket(s) already in our books as sales are VOID in this report and will leave the ledger: `
    + out.map(t => `${t.ticketNo} (${t.amount} ${t.currency || ''}${t.reqNum ? `, ${t.reqNum}` : ''})`.replace(' )', ')')).join(', ') + '.';
}

/** What the preview says about them. */
export function voidedWarning(out: { ticketNo: string }[]): string {
  if (!out.length) return '';
  return `${out.length} ticket(s) in this report are in our Voids register and were left out: `
    + `${out.map(t => t.ticketNo).join(', ')}. If the supplier really issued them, remove them from Voids and import again.`;
}
