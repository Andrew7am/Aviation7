/**
 * A proposal as its pending_tickets row. Shared by the review queue and the
 * Airtable sync, which raises online purchases into the same queue from the
 * server - one shape, so a row raised either way reads the same.
 */
import type { PendingTicket } from '../../types';

export const pendingRow = (p: PendingTicket, userId: string) => ({
  id: p.id,
  user_id: userId,
  ticket_no: p.ticketNo || '',
  source: p.source || '',
  date: p.date || '',
  amount: p.amount ?? 0,
  commission: p.commission ?? 0,
  total_doc: p.totalDoc ?? 0,
  req_num: p.reqNum || '',
  pnr: p.pnr || '',
  passenger_name: p.passengerName || '',
  airline_code: p.airlineCode || '',
  route: p.route || '',
  status: p.status || '',
  currency: p.currency || 'AED',
  transaction_type: p.transactionType || '',
  vendor_reference: p.vendorReference || '',
  origin: p.origin || 'TEAM_SHEET',
  their_portal: p.theirPortal || '',
  their_req: p.theirReq || '',
  their_cost: p.theirCost ?? null,
  their_group: p.theirGroup ?? 1,
  their_cell: p.theirCell || '',
  finding: p.finding || '',
  note: p.note || '',
  held_back: !!p.heldBack,
  held_back_why: p.heldBackWhy || '',
  state: p.state || 'PENDING',
  review_note: p.reviewNote || null,
  dedupe: p.dedupe,
});
