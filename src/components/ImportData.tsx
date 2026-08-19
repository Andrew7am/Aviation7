import React, { useRef, useState, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import { Ticket } from '../types';
import { useImport, ImportMeta } from '../hooks/useImport';
import { ClassifiedRow, ReconClass, RECON_LABEL } from '../core/ImportEngine';
import { sourceToCurrency } from '../core/helpers/sourceCurrency';
import { findHeaderRow } from '../core/helpers/columnResolver';
import { LearnedProfile, bestHeaderRowForAI } from '../core/ai/learnedProfile';
import { Upload, AlertTriangle, CheckCircle2, Info, Gauge, Database, Sparkles } from 'lucide-react';
import { VendorReferenceService, VendorReference } from '../services/VendorReferenceService';
import { AIProfileService } from '../services/AIProfileService';

const vendorRefSvc = new VendorReferenceService();
const aiProfileSvc = new AIProfileService();

interface ImportDataProps {
  userId: string;
  onImport: (newTickets: Ticket[], updateTickets: Ticket[], topUpTickets: Ticket[], meta: ImportMeta) => void;
  vendorNames?: string[];
}

const BUILTIN_SOURCES = [
  'IATA', 'NSA', 'FlyAdeal KSA', 'FlyAdeal DXB',
  'Flynas', 'FlyDubai', 'AirArabia', 'RTS', 'Ibtekar', 'Gold Medal', 'Riyadh Air', 'Turkish Airlines',
];

const STATUS_COLORS: Record<string, string> = {
  ISSUE: 'bg-emerald-100 text-emerald-700', REFUND: 'bg-red-100 text-red-700',
  FUND: 'bg-emerald-200 text-emerald-800', VOID: 'bg-slate-200 text-slate-600',
  ADM: 'bg-blue-100 text-blue-700', ACM: 'bg-purple-100 text-purple-700',
  HOLD: 'bg-amber-100 text-amber-800', EMDS: 'bg-purple-100 text-purple-700',
};

/** Reconciliation verdict colours. Commission gaps are money the ledger is
 *  missing, so they read as a warning rather than a neutral difference. */
const RECON_COLORS: Record<ReconClass, string> = {
  NEW:                'bg-emerald-100 text-emerald-700',
  EXACT_MATCH:        'bg-slate-100 text-slate-500',
  COMMISSION_MISSING: 'bg-red-100 text-red-700',
  COMMISSION_DIFF:    'bg-amber-100 text-amber-700',
  FARE_DIFF:          'bg-amber-100 text-amber-700',
  PAYABLE_DIFF:       'bg-amber-100 text-amber-700',
  DATE_DIFF:          'bg-blue-100 text-blue-700',
  CHANNEL_DIFF:       'bg-violet-100 text-violet-700',
  DUPLICATE:          'bg-slate-200 text-slate-600',
};

const verdictKey = (ticketNo: string, amount: number) =>
  `${ticketNo.trim().toUpperCase()}|${amount < 0 ? '-' : '+'}`;

export const ImportData: React.FC<ImportDataProps> = ({
  userId, onImport, vendorNames = [],
}) => {
  const { preview, inputText, setInputText, runValidation, readFileAsText, clear, buildMeta } = useImport(userId);
  const [defaultSource, setDefaultSource] = useState('Auto-detect');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [refVendors, setRefVendors] = useState<VendorReference[]>([]);
  const [refVendorSlug, setRefVendorSlug] = useState('');
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState('');

  const [aiProfiles, setAiProfiles] = useState<LearnedProfile[]>([]);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiMessage, setAiMessage] = useState('');

  useEffect(() => {
    vendorRefSvc.listVendors()
      .then(v => { setRefVendors(v); if (v.length > 0) setRefVendorSlug(v[0].slug); })
      .catch(e => setRefError(e.message));
    aiProfileSvc.listProfiles()
      .then(setAiProfiles)
      .catch(e => console.error('ai profiles load error', e));
  }, []);

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sourceOptions = useMemo(() => {
    const builtinLower = new Set(BUILTIN_SOURCES.map(s => s.toLowerCase()));
    return ['Auto-detect', ...BUILTIN_SOURCES, ...vendorNames.filter(vn => !builtinLower.has(vn.toLowerCase()))];
  }, [vendorNames]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setInputText(await readFileAsText(file)); } catch { /* surfaced via validation errors */ }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLoadReference = async () => {
    if (!refVendorSlug) return;
    setRefLoading(true);
    setRefError('');
    try {
      const csv = await vendorRefSvc.fetchVendorCsv(refVendorSlug);
      setInputText(csv);
      const vendor = refVendors.find(v => v.slug === refVendorSlug);
      if (vendor) setDefaultSource('Auto-detect'); // let the parser detect from real headers
    } catch (e) {
      setRefError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefLoading(false);
    }
  };

  const handlePreview = (profiles: LearnedProfile[] = aiProfiles) => {
    const src = defaultSource === 'Auto-detect' ? undefined : defaultSource;
    runValidation(inputText, src, 'SAR', src, profiles).catch(console.error);
  };

  /**
   * One-time AI mapping for an unknown format: send headers + a sample of
   * rows to the server-side analyzer, save the returned profile, then re-run
   * the normal validation — which now recognizes the format deterministically
   * (and will forever, without another AI call).
   */
  const handleAnalyzeWithAI = async () => {
    setAiAnalyzing(true);
    setAiMessage('');
    try {
      const allRows = Papa.parse(inputText.trim(), { skipEmptyLines: true }).data as string[][];
      if (allRows.length < 2) throw new Error('Not enough rows to analyze.');
      const headerRowIdx = bestHeaderRowForAI(allRows, findHeaderRow(allRows));
      const headers = allRows[headerRowIdx];
      const sampleRows = allRows.slice(headerRowIdx + 1, headerRowIdx + 16);

      const profile = await aiProfileSvc.analyzeReport(headers, sampleRows);
      await aiProfileSvc.saveProfile(profile);
      const updated = [...aiProfiles.filter(p => p.fingerprint !== profile.fingerprint), profile];
      setAiProfiles(updated);
      setAiMessage(`✓ Learned "${profile.vendorName}" — this format is now recognized permanently.`);
      handlePreview(updated);
    } catch (e) {
      setAiMessage(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleConfirm = () => {
    if (!preview) return;
    const meta = buildMeta(defaultSource);
    if (!meta) return;
    onImport(preview.fresh, preview.updates, preview.topUps, meta);
    clear();
    setDefaultSource('Auto-detect');
  };

  /** Reconciliation verdict per row, keyed by ticket id. Display only —
   *  what actually gets saved is still decided by fresh/updates/duplicates. */
  const verdicts = useMemo(() => {
    const m = new Map<string, ClassifiedRow>();
    // Keyed on ticket number + direction of money, NOT on row id: an update
    // row is re-issued carrying the EXISTING record's id, so an id lookup
    // would silently miss exactly the rows whose verdict matters most.
    for (const c of preview?.classified ?? []) m.set(verdictKey(c.ticket.ticketNo, c.ticket.amount), c);
    return m;
  }, [preview]);
  const verdictFor = (ticketNo: string, amount: number) => verdicts.get(verdictKey(ticketNo, amount));

  // Flatten preview into one renderable list, tagging dup/update for styling
  const rows = preview
    ? [
        ...preview.topUps,
        ...preview.fresh,
        ...preview.updates.map(t => ({ ...t, _isUpdate: true } as any)),
        ...preview.duplicates,
      ]
    : [];

  const totalNet = rows
    .filter((t: any) => !t.isDuplicate && t.status !== 'FUND')
    .reduce((s, t) => s + t.amount, 0);

  return (
    <div className="flex flex-col h-full bg-slate-100 p-4 space-y-4">
      <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest shrink-0">Bulk Ticket Import</h2>

      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm shrink-0 flex flex-wrap items-end gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1.5">Source / Vendor</label>
          <select value={defaultSource} onChange={e => setDefaultSource(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-xs font-bold uppercase text-slate-700 px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[160px]">
            {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center space-x-2 text-[10px] text-slate-400 font-mono bg-slate-50 border border-slate-200 rounded px-3 py-2">
          <Info className="w-3 h-3 text-blue-400 shrink-0" />
          <span>Re-import with Req Nums to auto-match existing tickets by Ticket No.</span>
        </div>
      </div>

      {refVendors.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 shadow-sm shrink-0 flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[10px] font-bold uppercase text-blue-700 flex items-center gap-1 mb-1.5">
              <Database className="w-3 h-3" /> Load Reference Data (Supabase)
            </label>
            <select value={refVendorSlug} onChange={e => setRefVendorSlug(e.target.value)}
              className="bg-white border border-blue-200 text-xs font-bold uppercase text-slate-700 px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[200px]">
              {refVendors.map(v => <option key={v.slug} value={v.slug}>{v.displayName} ({v.seedRows} rows)</option>)}
            </select>
          </div>
          <button onClick={handleLoadReference} disabled={refLoading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700 shadow-sm disabled:opacity-50">
            {refLoading ? 'Loading…' : 'Load into Data Input'}
          </button>
          {refError && <span className="text-[10px] text-red-600 font-mono">{refError}</span>}
          <span className="text-[10px] text-blue-600 font-mono ml-auto">Loads the vendor's canonical data below — review, then Run Validation as usual.</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm shrink-0">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-bold uppercase text-slate-500">Data Input</label>
          <div className="flex space-x-2">
            <input type="file" accept=".csv,.txt,.xls,.xlsx,.pdf" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            <button onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1 flex items-center space-x-2 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold uppercase text-slate-600 hover:bg-slate-200">
              <Upload className="w-3 h-3" /><span>Upload File</span>
            </button>
          </div>
        </div>
        <textarea rows={6} value={inputText} onChange={e => setInputText(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none shadow-inner"
          placeholder="Paste CSV / Excel data here, or upload a file..." />
        <div className="flex justify-end space-x-2 mt-3">
          <button onClick={clear}
            className="px-3 py-1.5 border border-slate-200 rounded text-[10px] font-bold uppercase text-slate-500 hover:bg-slate-50">Clear</button>
          <button onClick={() => handlePreview()}
            className="px-4 py-1.5 bg-slate-800 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-slate-700 shadow-sm">
            Run Validation
          </button>
        </div>
      </div>

      {/* Unknown format (or a parser that matched but extracted nothing) →
          one-time AI analysis. Covers both "no parser detected" and "user
          picked a vendor whose format has since changed and it parsed 0 rows". */}
      {preview && (preview.confidence === 0 ||
        (preview.fresh.length + preview.updates.length + preview.duplicates.length + preview.topUps.length) === 0) && (
        <div className="shrink-0 rounded-lg px-4 py-3 flex items-center justify-between border bg-violet-50 border-violet-200">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-violet-600" />
            <span className="text-[10px] font-bold uppercase text-violet-800">
              Unknown report format — let AI map it once, then it's recognized forever
            </span>
          </div>
          <button onClick={handleAnalyzeWithAI} disabled={aiAnalyzing}
            className="px-4 py-1.5 bg-violet-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-violet-700 shadow-sm disabled:opacity-50 flex items-center space-x-1.5">
            <Sparkles className="w-3 h-3" /><span>{aiAnalyzing ? 'Analyzing…' : 'Analyze with AI'}</span>
          </button>
        </div>
      )}
      {aiMessage && (
        <div className={`shrink-0 rounded-lg px-4 py-2 border text-[10px] font-mono ${aiMessage.startsWith('✓') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {aiMessage}
        </div>
      )}

      {/* Parser confidence banner */}
      {preview && preview.parserName && (
        <div className={`shrink-0 rounded-lg px-4 py-2 flex items-center justify-between border ${
          preview.confidence >= 90 ? 'bg-emerald-50 border-emerald-200' :
          preview.confidence >= 60 ? 'bg-amber-50 border-amber-200' :
          'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center space-x-2">
            <Gauge className={`w-4 h-4 ${preview.confidence >= 90 ? 'text-emerald-600' : preview.confidence >= 60 ? 'text-amber-600' : 'text-red-600'}`} />
            <span className="text-[10px] font-bold uppercase">
              Detected: <span className="font-mono">{preview.parserName}</span> · {preview.confidence}% confidence
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">{preview.totalRows} rows in file</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex-1 bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm flex flex-col min-h-[280px]">
          <div className="flex justify-between items-center p-3 border-b border-slate-100 bg-slate-50 shrink-0 flex-wrap gap-2">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] font-bold uppercase text-slate-600">
                {rows.filter((t: any) => !t.isDuplicate && t.status !== 'FUND').length} tickets
              </span>
              {preview!.topUps.length > 0 && <span className="bg-emerald-100 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded">{preview!.topUps.length} TOP-UPS</span>}
              {preview!.updates.length > 0 && <span className="bg-blue-100 text-blue-700 text-[9px] font-bold px-1.5 py-0.5 rounded">{preview!.updates.length} REQ UPDATES</span>}
              {preview!.duplicates.length > 0 && <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded">{preview!.duplicates.length} DUPS SKIPPED</span>}
              <span className="text-[10px] font-mono text-slate-500">Net: {fmt(totalNet)}</span>
            </div>
            <button onClick={handleConfirm}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700 shadow-sm flex items-center space-x-1.5">
              <CheckCircle2 className="w-3 h-3" /><span>Confirm & Import</span>
            </button>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <tr>
                  {['Serial','A/L','Ticket No.','Source','Type','Date','Route','Fare','Commission','Balance Payable','Curr','PNR','Passenger','Req Num','Status'].map(col => (
                    <th key={col} className="px-3 py-2 text-[9px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap border-b border-slate-200">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-xs font-mono">
                {rows.map((t: any) => {
                  const isDup = t.isDuplicate, isUpd = t._isUpdate, isFund = t.status === 'FUND';
                  return (
                    <tr key={t.id} className={`border-b border-slate-100 ${isDup ? 'bg-amber-50 opacity-60' : isUpd ? 'bg-blue-50' : isFund ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{t.serial ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-center">{t.airlineCode ? <span className="font-mono font-black text-[11px] text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{t.airlineCode}</span> : <span className="text-slate-300 text-[9px]">—</span>}</td>
                      <td className="px-3 py-2 font-bold select-all whitespace-nowrap">
                        {t.ticketNo}
                        {isDup && <span className="ml-1 bg-amber-400 text-black px-1 rounded text-[8px] font-bold">DUP</span>}
                        {isUpd && <span className="ml-1 bg-blue-500 text-white px-1 rounded text-[8px] font-bold">UPD</span>}
                      </td>
                      <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold uppercase bg-slate-100 text-slate-700">{t.source || '—'}</span></td>
                      <td className="px-3 py-2">{t.status ? <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-500'}`}>{t.status}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{t.date}</td>
                      <td className="px-3 py-2 text-slate-400 text-[10px] max-w-[80px] truncate">{t.route || '—'}</td>
                      {/* Fare | Commission | Balance Payable, always all three.
                          `> 0` would hide a refund's negative commission and
                          make the payable look wrong for no visible reason. */}
                      <td className="px-3 py-2 text-slate-500">{t.totalDoc ? fmt(t.totalDoc) : '—'}</td>
                      <td className={`px-3 py-2 ${t.commission < 0 ? 'text-red-500' : 'text-slate-400'}`}>{t.commission ? fmt(t.commission) : '—'}</td>
                      <td className={`px-3 py-2 font-bold ${t.amount < 0 ? 'text-red-600' : ''}`}>{t.amount < 0 ? '-' : ''}{fmt(Math.abs(t.amount))}</td>
                      <td className="px-3 py-2 text-slate-400 text-[9px]">{t.currency || sourceToCurrency(t.source || '')}</td>
                      <td className="px-3 py-2 text-slate-600">{t.pnr || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{t.passengerName || '—'}</td>
                      <td className={`px-3 py-2 font-bold ${t.reqNum ? 'text-blue-600' : 'text-red-400 italic'}`}>{t.reqNum || 'MISSING'}</td>
                      <td className="px-3 py-2">
                        {(() => {
                          const v = verdictFor(t.ticketNo, t.amount);
                          if (!v) return <span className="text-slate-300 text-[9px]">—</span>;
                          return (
                            <span
                              title={v.cls === 'COMMISSION_MISSING'
                                ? `Invoice charges ${fmt(Math.abs(v.delta.commission))} commission the system does not have — payable differs by ${fmt(Math.abs(v.delta.payable))}`
                                : undefined}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold whitespace-nowrap ${RECON_COLORS[v.cls]}`}
                            >
                              {RECON_LABEL[v.cls]}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {preview && (preview.errors.length > 0 || preview.warnings.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 shadow-sm shrink-0">
          <div className="flex items-center space-x-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <h4 className="text-[10px] font-bold uppercase text-amber-700">Warnings ({preview.errors.length + preview.warnings.length})</h4>
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {[...preview.errors.map(e => e.error), ...preview.warnings].map((msg, i) => (
              <li key={i} className="text-[10px] font-mono text-amber-700 flex items-start space-x-1.5">
                <span className="text-amber-400 shrink-0">▸</span><span>{msg}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
