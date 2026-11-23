import React, { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUp, GripVertical } from 'lucide-react';
import { moveItem } from '../core/helpers/walletOrder';

/**
 * Put the wallets in the order wanted: drag a row, or use its arrows (a phone
 * has no drag). Nothing is written until Save, and then once, for everybody.
 */
export const WalletReorder: React.FC<{
  wallets: { id: string; vendorName: string }[];
  onSave: (ids: string[]) => Promise<void>;
  onCancel: () => void;
}> = ({ wallets, onSave, onCancel }) => {
  const [list, setList] = useState(wallets);
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = list.some((w, i) => w.id !== wallets[i]?.id);
  const move = (from: number, to: number) => setList(l => moveItem(l, from, to));

  const save = async () => {
    setBusy(true); setError('');
    try { await onSave(list.map(w => w.id)); onCancel(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The order could not be saved.'); setBusy(false); }
  };

  const btn = 'w-9 h-9 flex items-center justify-center rounded border border-slate-200 text-slate-600 hover:text-blue-700 disabled:opacity-30 disabled:hover:text-slate-600';
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-slate-600">Drag a vendor, or use the arrows. The order is the same for everyone.</span>
        <span className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 rounded border border-slate-200 hover:bg-slate-100">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!changed || busy}
            className="px-3 py-1.5 text-xs font-bold bg-blue-700 hover:bg-blue-800 text-white rounded disabled:opacity-40">
            {busy ? 'Saving…' : 'Save order'}
          </button>
        </span>
      </div>
      {error && <p role="alert" className="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">{error}</p>}
      <ol className="divide-y divide-slate-100">
        {list.map((w, i) => (
          <li key={w.id} draggable={!busy}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w.id); setDrag(i); }}
            onDragOver={e => { if (drag === null) return; e.preventDefault(); if (drag !== i) { move(drag, i); setDrag(i); } }}
            onDrop={e => { e.preventDefault(); setDrag(null); }}
            onDragEnd={() => setDrag(null)}
            className={`px-3 py-2 flex items-center gap-3 ${drag === i ? 'bg-blue-50' : ''}`}>
            <GripVertical className="w-4 h-4 text-slate-400 cursor-grab shrink-0 hidden md:block" aria-hidden="true" />
            <span className="w-6 text-right font-mono text-xs text-slate-400">{i + 1}</span>
            <span className="flex-1 min-w-0 truncate font-bold text-slate-700 uppercase text-xs tracking-wide">{w.vendorName}</span>
            <span className="flex gap-1.5">
              <button type="button" className={btn} disabled={i === 0 || busy} onClick={() => move(i, 0)}
                title="To the top" aria-label={`Move ${w.vendorName} to the top`}><ChevronsUp className="w-4 h-4" /></button>
              <button type="button" className={btn} disabled={i === 0 || busy} onClick={() => move(i, i - 1)}
                title="Up" aria-label={`Move ${w.vendorName} up`}><ArrowUp className="w-4 h-4" /></button>
              <button type="button" className={btn} disabled={i === list.length - 1 || busy} onClick={() => move(i, i + 1)}
                title="Down" aria-label={`Move ${w.vendorName} down`}><ArrowDown className="w-4 h-4" /></button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};
