import React, { useState, useMemo } from 'react';
import { Ticket } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';
import { knownSources } from '../core/config/sources';
import { CABIN_LABEL, type Cabin } from '../core/helpers/cabinClass';
import { X, PlusCircle, AlertTriangle } from 'lucide-react';

interface ManualEntryProps {
  /** Vendors holding a credit wallet. Suggested first, but not a restriction:
   *  plenty of tickets are bought from vendors that never hold a balance. */
  vendorNames: string[];
  /** Vendors already present in the ledger, so one entered by hand once is a
   *  suggestion the next time rather than something to retype exactly. */
  ledgerSources?: string[];
  onSave: (t: Ticket) => Promise<void>;
  onClose: () => void;
}

/** What the user is recording. REISSUE settles like an issue (the agency pays
 *  the fare difference) but is kept as its own choice so the ledger shows what
 *  actually happened rather than flattening every exchange into a sale. */
const TYPES = [
  { key: 'ISSUE',   label: 'Issue',   hint: 'New ticket — reduces the vendor credit' },
  { key: 'REFUND',  label: 'Refund',  hint: 'Money back — increases the vendor credit' },
  { key: 'REISSUE', label: 'Reissue', hint: 'Exchange — enter the fare difference only' },
  { key: 'VOID',    label: 'Void',    hint: 'Cancelled — recorded, no effect on credit' },
] as const;

type EntryType = typeof TYPES[number]['key'];

/** Sentinel for the dropdown entry that opens a free-text vendor name. Not a
 *  value anything is ever saved under. */
const OTHER = '__other__';

