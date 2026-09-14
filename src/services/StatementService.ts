import { supabase, fetchAllRows } from '../utils/supabase';
import { VendorStatement } from '../types';

type Row = {
  id: string;
  user_id: string;
  vendor_name: string;
  period_start: string;
  period_end: string;
  currency: string;
  opening_balance: number;
  closing_balance: number;
  billed: number;
  paid: number;
  other_charges: number;
  source_file: string | null;
  note: string | null;
  created_at: string;
};

const rowTo = (r: Row): VendorStatement => ({
  id: r.id,
  vendorName: r.vendor_name,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  currency: r.currency,
  openingBalance: Number(r.opening_balance),
  closingBalance: Number(r.closing_balance),
  billed: Number(r.billed),
  paid: Number(r.paid),
  otherCharges: Number(r.other_charges),
  sourceFile: r.source_file ?? undefined,
  note: r.note ?? undefined,
  userId: r.user_id,
  createdAt: r.created_at,
});

/**
 * The vendors' own statements of account.
 *
 * Read by everyone in the workspace, written by admins — the same split every
 * other table has had since 0019, enforced in the database rather than here.
 */
export class StatementService {
  constructor(private userId: string) {}

  subscribe(onData: (s: VendorStatement[]) => void) {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const rows = await fetchAllRows<Row>((from, to) =>
          supabase.from('vendor_statements').select('*')
            .order('vendor_name').order('period_start').range(from, to)
        );
        if (!cancelled) onData(rows.map(rowTo));
      } catch (e) { console.error('vendor_statements error', e); }
    };
    fetchAll();
    const channel = supabase
      .channel(`vendor-statements-${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_statements' }, fetchAll)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }

  async save(s: VendorStatement): Promise<void> {
    const { error } = await supabase.from('vendor_statements').upsert({
      id: s.id,
      user_id: this.userId,
      vendor_name: s.vendorName,
      period_start: s.periodStart,
      period_end: s.periodEnd,
      currency: s.currency,
      opening_balance: s.openingBalance,
      closing_balance: s.closingBalance,
      billed: s.billed,
      paid: s.paid,
      other_charges: s.otherCharges,
      source_file: s.sourceFile?.trim() || null,
      note: s.note?.trim() || null,
    }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('vendor_statements').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
