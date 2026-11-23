import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { BalanceTopUp } from '../types';
import { isPaymentDay, localToday } from '../core/helpers/walletOrder';

/**
 * A top-up's date, and a pencil to correct it. Only the date: the amount and
 * the wallet are what was paid, and the balance does not move.
 */
export const TopUpDate: React.FC<{
  topUp: BalanceTopUp;
  /** Absent for a viewer, who sees the date and no pencil. */
  onSave?: (topUp: BalanceTopUp, date: string) => Promise<void>;
}> = ({ topUp, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(topUp.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const was = (topUp.date || '').slice(0, 10);

  if (!editing) return (
    <span className="inline-flex items-center gap-1.5 font-mono text-mini text-slate-500 whitespace-nowrap">
      {was || 'no date'}
      {onSave && (
        <button type="button" title="Edit payment date" aria-label={`Edit the date of the ${topUp.amount} payment`}
          onClick={e => { e.stopPropagation(); setDate(was); setError(''); setEditing(true); }}
          className="p-1.5 -my-1 rounded text-slate-400 hover:text-blue-700 hover:bg-slate-100">
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </span>
  );

  const ok = isPaymentDay(date);
  const save = async () => {
    if (!ok || date === was || !onSave) return;
    setBusy(true); setError('');
    try { await onSave(topUp, date); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'The date could not be saved.'); }
    finally { setBusy(false); }
  };
  return (
    <span className="inline-block" onClick={e => e.stopPropagation()}>
      <span className="flex flex-wrap items-center gap-1.5">
        <input type="date" autoFocus value={date} max={localToday()} disabled={busy} aria-label="Payment date"
          onChange={e => setDate(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}
          className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
        <button type="button" onClick={() => void save()} disabled={!ok || date === was || busy}
          className="px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold disabled:opacity-40">
          {busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy}
          className="px-2.5 py-1 rounded border border-slate-200 text-slate-600 text-xs font-bold">Cancel</button>
      </span>
      {(!ok || error) && (
        <span role="alert" className="block mt-1 text-mini font-sans text-red-600">{error || 'Choose a date, today or earlier.'}</span>
      )}
    </span>
  );
};
