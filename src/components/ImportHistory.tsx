import React, { useState } from 'react';
import { ImportRecord, ErrorEntry } from '../services/ImportService';
import { History, AlertCircle, CheckCircle2, Clock, ChevronDown, ChevronRight } from 'lucide-react';

interface ImportHistoryProps {
  records: ImportRecord[];
  getErrorsFor: (importId: string, onData: (e: ErrorEntry[]) => void) => () => void;
}

export const ImportHistory: React.FC<ImportHistoryProps> = ({ records, getErrorsFor }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);

  const toggleExpand = (id: string) => {
    if (expandedId === id) { setExpandedId(null); setErrors([]); return; }
    setExpandedId(id);
    getErrorsFor(id, setErrors);
  };

  return (
    <div className="flex flex-col h-full bg-slate-100">
      <div className="px-6 py-4 bg-white border-b border-slate-200 shrink-0 flex items-center space-x-2">
        <History className="w-4 h-4 text-slate-500" />
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Import History</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {records.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center shadow-sm">
            <p className="text-slate-400 text-sm">No imports recorded yet.</p>
          </div>
        )}

        {records.map(r => {
          const isExpanded = expandedId === r.id;
          const hasErrors = r.failed > 0;
          return (
            <div key={r.id} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
              <button
                onClick={() => toggleExpand(r.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                  <div className="flex items-center space-x-2">
                    {hasErrors
                      ? <AlertCircle className="w-4 h-4 text-amber-500" />
                      : <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    }
                    <span className="font-bold text-sm uppercase text-slate-700">{r.vendor}</span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{r.parserName}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${r.confidence >= 90 ? 'bg-emerald-100 text-emerald-700' : r.confidence >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {r.confidence}% confidence
                  </span>
                </div>
                <div className="flex items-center space-x-4 text-[10px] font-mono text-slate-500">
                  <span className="flex items-center space-x-1"><Clock className="w-3 h-3" /><span>{(r.duration/1000).toFixed(1)}s</span></span>
                  <span className="text-emerald-600 font-bold">{r.imported} imported</span>
                  {r.updated > 0 && <span className="text-blue-600">{r.updated} updated</span>}
                  {r.topups > 0 && <span className="text-emerald-700">{r.topups} top-ups</span>}
                  {r.failed > 0 && <span className="text-red-600 font-bold">{r.failed} failed</span>}
                  {r.warnings > 0 && <span className="text-amber-600">{r.warnings} warnings</span>}
                  <span className="text-slate-400">{new Date(r.importedAt).toLocaleString()}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500 mb-2">
                    Report: {r.reportName} · {r.totalRows} total rows
                  </div>
                  {errors.length > 0 ? (
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="text-[9px] uppercase text-slate-400 border-b border-slate-200">
                          <th className="py-1.5">Row</th><th className="py-1.5">Error</th><th className="py-1.5">Raw Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.map(e => (
                          <tr key={e.id} className="border-b border-slate-100">
                            <td className="py-1.5 text-slate-500">{e.rowNumber}</td>
                            <td className="py-1.5 text-red-600">{e.error}</td>
                            <td className="py-1.5 text-slate-400 truncate max-w-xs">{e.rawData}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No errors logged for this import.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
