import { supabase, fetchAllRows } from '../utils/supabase';
import type { VoidRow } from '../core/helpers/voidRatio';

/**
 * The register of cancelled documents.
 *
 * Read-heavy and write-rare: these arrive with an invoice import and are
 * then counted, not edited. Nothing here is in a balance, so there is no
 * confirm step and no review — a void is a fact about paper, and the only
 * question anybody asks of it is how many.
 */

interface Row {
  id: string;
  ticket_no: string;
  airline_code: string | null;
  pnr: string | null;
  passenger_name: string | null;
  date: string | null;
  source: string;
  period: string | null;
  currency: string | null;
  face_value: number | string | null;
  raw_status: string | null;
  report_name: string | null;
  note: string | null;
  created_at: string;
}

export interface VoidTicket extends VoidRow {
  id: string;
  airlineCode: string;
  pnr: string;
  passengerName: string;
  rawStatus: string;
  reportName: string;
  note: string;
  createdAt: string;
}

const rowTo = (r: Row): VoidTicket => ({
  id: r.id,
  ticketNo: r.ticket_no,
  airlineCode: r.airline_code ?? '',
  pnr: r.pnr ?? '',
  passengerName: r.passenger_name ?? '',
  date: r.date ?? '',
  source: r.source,
  period: r.period ?? '',
  currency: r.currency ?? '',
  faceValue: r.face_value == null ? null : Number(r.face_value),
  rawStatus: r.raw_status ?? '',
  reportName: r.report_name ?? '',
  note: r.note ?? '',
  createdAt: r.created_at,
});

export class VoidTicketService {
  constructor(private userId: string) {}

  async list(): Promise<VoidTicket[]> {
    const rows = await fetchAllRows<Row>((from, to) =>
      supabase.from('void_tickets').select('*')
        .order('date', { ascending: false }).range(from, to));
    return rows.map(rowTo);
  }

  /**
   * Record cancelled documents.
   *
   * Upserted on (ticket_no, source, period), so re-importing an invoice
   * leaves what is already there exactly as it is instead of raising a
   * duplicate. An invoice gets dropped on the screen more than once and a
   * void ratio counted twice is the one number this table exists to get
   * right.
   */
  async record(rows: Omit<VoidTicket, 'id' | 'createdAt'>[]): Promise<number> {
    if (!rows.length) return 0;
    const payload = rows.map(v => ({
      id: crypto.randomUUID(),
      user_id: this.userId,
      ticket_no: v.ticketNo,
      airline_code: v.airlineCode || null,
      pnr: v.pnr || null,
      passenger_name: v.passengerName || null,
      date: v.date && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null,
      source: v.source,
      period: v.period || null,
      currency: v.currency || null,
      face_value: v.faceValue ?? null,
      raw_status: v.rawStatus || null,
      report_name: v.reportName || null,
      note: v.note || null,
      import_time: new Date().toISOString(),
    }));
    const { error, count } = await supabase
      .from('void_tickets')
      .upsert(payload, { onConflict: 'ticket_no,source,period', ignoreDuplicates: true, count: 'exact' });
    if (error) throw error;
    return count ?? payload.length;
  }

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('void_tickets').delete().eq('id', id);
    if (error) throw error;
  }
}
