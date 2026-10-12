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

/** What the preview says about them. */
export function voidedWarning(out: { ticketNo: string }[]): string {
  if (!out.length) return '';
  return `${out.length} ticket(s) in this report are in our Voids register and were left out: `
    + `${out.map(t => t.ticketNo).join(', ')}. If the supplier really issued them, remove them from Voids and import again.`;
}
