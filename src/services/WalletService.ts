import {
  collection, doc, setDoc, deleteDoc,
  onSnapshot, query, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../utils/firebase';
import { VendorBalance, BalanceTopUp } from '../types';
import { VENDOR_ALIASES } from '../core/config/vendorAliases';

export class WalletService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  subscribeVendors(onData: (v: VendorBalance[]) => void) {
    const q = query(collection(db, 'vendorBalances'), where('userId', '==', this.userId));
    return onSnapshot(q, snap => onData(snap.docs.map(d => d.data() as VendorBalance)));
  }

  subscribeTopUps(onData: (tu: BalanceTopUp[]) => void) {
    const q = query(collection(db, 'balanceTopUps'), where('userId', '==', this.userId));
    return onSnapshot(q, snap => onData(snap.docs.map(d => d.data() as BalanceTopUp)));
  }

  async saveVendor(vendor: VendorBalance): Promise<void> {
    await setDoc(doc(db, 'vendorBalances', vendor.id), { ...vendor, userId: this.userId });
  }

  async deleteVendor(id: string): Promise<void> {
    await deleteDoc(doc(db, 'vendorBalances', id));
  }

  async addTopUp(topUp: BalanceTopUp): Promise<void> {
    await setDoc(doc(db, 'balanceTopUps', topUp.id), { ...topUp, userId: this.userId });
  }

  /** Match vendor to tickets by source name using alias table */
  static vendorMatchesSource(vendorName: string, ticketSource: string): boolean {
    const vn  = vendorName.toLowerCase().trim();
    const src = ticketSource.toLowerCase().trim();
    if (!vn || !src) return false;
    const aliases = (VENDOR_ALIASES as Record<string, string[]>)[vn];
    if (aliases) return aliases.some(a => src.includes(a));
    return src.includes(vn) || vn.includes(src);
  }

  /** Recalculate balance from scratch using ledger */
  static calcBalance(
    vendor: VendorBalance,
    tickets: { source: string; amount: number; status?: string }[],
    topUps: BalanceTopUp[]
  ): number {
    const linked = tickets.filter(t => WalletService.vendorMatchesSource(vendor.vendorName, t.source));
    // Sum issued tickets (positive = deduct from balance)
    const issued  = linked.filter(t => (t.status || '').toUpperCase() !== 'FUND').reduce((s, t) => s + t.amount, 0);
    const topUpTotal = topUps.filter(tu => tu.vendorId === vendor.id).reduce((s, tu) => s + tu.amount, 0);
    return vendor.initialBalance + topUpTotal - issued;
  }
}