export const ManualEntry: React.FC<ManualEntryProps> = ({
  vendorNames, ledgerSources = [], onSave, onClose,
}) => {
  const [type, setType]       = useState<EntryType>('ISSUE');
  const [vendor, setVendor]   = useState(vendorNames[0] ?? '');
  /** True once "Other" is picked, swapping the dropdown for a text box. */
  const [typingVendor, setTypingVendor] = useState(false);
  const [ticketNo, setTicketNo] = useState('');
  const [pnr, setPnr]         = useState('');
  const [pax, setPax]         = useState('');
  const [route, setRoute]     = useState('');
  const [date, setDate]       = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount]   = useState('');
  const [reqNum, setReqNum]   = useState('');
  const [cabin, setCabin]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const currency = useMemo(() => sourceToCurrency(vendor), [vendor]);

  // Wallet holders first — they are what most entries are for — then the
  // formats the app knows and every vendor already in the ledger.
  const suggestions = useMemo(
    () => knownSources(vendorNames, ledgerSources),
    [vendorNames, ledgerSources],
  );
  /** Flagged, not blocked. A name the ledger has never seen is usually a real
   *  new vendor and occasionally a typo, and the user is the one who can tell
   *  the difference — so it is said plainly and the save goes ahead. */
  const isNewVendor = useMemo(() => {
    const v = vendor.trim().toLowerCase();
    return !!v && !suggestions.some(s => s.toLowerCase() === v);
  }, [vendor, suggestions]);
  const amountNum = Number(amount.replace(/[^0-9.-]/g, ''));
  const amountValid = amount.trim() !== '' && !Number.isNaN(amountNum) && amountNum !== 0;

  /** VOID is recorded at zero so it can never move a balance; a refund is
   *  stored negative regardless of how the user typed it, so entering "500"
   *  or "-500" both mean the same thing and can't accidentally be booked as
   *  a sale. */
  const ledgerAmount = type === 'VOID' ? 0
                     : type === 'REFUND' ? -Math.abs(amountNum)
                     : Math.abs(amountNum);

  const canSave = !!vendor && (!!ticketNo.trim() || !!pnr.trim()) && (type === 'VOID' || amountValid);

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError('');
    try {
      const ticket: Ticket = {
        id:              uuidv4(),
        ticketNo:        (ticketNo.trim() || pnr.trim()).toUpperCase(),
        pnr:             pnr.trim().toUpperCase(),
        passengerName:   pax.trim().toUpperCase(),
        airlineCode:     ticketNo.trim().replace(/\D/g, '').slice(0, 3),
        route:           route.trim().toUpperCase(),
        source:          vendor,
        date,
        amount:          ledgerAmount,
        totalDoc:        Math.abs(amountNum) || 0,
        commission:      0,
        reqNum:          reqNum.trim().toUpperCase(),
        // The raw carries the same wording, because it is the wording: a
        // cabin picked from a list has nothing else behind it.
        cabinClass:      cabin || undefined,
        cabinRaw:        cabin ? CABIN_LABEL[cabin as Exclude<Cabin, ''>] : undefined,
        vendorReference: '',
        // REISSUE settles like an issue, so it is stored as ISSUE for the
        // balance but keeps "REISSUE" as its transaction type for the record.
        status:          type === 'REISSUE' ? 'ISSUE' : type,
        transactionType: type,
        currency,
        reportName:      'Manual entry',
        importTime:      new Date().toISOString(),
        isDuplicate:     false,
        closed:          false,
        userId:          'temp',
      };
      await onSave(ticket);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const field = 'w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20';
  const label = 'text-[10px] font-bold uppercase text-slate-500 block mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <div className="flex items-center space-x-2">
            <PlusCircle className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-sm uppercase tracking-wider text-slate-700">Add Transaction Manually</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Type */}
          <div>
            <label className={label}>Transaction Type</label>
            <div className="grid grid-cols-4 gap-2">
              {TYPES.map(t => (
                <button key={t.key} onClick={() => setType(t.key)} title={t.hint}
                  className={`px-2 py-2 rounded text-[10px] font-bold uppercase border transition-colors ${
                    type === t.key
                      ? t.key === 'REFUND' ? 'bg-red-50 text-red-700 border-red-300'
                        : t.key === 'VOID' ? 'bg-slate-100 text-slate-700 border-slate-300'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 font-mono">{TYPES.find(t => t.key === type)!.hint}</p>
          </div>

          {/* Vendor + date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Vendor</label>
              {/* A real dropdown, listing every vendor, plus one entry that
                  opens a text box.

                  This was briefly a text input backed by a datalist, so that a
                  ticket from a vendor with no credit wallet could still be
                  recorded — IATA settles through BSP, Gold Medal invoices
                  directly, and neither holds a balance. But a datalist filters
                  itself against whatever is already typed, and the field starts
                  filled with a vendor name, so opening it showed that one
                  vendor and nothing else. The list has to be visible to be a
                  list. */}
              {typingVendor ? (
                <input
                  autoFocus
                  value={vendor}
                  onChange={e => setVendor(e.target.value)}
                  placeholder="Vendor name"
                  autoComplete="off"
                  className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              ) : (
                <select
                  value={vendor}
                  onChange={e => {
                    if (e.target.value === OTHER) { setTypingVendor(true); setVendor(''); }
                    else setVendor(e.target.value);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {suggestions.length === 0 && <option value="">— no vendors yet —</option>}
                  {suggestions.map(v => <option key={v} value={v}>{v}</option>)}
                  <option value={OTHER}>Other — type a name…</option>
                </select>
              )}
              <p className="text-[10px] text-slate-400 mt-1 font-mono">
                {vendor.trim() ? `Settles in ${currency}` : 'Pick or type a vendor'}
                {vendor.trim() && isNewVendor && ' · new vendor'}
                {typingVendor && (
                  <button type="button"
                          onClick={() => { setTypingVendor(false); setVendor(suggestions[0] ?? ''); }}
                          className="ml-2 text-blue-600 hover:underline">
                    back to the list
                  </button>
                )}
              </p>
            </div>
            <div>
              <label className={label}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
            </div>
            <div>
              {/* Recorded at the point of sale, which is the only place it is
                  ever known for certain. The ledger's older tickets have no
                  cabin because nothing asked for one, and the analytics can
                  only report what was written down. */}
              <label className={label}>Cabin</label>
              <select value={cabin} onChange={e => setCabin(e.target.value)} className={field}>
                <option value="">— not recorded —</option>
                <option value="ECONOMY">Economy</option>
                <option value="PREMIUM_ECONOMY">Premium Economy</option>
                <option value="BUSINESS">Business</option>
                <option value="FIRST">First</option>
              </select>
            </div>
          </div>

          {/* Identity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Ticket Number</label>
              <input type="text" value={ticketNo} onChange={e => setTicketNo(e.target.value)} placeholder="e.g. 0654860811922" className={field} />
            </div>
            <div>
              <label className={label}>PNR</label>
              <input type="text" value={pnr} onChange={e => setPnr(e.target.value)} placeholder="e.g. 8DFMBW" className={field} />
            </div>
          </div>
          <p className="text-[10px] text-slate-400 -mt-2 font-mono">Enter a ticket number or a PNR — at least one is needed to identify the row.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Passenger</label>
              <input type="text" value={pax} onChange={e => setPax(e.target.value)} placeholder="Full name" className={field} />
            </div>
            <div>
              <label className={label}>Route</label>
              <input type="text" value={route} onChange={e => setRoute(e.target.value)} placeholder="e.g. JED-RUH" className={field} />
            </div>
          </div>

          {/* Money */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Amount ({currency}){type === 'VOID' && ' — not applied'}</label>
              <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" disabled={type === 'VOID'}
                className={`${field} ${type === 'VOID' ? 'opacity-40' : ''}`} />
            </div>
            <div>
              <label className={label}>Req Number</label>
              <input type="text" value={reqNum} onChange={e => setReqNum(e.target.value)} placeholder="e.g. KSAML1928" className={field} />
            </div>
          </div>

          {/* Effect preview — shows exactly what will happen to the credit */}
          {vendor && (type === 'VOID' || amountValid) && (
            <div className={`rounded-lg p-3 border text-xs font-mono flex items-center justify-between ${
              ledgerAmount === 0 ? 'bg-slate-50 border-slate-200 text-slate-600'
              : ledgerAmount < 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
              <span>Effect on {vendor} credit</span>
              <span className="font-bold">
                {ledgerAmount === 0 ? 'No change'
                  : ledgerAmount < 0 ? `+${Math.abs(ledgerAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency}`
                  : `−${ledgerAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency}`}
              </span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[11px] text-red-700 font-mono flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded text-[10px] font-bold uppercase text-slate-500 hover:bg-white">Cancel</button>
          <button onClick={handleSave} disabled={!canSave || saving}
            className="px-4 py-2 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400">
            {saving ? 'Saving…' : `Save ${TYPES.find(t => t.key === type)!.label}`}
          </button>
        </div>
      </div>
    </div>
  );
};
