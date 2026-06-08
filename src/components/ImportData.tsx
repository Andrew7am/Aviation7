import React, { useRef, useState } from 'react';
import { Ticket } from '../types';
import { parseManualInput, detectDuplicates, detectDuplicatesAgainstExisting } from '../utils/parsing';
import { Upload, AlertTriangle, CheckCircle2, RefreshCw, Info } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ImportDataProps {
  existingTickets: Ticket[];
  onImport: (newTickets: Ticket[], updateTickets: Ticket[]) => void;
  currency?: string;
  setCurrency?: (c: 'SAR' | 'AED') => void;
}

const SOURCE_OPTIONS = [
  'Auto-detect', 'IATA', 'FlyAdeal KSA', 'FlyAdeal DXB',
  'Flynas', 'FlyDubai', 'AirArabia', 'RTS', 'Ibtekar', 'Gold Medal',
];

const STATUS_COLORS: Record<string, string> = {
  TKTT: 'bg-emerald-100 text-emerald-700',
  RFND: 'bg-red-100 text-red-700',
  VOID: 'bg-red-100 text-red-700',
  CANN: 'bg-slate-100 text-slate-500',
  CNJ: 'bg-blue-100 text-blue-700',
  EMDS: 'bg-purple-100 text-purple-700',
};

