import { supabase, fetchAllRows } from '../utils/supabase';
import type { ExchangeEdge } from '../core/parsers/types';

/**
 * Which document replaced which.
 *
 * A reissue that moved no money never becomes a ledger row, but the link it
 * forms is what connects a later refund of it to the original that holds the
 * money. So every reissue's link is kept here, money or not.
 */
export interface StoredExchange {
  ticketNo: string;
  replacedTicket: string;
  source: string;
  fee: number | null;
  date: string;
  period: string;
}

export class ExchangeService {
  async list(): Promise<StoredExchange[]> {
    const rows = await fetchAllRows<any>((from, to) =>
      supabase.from('ticket_exchanges').select('*').range(from, to));
    return rows.map(r => ({
      ticketNo: r.ticket_no, replacedTicket: r.replaced_ticket, source: r.source,
      fee: r.fee == null ? null : Number(r.fee), date: r.date ?? '', period: r.period ?? '',
    }));
  }

  /**
   * Record the file's reissues.
   *
   * Keyed on (document, supplier), so reading the same billing file twice
   * leaves the register exactly as it was — a document replaces exactly one
   * other, once.
   */
  async record(edges: ExchangeEdge[], source: string, reportName: string): Promise<number> {
    if (!edges.length) return 0;
    const period = reportName.match(/_(\d{6})_/)?.[1] ?? '';
    const payload = [...new Map(edges.map(e => [e.ticketNo, e])).values()].map(e => ({
      ticket_no: e.ticketNo,
      replaced_ticket: e.replacedTicket,
      airline_code: e.airlineCode || null,
      source,
      date: e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null,
      period,
      fee: e.fee,
      report_name: reportName || null,
    }));
    const { error, count } = await supabase.from('ticket_exchanges')
      .upsert(payload, { onConflict: 'ticket_no,source', ignoreDuplicates: true, count: 'exact' });
    if (error) throw error;
    return count ?? payload.length;
  }
}
