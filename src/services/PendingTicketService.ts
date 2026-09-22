import { supabase, fetchAllRows } from '../utils/supabase';
import { PendingTicket, Ticket } from '../types';
import { SupportedCurrency } from '../core/helpers/resolveCurrency';
import { whyNotConfirmable, ticketFromPending } from '../core/helpers/pendingFromFindings';

type Row = {
  id: string;
  user_id: string;
  ticket_no: string;
  source: string;
  date: string;
  amount: number;
  commission: number;
  total_doc: number;
  req_num: string;
  pnr: string | null;
  passenger_name: string | null;
  airline_code: string | null;
  route: string | null;
  status: string | null;
  currency: string | null;
  transaction_type: string | null;
  vendor_reference: string | null;
  origin: string;
  their_portal: string | null;
  their_req: string | null;
  their_cost: number | null;
  their_group: number;
  their_cell: string | null;
  finding: string | null;
  note: string | null;
  held_back: boolean;
  held_back_why: string | null;
  state: PendingTicket['state'];
  review_note: string | null;
  reviewed_at: string | null;
  ticket_id: string | null;
  dedupe: string;
  created_at: string;
};

const rowTo = (r: Row): PendingTicket => ({
  id: r.id,
  userId: r.user_id,
  ticketNo: r.ticket_no,
  source: r.source,
  date: r.date,
  amount: Number(r.amount),
  commission: Number(r.commission),
  totalDoc: Number(r.total_doc),
  reqNum: r.req_num,
  pnr: r.pnr ?? undefined,
  passengerName: r.passenger_name ?? undefined,
  airlineCode: r.airline_code ?? undefined,
  route: r.route ?? undefined,
  status: r.status ?? undefined,
  currency: (r.currency as SupportedCurrency) ?? undefined,
  transactionType: r.transaction_type ?? undefined,
  vendorReference: r.vendor_reference ?? undefined,
  origin: r.origin,
  theirPortal: r.their_portal ?? undefined,
  theirReq: r.their_req ?? undefined,
  theirCost: r.their_cost == null ? undefined : Number(r.their_cost),
  theirGroup: r.their_group ?? 1,
  theirCell: r.their_cell ?? undefined,
  finding: r.finding ?? undefined,
  note: r.note ?? undefined,
  heldBack: r.held_back,
  heldBackWhy: r.held_back_why ?? undefined,
  state: r.state,
  reviewNote: r.review_note ?? undefined,
  reviewedAt: r.reviewed_at ?? undefined,
  ticketId: r.ticket_id ?? undefined,
  dedupe: r.dedupe,
  createdAt: r.created_at,
});