export const ImportData: React.FC<ImportDataProps> = ({
  existingTickets, onImport, currency = 'SAR', setCurrency,
}) => {
  const [inputText, setInputText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<Ticket[]>([]);
  const [updateCount, setUpdateCount] = useState(0);
  const [dupCount, setDupCount] = useState(0);
  const [defaultSource, setDefaultSource] = useState('Auto-detect');
  const [isUpdate, setIsUpdate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = evt.target?.result;
      if (typeof result === 'string') {
        setInputText(result);
      } else {
        try {
          const wb = XLSX.read(result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          setInputText(XLSX.utils.sheet_to_csv(ws));
        } catch {
          setErrors(['Failed to parse Excel file.']);
        }
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const handlePreview = () => {
    if (!inputText.trim()) { setErrors(['Please enter some data to parse.']); return; }
    const src = defaultSource === 'Auto-detect' ? undefined : defaultSource;
    const { tickets, errors: parseErrors } = parseManualInput(inputText, src);
    const batchChecked = detectDuplicates(tickets);
    const { fresh, updates, duplicates } = detectDuplicatesAgainstExisting(batchChecked, existingTickets);

    // mark updates
    const allPreview = [
      ...fresh,
      ...updates.map(t => ({ ...t, _isUpdate: true } as any)),
      ...duplicates,
    ];

    setPreview(allPreview);
    setUpdateCount(updates.length);
    setDupCount(duplicates.length);
    setErrors(parseErrors);
    setIsUpdate(updates.length > 0 && fresh.length === 0);
  };

  const handleConfirmImport = () => {
    if (preview.length === 0) return;
    const newTickets = preview.filter((t: any) => !t.isDuplicate && !t._isUpdate);
    const updateTickets = preview.filter((t: any) => t._isUpdate);
    onImport(newTickets, updateTickets);
    setInputText('');
    setPreview([]);
    setErrors([]);
    setUpdateCount(0);
    setDupCount(0);
  };

  const totalAmount = preview
    .filter((t: any) => !t.isDuplicate)
    .reduce((s, t) => s + t.amount, 0);

  return (
    <div className="flex flex-col h-full bg-slate-100 p-4 space-y-4">
      <div className="flex justify-between items-center shrink-0">
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Bulk Ticket Import</h2>
      </div>

      {/* Options bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm shrink-0 flex flex-wrap items-end gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Source</label>
          <select
            value={defaultSource}
            onChange={e => setDefaultSource(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-xs font-bold uppercase text-slate-700 px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Currency</label>
          <select
            value={currency}
            onChange={e => setCurrency?.(e.target.value as 'SAR' | 'AED')}
            className="bg-slate-50 border border-slate-200 text-xs font-bold uppercase text-slate-700 px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="SAR">SAR</option>
            <option value="AED">AED</option>
          </select>
        </div>
        <div className="ml-auto flex items-center space-x-2 text-[10px] text-slate-400 font-mono bg-slate-50 border border-slate-200 rounded px-3 py-2">
          <Info className="w-3 h-3 text-blue-400" />
          <span>Re-importing a file with Req Nums will auto-match existing tickets by Ticket No.</span>
        </div>
      </div>

      {/* Paste / upload area */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm shrink-0">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-bold uppercase text-slate-500">Data Input (Paste CSV or Upload)</label>
          <div className="flex space-x-2">
            <input
              type="file"
              accept=".csv,.txt,.xls,.xlsx"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1 flex items-center space-x-2 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold uppercase text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <Upload className="w-3 h-3" />
              <span>Upload File</span>
            </button>
          </div>
        </div>
        <textarea
          rows={6}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none shadow-inner"
          placeholder="Paste CSV / Excel data here, or upload a file above..."
        />
        <div className="flex justify-end space-x-2 mt-3">
          <button
            onClick={() => { setInputText(''); setPreview([]); setErrors([]); }}
            className="px-3 py-1.5 border border-slate-200 rounded text-[10px] font-bold uppercase text-slate-500 hover:bg-slate-50"
          >
            Clear
          </button>
          <button
            onClick={handlePreview}
            className="px-4 py-1.5 bg-slate-800 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-slate-700 shadow-sm"
          >
            Run Validation
          </button>
        </div>
      </div>

      {/* Preview table */}
      {preview.length > 0 && (
        <div className="flex-1 bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm flex flex-col min-h-[280px]">
          <div className="flex justify-between items-center p-3 border-b border-slate-100 bg-slate-50 shrink-0 flex-wrap gap-2">
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] font-bold uppercase text-slate-600">
                Validation Passed — {preview.filter((t: any) => !t.isDuplicate).length} tickets
              </span>
              {updateCount > 0 && (
                <span className="bg-blue-100 text-blue-700 text-[9px] font-bold px-1.5 py-0.5 rounded">
                  {updateCount} REQ UPDATES
                </span>
              )}
              {dupCount > 0 && (
                <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded">
                  {dupCount} DUPLICATES SKIPPED
                </span>
              )}
              <span className="text-[10px] font-mono text-slate-500">
                Net: {currency} {fmt(totalAmount)}
              </span>
            </div>
            <button
              onClick={handleConfirmImport}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700 shadow-sm flex items-center space-x-1.5"
            >
              {isUpdate
                ? <><RefreshCw className="w-3 h-3" /><span>Apply Req Updates</span></>
                : <><CheckCircle2 className="w-3 h-3" /><span>Confirm & Import</span></>
              }
            </button>
          </div>

          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <tr>
                  {['Ticket No.', 'Source', 'Status', 'Date', 'Total Doc', 'Comm', 'Net Amount', 'PNR', 'Passenger', 'Req Num'].map(col => (
                    <th key={col} className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap border-b border-slate-200">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-xs font-mono">
                {preview.map((t: any) => {
                  const isDup = t.isDuplicate;
                  const isUpd = t._isUpdate;
                  return (
                    <tr
                      key={t.id}
                      className={`border-b border-slate-100 ${isDup ? 'bg-amber-50 opacity-60' : isUpd ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2 font-bold select-all whitespace-nowrap">
                        {t.ticketNo}
                        {isDup && <span className="ml-1.5 bg-amber-400 text-black px-1 rounded text-[8px] font-bold">DUP</span>}
                        {isUpd && <span className="ml-1.5 bg-blue-500 text-white px-1 rounded text-[8px] font-bold">UPDATE</span>}
                      </td>
                      <td className="px-3 py-2">
                        {t.source
                          ? <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold uppercase bg-slate-100 text-slate-700">{t.source}</span>
                          : <span className="text-red-400 text-[9px] italic">Missing</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        {t.status
                          ? <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-600'}`}>{t.status}</span>
                          : <span className="text-slate-300">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{t.date}</td>
                      <td className="px-3 py-2 text-slate-500">{t.totalDoc > 0 ? fmt(t.totalDoc) : '—'}</td>
                      <td className="px-3 py-2 text-slate-400">{t.commission > 0 ? fmt(t.commission) : '—'}</td>
                      <td className={`px-3 py-2 font-bold ${t.amount < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {t.amount < 0 ? '-' : ''}{currency} {fmt(Math.abs(t.amount))}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{t.pnr || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{t.passengerName || '—'}</td>
                      <td className={`px-3 py-2 font-bold ${t.reqNum ? 'text-blue-600' : 'text-red-400 italic'}`}>
                        {t.reqNum || 'MISSING'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Parser warnings */}
      {errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 shadow-sm shrink-0">
          <div className="flex items-center space-x-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <h4 className="text-[10px] font-bold uppercase text-amber-700">Parser Warnings ({errors.length})</h4>
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {errors.map((err, i) => (
              <li key={i} className="text-[10px] font-mono text-amber-700 flex items-start space-x-1.5">
                <span className="text-amber-400 shrink-0">▸</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
