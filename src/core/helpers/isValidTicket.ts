import { toSerial, toAirlineCode } from './ticketIdentity';

export function isValidTicketNo(ticketNo: string, isLCC: boolean): boolean {
  if (!ticketNo) return false;
  if (isLCC) {
    // LCC: PNR as identifier — 5-6 alphanumeric, at least one letter
    return /^[A-Z0-9]{5,6}$/i.test(ticketNo) && /[A-Z]/i.test(ticketNo);
  }
  // Standard: 8-15 digits
  return /^\d{8,15}$/.test(ticketNo);
}

export function isValidPNR(s: string): boolean {
  return /^[A-Z0-9]{5,6}$/i.test(s) && /[A-Z]/i.test(s);
}

/**
 * isValidTicket — standalone record-level validator (roadmap spec).
 * Checks the fields that must be present for a parsed row to be trustworthy:
 * ticket/PNR identity, a non-zero amount, a real date, and a known vendor.
 * Distinct from isValidTicketNo() above, which only checks the identifier shape.
 */
export interface TicketValidationResult {
  valid:  boolean;
  errors: string[];
}

export function isValidTicket(t: {
  ticketNo?: string;
  pnr?:      string;
  amount?:   number;
  date?:     string;
  source?:   string;
  status?:   string;
}): TicketValidationResult {
  const errors: string[] = [];

  const hasTk  = !!t.ticketNo && t.ticketNo.trim().length >= 5;
  const hasPNR = !!t.pnr && t.pnr.trim().length >= 5;
  if (!hasTk && !hasPNR) errors.push('Missing ticket number and PNR');

  if (t.amount === undefined || t.amount === null || t.amount === 0) {
    if (t.status !== 'CANN' && t.status !== 'FUND') errors.push('Amount is zero');
  }

  if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) errors.push('Invalid or missing date');

  if (!t.source || t.source.trim() === '') errors.push('Missing vendor/source');

  return { valid: errors.length === 0, errors };
}

/** "065 - 1930576239" → "1930576239". Airline and serial are kept apart —
 *  see core/helpers/ticketIdentity.ts for the reasoning. */
export function cleanTicketNo(raw: string, explicitCode?: string): string {
  return toSerial(raw, explicitCode);
}

export function extractAirlineCode(ticketNo: string, explicitCode?: string): string {
  return toAirlineCode(ticketNo, explicitCode);
}

export function cleanPassengerName(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().replace(/^(MR\.?|MRS\.?|MS\.?|DR\.?|INF\.?|CHD\.?)\s+/i, '');
  if (s.includes('/')) {
    const [last, first] = s.split('/');
    s = `${(first || '').trim()} ${(last || '').trim()}`.trim();
  }
  if (s.includes(',')) {
    const [last, first] = s.split(',');
    s = `${(first || '').trim()} ${(last || '').trim()}`.trim();
  }
  return s.replace(/\s+/g, ' ').toUpperCase().trim();
}
