import { useState, useEffect } from 'react';
import { walletReference, LOW_SHARE } from '../core/config/appSettings';
import { VendorBalance, BalanceTopUp, Ticket } from '../types';
import { WalletService } from '../services/WalletService';

export function useWallet(userId: string, tickets: Ticket[]) {
  const [vendors, setVendors]   = useState<VendorBalance[]>([]);
  const [topUps,  setTopUps]    = useState<BalanceTopUp[]>([]);
  const [loading, setLoading]   = useState(true);
  const svc = new WalletService(userId);

  useEffect(() => {
    const u1 = svc.subscribeVendors(v => { setVendors(v); setLoading(false); });
    const u2 = svc.subscribeTopUps(setTopUps);
    return () => { u1(); u2(); };
  }, [userId]);

  const vendorsLive = vendors.map(v => ({
    ...v,
    currentBalance: WalletService.calcBalance(v, tickets, topUps),
  }));

  // Low against the vendor's normal limit (Settings), else its opening balance.
  const lowVendors  = vendorsLive.filter(v => {
    const ref = walletReference(v.vendorName, v.initialBalance);
    return ref > 0 && v.currentBalance < ref * LOW_SHARE;
  });
  const overdrawn   = vendorsLive.filter(v => v.currentBalance < 0);

  const saveVendor   = (v: VendorBalance)   => svc.saveVendor({ ...v, userId });
  const deleteVendor = (id: string)         => svc.deleteVendor(id);
  const addTopUp     = (tu: BalanceTopUp)   => svc.addTopUp({ ...tu, userId });
  const updateTopUpDate = async (id: string, date: string) => {
    await svc.updateTopUpDate(id, date);
    setTopUps(list => list.map(t => t.id === id ? { ...t, date } : t));
  };

  return { vendors: vendorsLive, topUps, loading, lowVendors, overdrawn, saveVendor, deleteVendor, addTopUp, updateTopUpDate };
}
