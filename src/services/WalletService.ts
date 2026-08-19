import { supabase, fetchAllRows } from '../utils/supabase';
import { VendorBalance, BalanceTopUp } from '../types';
import { vendorMatchesSource, calcVendorBalance } from '../core/helpers/walletMath';

type VendorBalanceRow = {
  id: string;
  user_id: string;
  vendor_name: string;
  initial_balance: number;
  current_balance: number;
  created_at: string;
};

type BalanceTopUpRow = {
  id: string;
  user_id: string;
  vendor_id: string;
  vendor_name: string;
  amount: number;
  note: string | null;
  date: string | null;
};

const rowToVendor = (r: VendorBalanceRow): VendorBalance => ({
  id: r.id,
  vendorName: r.vendor_name,
  initialBalance: r.initial_balance,
  currentBalance: r.current_balance,
  userId: r.user_id,
  createdAt: r.created_at,
});

const rowToTopUp = (r: BalanceTopUpRow): BalanceTopUp => ({
  id: r.id,
  vendorId: r.vendor_id,
  vendorName: r.vendor_name,
  amount: r.amount,
  note: r.note ?? '',
  date: r.date ?? '',
  userId: r.user_id,
});

export class WalletService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  subscribeVendors(onData: (v: VendorBalance[]) => void) {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const rows = await fetchAllRows<VendorBalanceRow>((from, to) =>
          supabase.from('vendor_balances').select('*').range(from, to)
        );
        if (!cancelled) onData(rows.map(rowToVendor));
      } catch (e) { console.error('vendor_balances error', e); }
    };
    fetchAll();
    const channel = supabase
      .channel(`vendor-balances-${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_balances' }, fetchAll)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }

  subscribeTopUps(onData: (tu: BalanceTopUp[]) => void) {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const rows = await fetchAllRows<BalanceTopUpRow>((from, to) =>
          supabase.from('balance_topups').select('*').range(from, to)
        );
        if (!cancelled) onData(rows.map(rowToTopUp));
      } catch (e) { console.error('balance_topups error', e); }
    };
    fetchAll();
    const channel = supabase
      .channel(`balance-topups-${this.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'balance_topups' }, fetchAll)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }

  async saveVendor(vendor: VendorBalance): Promise<void> {
    const { error } = await supabase.from('vendor_balances').upsert({
      id: vendor.id,
      user_id: this.userId,
      vendor_name: vendor.vendorName,
      initial_balance: vendor.initialBalance,
      current_balance: vendor.currentBalance,
    }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  async deleteVendor(id: string): Promise<void> {
    const { error } = await supabase.from('vendor_balances').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async addTopUp(topUp: BalanceTopUp): Promise<void> {
    const { error } = await supabase.from('balance_topups').upsert({
      id: topUp.id,
      user_id: this.userId,
      vendor_id: topUp.vendorId,
      vendor_name: topUp.vendorName,
      amount: topUp.amount,
      note: topUp.note,
      date: topUp.date,
    }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  /** Match vendor to tickets by source name using alias table.
   *  Implementation lives in core/helpers/walletMath so it can be tested
   *  without loading the Supabase client; behaviour is unchanged. */
  static vendorMatchesSource(vendorName: string, ticketSource: string): boolean {
    return vendorMatchesSource(vendorName, ticketSource);
  }

  /** Recalculate balance from scratch using ledger. */
  static calcBalance(
    vendor: VendorBalance,
    tickets: { source: string; amount: number; status?: string }[],
    topUps: BalanceTopUp[]
  ): number {
    return calcVendorBalance(vendor, tickets, topUps);
  }
}
