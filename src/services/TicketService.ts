import { supabase, fetchAllRows } from '../utils/supabase';
import { Ticket } from '../types';

type TicketRow = {
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
  is_duplicate: boolean;
  import_batch_id: string | null;
  currency: string | null;
  transaction_type: string | null;
  report_name: string | null;
  vendor_reference: string | null;
  balance_after: number | null;
  import_time: string | null;
  created_at: string;
  serial: number | null;
};

function rowToTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    ticketNo: r.ticket_no,
    source: r.source,
    date: r.date,
    amount: r.amount,
    commission: r.commission,
    totalDoc: r.total_doc,
    reqNum: r.req_num,
    pnr: r.pnr ?? undefined,
    passengerName: r.passenger_name ?? undefined,
    airlineCode: r.airline_code ?? undefined,
    route: r.route ?? undefined,
    status: r.status ?? undefined,
    isDuplicate: r.is_duplicate,
    userId: r.user_id,
    importBatchId: r.import_batch_id ?? undefined,
    currency: (r.currency as Ticket['currency']) ?? undefined,
    transactionType: r.transaction_type ?? undefined,
    reportName: r.report_name ?? undefined,
    vendorReference: r.vendor_reference ?? undefined,
    balanceAfter: r.balance_after ?? undefined,
    importTime: r.import_time ?? undefined,
    createdAt: r.created_at,
    serial: r.serial ?? undefined,
  };
}

function ticketToRow(t: Ticket, userId: string) {
  return {
    id: t.id,
    user_id: userId,
    ticket_no: t.ticketNo,
    source: t.source || '',
    date: t.date || '',
    amount: t.amount ?? 0,
    commission: t.commission ?? 0,
    total_doc: t.totalDoc ?? 0,
    req_num: t.reqNum || '',
    pnr: t.pnr || '',
    passenger_name: t.passengerName || '',
    airline_code: t.airlineCode || '',
    route: t.route || '',
    status: t.status || '',
    currency: t.currency || 'SAR',
    transaction_type: t.transactionType || t.status || '',
    vendor_reference: t.vendorReference || '',
    report_name: t.reportName || '',
    import_time: t.importTime || new Date().toISOString(),
    is_duplicate: false,
    balance_after: t.balanceAfter ?? null,
    serial: t.serial ?? null,
  };
}

export class TicketService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Supabase realtime gives per-row change events, not a full snapshot like
   * Firestore's onSnapshot. To keep the exact same "always hand back the full
   * current list" contract the hooks rely on, refetch the whole table on any
   * change instead of trying to patch the local array incrementally.
   */
  subscribe(onData: (tickets: Ticket[]) => void, onError?: (e: Error) => void) {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const rows = await fetchAllRows<TicketRow>((from, to) =>
          supabase.from('tickets').select('*').eq('user_id', this.userId).range(from, to)
        );
        if (!cancelled) onData(rows.map(rowToTicket));
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    };

    fetchAll();

    const channel = supabase
      .channel(`tickets-${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `user_id=eq.${this.userId}` }, fetchAll)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }

  async saveImport(
    newTickets: Ticket[],
    updateTickets: Ticket[],
    topUpTickets: Ticket[],
    vendorBalancesLive: { id: string; vendorName: string }[]
  ): Promise<{ saved: number; updated: number; topups: number }> {
    if (newTickets.length > 0) {
      const rows = newTickets.map(t => ticketToRow(t, this.userId));
      const { error } = await supabase.from('tickets').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }

    // Req num updates — targeted column update, not a full row overwrite
    // (matches the old Firestore `merge: true` patch semantics). Also
    // opportunistically backfills serial when the re-imported row carries
    // one and the existing ticket is already being touched anyway — this is
    // the only save path that runs against tickets that already exist, so
    // it's the one chance to fill in serial for pre-existing tickets short
    // of a one-off backfill script.
    for (const ticket of updateTickets) {
      const patch: Record<string, unknown> = { req_num: ticket.reqNum };
      if (ticket.serial != null) patch.serial = ticket.serial;
      const { error } = await supabase
        .from('tickets')
        .update(patch)
        .eq('id', ticket.id)
        .eq('user_id', this.userId);
      if (error) throw new Error(error.message);
    }

    // TopUp rows → save as balance_topups, matched to vendor by source name.
    const topUpRows = topUpTickets
      .map(t => {
        const vendor = vendorBalancesLive.find(v =>
          t.source.toLowerCase().includes(v.vendorName.toLowerCase()) ||
          v.vendorName.toLowerCase().includes(t.source.toLowerCase())
        );
        if (!vendor) return null;
        return {
          id: `topup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          user_id: this.userId,
          vendor_id: vendor.id,
          vendor_name: vendor.vendorName,
          amount: t.amount,
          note: `Auto top-up from ${t.reportName || t.source}`,
          date: t.date || new Date().toISOString().split('T')[0],
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (topUpRows.length > 0) {
      const { error } = await supabase.from('balance_topups').insert(topUpRows);
      if (error) throw new Error(error.message);
    }

    return { saved: newTickets.length, updated: updateTickets.length, topups: topUpRows.length };
  }

  /** Fetch only the tickets whose ticket_no appears in the given list.
   *  Chunked into batches of 100 to avoid PostgREST URL length limits
   *  when the report contains many tickets. */
  async fetchByTicketNos(ticketNos: string[]): Promise<Ticket[]> {
    if (ticketNos.length === 0) return [];
    const CHUNK = 100;
    const rows: TicketRow[] = [];
    for (let i = 0; i < ticketNos.length; i += CHUNK) {
      const chunk = ticketNos.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('user_id', this.userId)
        .in('ticket_no', chunk);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows.map(rowToTicket);
  }

  async delete(ticketId: string): Promise<void> {
    const { error } = await supabase.from('tickets').delete().eq('id', ticketId).eq('user_id', this.userId);
    if (error) throw new Error(error.message);
  }

  async updateReqNum(ticketId: string, reqNum: string): Promise<void> {
    const { error } = await supabase
      .from('tickets')
      .update({ req_num: reqNum })
      .eq('id', ticketId)
      .eq('user_id', this.userId);
    if (error) throw new Error(error.message);
  }

  /**
   * Edit arbitrary fields on an existing ticket (price, name, req num, pnr,
   * route, status, date, ...). Only whitelisted, user-editable columns are
   * accepted — id/user_id/created_at and audit-only fields can't be changed
   * here. Camel-cased Ticket keys are mapped to their snake_case columns.
   */
  async updateFields(ticketId: string, patch: Partial<Ticket>): Promise<void> {
    const MAP: Record<string, string> = {
      ticketNo:        'ticket_no',
      passengerName:   'passenger_name',
      amount:          'amount',
      reqNum:          'req_num',
      pnr:             'pnr',
      route:           'route',
      status:          'status',
      date:            'date',
      commission:      'commission',
      totalDoc:        'total_doc',
      currency:        'currency',
      airlineCode:     'airline_code',
      source:          'source',
      vendorReference: 'vendor_reference',
      serial:          'serial',
    };
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      const col = MAP[key];
      if (col) row[col] = value;
    }
    if (Object.keys(row).length === 0) return;

    const { error } = await supabase
      .from('tickets')
      .update(row)
      .eq('id', ticketId)
      .eq('user_id', this.userId);
    if (error) throw new Error(error.message);
  }
}
