import type { Ticket } from '../../types';
import type { ParsedStatement } from '../parsers/ibtekarStatementPdf';
import { vendorMatchesSource } from './walletMath';

/**
 * The invoice number each ticket is billed under, read off the supplier's
 * statement of account.
 *
 * Asking Ibtekar for a ZATCA tax invoice goes by their invoice number - the
 * request file quotes it, and a ticket with none goes out as "(no invoice
 * number)", which they cannot look up. Their statement prints it on every
 * line: INV264783 for a sale, RFD260615 for a refund's credit note. So
 * reading a statement fills it in: the sale lines onto our sale rows, the
 * refund lines onto our refund rows, matched by the ticket's number.
 *
 * Only where the row holds no document number yet - a blank, or the booking
 * reference the newer imports leave there. A row that already names another
 * document keeps it and is listed, since one of the two is wrong and only a
 * person can say which. A ticket billed on two invoices fills nothing.
 */

/** A vendor document number, as Vendor Ref shows one (TicketTable's VENDOR_DOC). */
const VENDOR_DOC = /^(INV|RFD|RV|DMA|DN)-?\d[\d-]*(_[A-Z])?$/i;
const ser = (t: string) => (t || '').replace(/\D/g, '').slice(-10);

export interface InvoiceNoFill { id: string; ticketNo: string; was: string; doc: string }
export interface InvoiceNoConflict { ticketNo: string; has: string; statement: string }

export function invoiceNumbersFromStatement(
  st: ParsedStatement, tickets: Ticket[], vendor = 'Ibtekar',
): { fill: InvoiceNoFill[]; conflicts: InvoiceNoConflict[] } {
  // Every document the statement names per ticket and side.
  const docs = new Map<string, Set<string>>();
  for (const l of st.lines) {
    const doc = (l.document || '').trim().toUpperCase();
    const k = ser(l.ticketNo);
    if (k.length !== 10 || !/^(INV|RFD)\d+$/.test(doc)) continue;
    const refund = doc.startsWith('RFD') || (l.credit > 0 && !l.debit);
    const key = `${k}|${refund ? 'R' : 'S'}`;
    docs.set(key, (docs.get(key) ?? new Set()).add(doc));
  }
  const fill: InvoiceNoFill[] = [], conflicts: InvoiceNoConflict[] = [];
  for (const t of tickets) {
    if (!vendorMatchesSource(vendor, t.source || '') || (t.status || '').toUpperCase() === 'FUND') continue;
    const k = ser(t.ticketNo);
    const set = docs.get(`${k}|${(t.amount || 0) < 0 ? 'R' : 'S'}`);
    if (!set || set.size !== 1) continue;
    const doc = [...set][0];
    const was = (t.vendorReference || '').trim();
    if (was.toUpperCase() === doc) continue;
    if (VENDOR_DOC.test(was)) { conflicts.push({ ticketNo: t.ticketNo, has: was, statement: doc }); continue; }
    fill.push({ id: t.id, ticketNo: t.ticketNo, was, doc });
  }
  return { fill, conflicts };
}
