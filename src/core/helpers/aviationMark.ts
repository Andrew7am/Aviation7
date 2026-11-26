import type { Ticket } from '../../types';

/**
 * "AV" after a request number: money that is the aviation team's.
 *
 * The user writes it on a refund the airline paid back to us that operations
 * was never given back (26 Nov 2026): KSAML2747-AV on 5513727231's 1,250.00.
 * It is hidden profit, so it is not on the team's sheet - not a refund their
 * sheet is missing, and not filed under another request. It belongs to the
 * request before the mark, and to the aviation team's profit.
 */
const MARK = /(^|[^A-Z0-9])AV\s*$/i;

/** "KSAML2747-AV", "KSAML2425 - KSAFM2786 - AV". */
export const isAviationMarked = (req: string | null | undefined): boolean => MARK.test((req || '').trim());

/** The request without the mark: "KSAML2747-AV" is KSAML2747. */
export const withoutAvMark = (req: string | null | undefined): string =>
  (req || '').trim().replace(MARK, '').replace(/[\s\-_/|,;]+$/, '').trim();

/** Money back to us marked AV: the aviation team's, and on nobody's sheet. */
export const isHiddenProfit = (t: Pick<Ticket, 'reqNum' | 'amount' | 'status'>): boolean =>
  isAviationMarked(t.reqNum) && (t.amount || 0) < 0 && (t.status || '').toUpperCase() !== 'FUND';
