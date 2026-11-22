import type { Ticket, VendorBalance, BalanceTopUp } from '../../types';
import { calcVendorBalance, vendorMatchesSource } from './walletMath';

/**
 * What each wallet will read once this import is confirmed - shown on the
 * preview, before anything is written.
 *
 * It is the wallet's own arithmetic (calcVendorBalance: opening + top-ups -
 * what its tickets draw) run twice: on the ledger as it is, and on the ledger
 * as the confirm will leave it. Nothing is estimated and nothing is saved;
 * the "after" is the same function over a copy with this import's changes
 * laid on it, exactly as the confirm makes them:
 *
 *   - new rows are added (fresh);
 *   - invoice lines replace the money of the row they settle (settlements:
 *     amount, status, date);
 *   - supplier corrections put a row's amount right (corrections);
 *   - sales this file voids leave the ledger (voidedSales);
 *   - top-up rows become top-ups of the wallet whose name they carry, by the
 *     same name rule the save uses.
 *
 * Fill-in updates (request, route, passenger) move no money and are left out.
 */
export interface ImportChanges {
  fresh: Ticket[];
  settlements: Ticket[];
  topUps: Ticket[];
  corrections?: { id: string; amount: number; totalDoc: number; commission: number }[];
  voidedSales?: Ticket[];
}

export interface WalletProjection {
  vendorId: string;
  vendorName: string;
  before: number;
  after: number;
  change: number;
  /** Rows of this import that touch this wallet. */
  rows: number;
}

/** The save's own rule for which wallet a top-up row belongs to. */
const topUpWallet = (t: Ticket, wallets: VendorBalance[]) => wallets.find(v =>
  t.source.toLowerCase().includes(v.vendorName.toLowerCase())
  || v.vendorName.toLowerCase().includes(t.source.toLowerCase()));

export function projectWallets(
  wallets: VendorBalance[],
  ledger: Ticket[],
  topUps: BalanceTopUp[],
  change: ImportChanges,
): WalletProjection[] {
  const settle = new Map(change.settlements.map(t => [t.id, t]));
  const correct = new Map((change.corrections ?? []).map(c => [c.id, c]));
  const gone = new Set((change.voidedSales ?? []).map(t => t.id));

  const after: Ticket[] = ledger
    .filter(t => !gone.has(t.id))
    .map(t => {
      const s = settle.get(t.id);
      if (s) return { ...t, amount: s.amount, status: s.status, date: s.date };
      const c = correct.get(t.id);
      if (c) return { ...t, amount: c.amount };
      return t;
    })
    .concat(change.fresh);

  const newTopUps: BalanceTopUp[] = change.topUps.flatMap(t => {
    const w = topUpWallet(t, wallets);
    return w ? [{ id: `preview_${t.id}`, vendorId: w.id, vendorName: w.vendorName, amount: t.amount,
      note: 'preview', date: t.date || '', userId: '' } as BalanceTopUp] : [];
  });
  const topUpsAfter = topUps.concat(newTopUps);

  const touched = (w: VendorBalance) => {
    const name = w.vendorName.toLowerCase();
    const mine = (t: Ticket) => vendorMatchesSource(w.vendorName, t.source || '');
    return change.fresh.filter(mine).length
      + change.settlements.filter(mine).length
      + (change.voidedSales ?? []).filter(mine).length
      + ledger.filter(t => correct.has(t.id) && mine(t)).length
      + newTopUps.filter(u => u.vendorName.toLowerCase() === name).length;
  };

  return wallets.map(w => {
    const before = calcVendorBalance(w, ledger, topUps);
    const afterBal = calcVendorBalance(w, after, topUpsAfter);
    return { vendorId: w.id, vendorName: w.vendorName, before, after: afterBal,
      change: Math.round((afterBal - before) * 100) / 100, rows: touched(w) };
  }).filter(p => p.rows > 0 || Math.abs(p.change) >= 0.005);
}
