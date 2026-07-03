import { useState, useEffect } from 'react';
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

  const LOW_PCT     = 0.2;
  const lowVendors  = vendorsLive.filter(v => v.initialBalance > 0 && v.currentBalance < v.initialBalance * LOW_PCT);
  const overdrawn   = vendorsLive.filter(v => v.currentBalance < 0);

  const saveVendor   = (v: VendorBalance)   => svc.saveVendor({ ...v, userId });
  const deleteVendor = (id: string)         => svc.deleteVendor(id);
  const addTopUp     = (tu: BalanceTopUp)   => svc.addTopUp({ ...tu, userId });

  return { vendors: vendorsLive, topUps, loading, lowVendors, overdrawn, saveVendor, deleteVendor, addTopUp };
}