const toRow = (p: PendingTicket, userId: string) => ({
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

/**
 * The review queue: tickets proposed and not yet agreed to.
 *
 * Nothing here is in the ledger, so nothing here moves a balance or shows in
 * a report. `confirm` is the only door between the two, and it writes the
 * ticket first and marks the proposal second — if the write fails the
 * proposal is still pending, which is the way round that loses nothing.
 */
export class PendingTicketService {
  constructor(private userId: string) {}

  subscribe(onData: (p: PendingTicket[]) => void) {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;

    const fetchAll = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        const rows = await fetchAllRows<Row>((from, to) =>
          supabase.from('pending_tickets').select('*')
            .order('created_at', { ascending: false }).range(from, to)
        );
        if (!cancelled) onData(rows.map(rowTo));
      } catch (e) { console.error('pending_tickets error', e); }
      finally { running = false; }
    };

    /**
     * Coalesce a burst into one read.
     *
     * Every write to this table comes back as its own realtime event, and
     * every event used to refetch the whole queue. Working down a page —
     * pick a vendor, fix a price, confirm — is three writes in as many
     * seconds, so the screen fetched two hundred rows three times and
     * re-rendered in the middle of somebody typing. Confirming in bulk
     * was worse: one full read per ticket.
     *
     * A quarter second is below noticing and above a burst.
     */
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchAll, 250);
    };

    fetchAll();
    const channel = supabase
      .channel(`pending-tickets-${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_tickets' }, soon)
      .subscribe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }

  /**
   * Raise a batch, without disturbing anything a person has touched.
   *
   * The sheet is checked every few weeks and every run brings back every
   * proposal it found last time, so this has to be careful twice over.
   *
   * A CONFIRMED or REJECTED proposal is left exactly as it was found.
   * Re-raising a confirmed one would offer the same ticket for entry a
   * second time.
   *
   * A proposal still PENDING is REFRESHED, not replaced. Only the evidence
   * is written back — what their sheet now says, which portal, which
   * request, what the check concluded — and never the fields somebody
   * reviews: the vendor they picked, the price they corrected, the
   * passenger they filled in. An upsert would have overwritten all of
   * those, so a fortnight of review would be undone by the next upload,
   * silently, in one click.
   *
   * Returns what happened, because "nothing was added" and "nothing was
   * found" look identical on a screen and mean opposite things.
   */
  async raise(batch: PendingTicket[]): Promise<{ added: number; refreshed: number; settled: number }> {
    if (!batch.length) return { added: 0, refreshed: 0, settled: 0 };

    const keys = batch.map(p => p.dedupe);
    const existing = new Map<string, PendingTicket['state']>();
    // Chunked: a batch can be a couple of hundred keys and `in` has limits.
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await supabase.from('pending_tickets')
        .select('dedupe, state').in('dedupe', keys.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of data ?? []) existing.set(r.dedupe, r.state);
    }

    const settled = batch.filter(p => existing.get(p.dedupe) && existing.get(p.dedupe) !== 'PENDING');
    const fresh = batch.filter(p => !existing.has(p.dedupe));
    const again = batch.filter(p => existing.get(p.dedupe) === 'PENDING');

    for (let i = 0; i < fresh.length; i += 200) {
      const { error } = await supabase.from('pending_tickets')
        .insert(fresh.slice(i, i + 200).map(p => toRow(p, this.userId)));
      if (error) throw new Error(error.message);
    }

    for (const p of again) {
      const { error } = await supabase.from('pending_tickets').update({
        their_portal: p.theirPortal || '',
        their_req: p.theirReq || '',
        their_cost: p.theirCost ?? null,
        their_group: p.theirGroup ?? 1,
        their_cell: p.theirCell || '',
        finding: p.finding || '',
        note: p.note || '',
        held_back: !!p.heldBack,
        held_back_why: p.heldBackWhy || '',
      }).eq('dedupe', p.dedupe);
      if (error) throw new Error(error.message);
    }

    return { added: fresh.length, refreshed: again.length, settled: settled.length };
  }

  /** Correct a proposal in place — a vendor picked, a price entered. */
  async patch(id: string, patch: Partial<PendingTicket>): Promise<void> {
    const map: Record<string, unknown> = {};
    const keys: [keyof PendingTicket, string][] = [
      ['ticketNo', 'ticket_no'], ['source', 'source'], ['date', 'date'],
      ['amount', 'amount'], ['commission', 'commission'], ['totalDoc', 'total_doc'],
      ['reqNum', 'req_num'], ['pnr', 'pnr'], ['passengerName', 'passenger_name'],
      ['airlineCode', 'airline_code'], ['route', 'route'], ['status', 'status'],
      ['currency', 'currency'], ['transactionType', 'transaction_type'],
      ['vendorReference', 'vendor_reference'], ['reviewNote', 'review_note'],
    ];
    // An explicit undefined means "not part of this patch", not "clear it":
    // writing '' into `amount` would fail the column and writing it into a
    // field the caller never mentioned would erase somebody's correction.
    for (const [k, col] of keys) if (patch[k] !== undefined) map[col] = patch[k];
    if (!Object.keys(map).length) return;
    const { error } = await supabase.from('pending_tickets').update(map).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /**
   * Agree to one, and write the ticket.
   *
   * The ticket goes in first. If marking the proposal then fails, the ticket
   * exists and the proposal is still pending, which somebody will notice —
   * the other order would mark it agreed with no ticket behind it, which
   * nobody would.
   */
  async confirm(p: PendingTicket, ticketId: string): Promise<Ticket> {
    // The same gate the screen greys the button with, checked again here:
    // the button is a courtesy and this is the rule.
    const blocked = whyNotConfirmable(p);
    if (blocked) throw new Error(`${p.ticketNo || p.pnr}: ${blocked}`);

    const ticket = ticketFromPending(p, ticketId, this.userId);

    const { error: tErr } = await supabase.from('tickets').insert({
      id: ticket.id,
      user_id: this.userId,
      ticket_no: ticket.ticketNo,
      source: ticket.source,
      date: ticket.date,
      amount: ticket.amount,
      commission: ticket.commission,
      total_doc: ticket.totalDoc,
      req_num: ticket.reqNum,
      pnr: ticket.pnr,
      passenger_name: ticket.passengerName,
      airline_code: ticket.airlineCode,
      route: ticket.route,
      status: ticket.status,
      is_duplicate: false,
      currency: ticket.currency,
      transaction_type: ticket.transactionType,
      report_name: ticket.reportName,
      vendor_reference: ticket.vendorReference,
      import_time: ticket.importTime,
      closed: false,
    });
    if (tErr) throw new Error(tErr.message);

    const { error } = await supabase.from('pending_tickets').update({
      state: 'CONFIRMED',
      reviewed_at: new Date().toISOString(),
      ticket_id: ticket.id,
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    return ticket;
  }

  /** Say no to one, and say why — the why is the only record that it was
   *  looked at rather than ignored. */
  async reject(id: string, why: string): Promise<void> {
    const { error } = await supabase.from('pending_tickets').update({
      state: 'REJECTED',
      review_note: why.trim() || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Put a decided one back in the queue. Confirming wrote a ticket, so
   *  reopening a confirmed proposal would offer the same ticket twice —
   *  only a rejection can be reopened. */
  async reopen(id: string): Promise<void> {
    const { error } = await supabase.from('pending_tickets')
      .update({ state: 'PENDING', reviewed_at: null, ticket_id: null })
      .eq('id', id).eq('state', 'REJECTED');
    if (error) throw new Error(error.message);
  }

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('pending_tickets').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
