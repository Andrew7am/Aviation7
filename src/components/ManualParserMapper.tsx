import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { readFileAsText } from '../core/ImportEngine';
import { runParser } from '../core/parsers';
import { headerFingerprint, LearnedColumns, LearnedProfile, LearnedRules, PROFILE_FIELDS } from '../core/ai/learnedProfile';
import { AIProfileService } from '../services/AIProfileService';
import { FileUp, ChevronRight, ChevronLeft, Save, X, Info, CheckCircle2 } from 'lucide-react';

const svc = new AIProfileService();

/** The user-facing name for each mapping slot, and a short line saying what
 *  it is. The names on the left are what people say when they talk about a
 *  report; the descriptions on the right are what tells someone new which
 *  column to pick without opening the code. */
const FIELD_META: Record<keyof LearnedColumns, { label: string; hint: string; kind: 'row-id' | 'money' | 'meta' }> = {
  ticket:     { label: 'Ticket Number',    hint: 'The document number that identifies the sale.',                              kind: 'row-id' },
  pnr:        { label: 'PNR / Booking Ref',hint: 'The airline\'s reservation reference. Used as the row id when there is no ticket number.', kind: 'row-id' },
  amount:     { label: 'Amount',           hint: 'One column carrying the fare (signed: negative for a refund).',              kind: 'money' },
  debit:      { label: 'Debit',            hint: 'When debit and credit are split into two columns, this is the sale side.',    kind: 'money' },
  credit:     { label: 'Credit',           hint: 'When debit and credit are split into two columns, this is the refund side.',  kind: 'money' },
  total:      { label: 'Total Doc',        hint: 'Face value of the document, before commission is taken off.',                 kind: 'money' },
  commission: { label: 'Commission',       hint: 'Agent commission on the sale.',                                               kind: 'money' },
  date:       { label: 'Date',             hint: 'Issue date of the row. Leave blank when the report has no date column.',      kind: 'meta' },
  passenger:  { label: 'Passenger',        hint: 'Passenger name — for the record; nothing depends on it.',                     kind: 'meta' },
  status:     { label: 'Status',           hint: 'Transaction type column, e.g. TKTT / RFND / VOID.',                           kind: 'meta' },
  currency:   { label: 'Currency',         hint: 'Currency column, when the report has one per row.',                           kind: 'meta' },
  route:      { label: 'Route',            hint: 'Origin–destination string, e.g. RUH-JED.',                                    kind: 'meta' },
  req:        { label: 'Req Number',       hint: 'Your internal request number, when the vendor prints it back on their report.', kind: 'meta' },
};

/** Group the fields for the UI. Row identifier first — the mapping cannot be
 *  saved without at least one — then money, then everything else. */
const FIELD_GROUPS: { title: string; kind: 'row-id' | 'money' | 'meta'; note: string }[] = [
  { title: 'Row identifier', kind: 'row-id', note: 'At least one of these has to be mapped — it is what the app treats as the row\'s primary key.' },
  { title: 'Money',          kind: 'money',  note: 'Either a single Amount column, or a Debit/Credit pair. Pick one shape or the other.' },
  { title: 'Everything else',kind: 'meta',   note: 'Optional. Leave blank when the column is not in this report.' },
];

/** Empty option in every dropdown, so the user is answering "yes it is this
 *  column" rather than accidentally landing on the first one. */
const UNMAPPED = '__unmapped__';

interface Props { onDone: () => void }

export const ManualParserMapper: React.FC<Props> = ({ onDone }) => {
  const [step, setStep]         = useState<1 | 2 | 3 | 4>(1);
  const [rawRows, setRawRows]   = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(-1);
  const [vendorName, setVendorName] = useState('');
  const [columns, setColumns]   = useState<LearnedColumns>({});
  const [rules, setRules]       = useState<LearnedRules>({ refund: 'negative_amount' });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState(false);

  const headers = headerRowIdx >= 0 ? rawRows[headerRowIdx] ?? [] : [];
  const bodyRows = headerRowIdx >= 0 ? rawRows.slice(headerRowIdx + 1) : [];

  const handleFile = async (file: File) => {
    setError('');
    try {
      const text = await readFileAsText(file);
      const parsed = Papa.parse(text.trim(), { skipEmptyLines: true }).data as string[][];
      if (parsed.length === 0) throw new Error('The file has no readable rows.');
      setRawRows(parsed);
      setFileName(file.name);
      // Best guess for the header row: the densest of the first fifteen. The
      // user can (and should) confirm it below — the guess is a starting
      // point, not a decision.
      let best = 0, bestCount = 0;
      for (let i = 0; i < Math.min(15, parsed.length); i++) {
        const n = parsed[i].filter(c => c?.trim()).length;
        if (n > bestCount) { bestCount = n; best = i; }
      }
      setHeaderRowIdx(best);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** A profile is savable when it names the vendor, points at a header row,
   *  identifies each row somehow, and knows where the money is. Anything less
   *  would be a mapping that could not parse a single ticket. */
  const canSave = useMemo(() => {
    if (!vendorName.trim()) return false;
    if (headers.length === 0) return false;
    if (!columns.ticket && !columns.pnr) return false;
    const hasMoney = !!columns.amount || !!(columns.debit || columns.credit) || !!columns.total;
    return hasMoney;
  }, [vendorName, headers, columns]);

  /** A dry run of the profile against the file the user just uploaded — same
   *  parser the real import uses, so what shows here is what a real import
   *  would produce. Nothing is written. */
  const previewProfile: LearnedProfile | null = useMemo(() => {
    if (!vendorName.trim() || headers.length === 0) return null;
    return {
      vendorName: vendorName.trim(),
      fingerprint: headerFingerprint(headers),
      isLCC: !columns.ticket && !!columns.pnr,
      headers,
      columns,
      rules,
      origin: 'manual',
    };
  }, [vendorName, headers, columns, rules]);

  const dryRun = useMemo(() => {
    if (!previewProfile || step !== 4) return null;
    try {
      const { rows, errors, warnings } = runParser(
        rawRows, undefined, 'SAR', undefined, [previewProfile]
      );
      // The parser only accepts a ticket number with six or more digits in it.
      // A reference like "BK00234" fails that and quietly becomes a generated
      // placeholder — the rows still import, but they no longer carry the
      // reference the vendor and the agency actually talk about. Caught here
      // rather than left to be discovered months later in a dispute.
      const placeholders = rows.filter(r => /_NOREF_/.test(r.ticketNo)).length;
      return { rows, errors, warnings, placeholders };
    } catch (e) {
      return { rows: [], errors: [(e as Error).message], warnings: [], placeholders: 0 };
    }
  }, [previewProfile, rawRows, step]);

  const doSave = async () => {
    if (!previewProfile) return;
    setSaving(true); setError('');
    try {
      await svc.saveProfile(previewProfile);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-5xl mx-auto bg-white border border-slate-200 rounded-lg shadow-sm p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Teach a new report format</div>
          <div className="text-sm text-slate-600 mt-1">
            Point the app at a sample file and name what each column means. It stores the mapping and every future file with the same columns is read the same way — no re-teaching.
          </div>
        </div>
        <button onClick={onDone} className="text-slate-400 hover:text-slate-600" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <Steps step={step} />

      {error && (
        <div className="rounded px-3 py-2 bg-red-50 border border-red-200 text-[11px] text-red-700 font-mono">{error}</div>
      )}

      {step === 1 && <UploadStep onFile={handleFile} />}

      {step === 2 && (
        <HeaderPickStep
          rawRows={rawRows} fileName={fileName}
          headerRowIdx={headerRowIdx} setHeaderRowIdx={setHeaderRowIdx}
          onBack={() => { setStep(1); setRawRows([]); setHeaderRowIdx(-1); }}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <MapStep
          vendorName={vendorName} setVendorName={setVendorName}
          headers={headers} sampleBody={bodyRows.slice(0, 3)}
          columns={columns} setColumns={setColumns}
          rules={rules} setRules={setRules}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
          canProceed={canSave}
        />
      )}

      {step === 4 && (
        <PreviewSaveStep
          profile={previewProfile}
          dryRun={dryRun}
          saved={saved}
          saving={saving}
          onBack={() => setStep(3)}
          onSave={doSave}
          onDone={onDone}
        />
      )}
    </div>
  );
};

/* ── step 1 · upload ────────────────────────────────────────────────────── */

const UploadStep: React.FC<{ onFile: (f: File) => void }> = ({ onFile }) => (
  <div className="border-2 border-dashed border-slate-200 rounded-lg py-16 text-center">
    <FileUp className="w-8 h-8 text-slate-300 mx-auto mb-3" />
    <p className="text-xs text-slate-500 mb-3">Upload one sample file of the new report format.</p>
    <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded text-[11px] font-bold uppercase tracking-wider cursor-pointer hover:bg-blue-700">
      Choose a file
      <input type="file" accept=".csv,.txt,.xls,.xlsx"
             className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
    <p className="text-[10px] text-slate-400 mt-3">CSV, TXT, XLS or XLSX. One sheet, one report.</p>
  </div>
);

/* ── step 2 · pick the header row ───────────────────────────────────────── */

const HeaderPickStep: React.FC<{
  rawRows: string[][]; fileName: string;
  headerRowIdx: number; setHeaderRowIdx: (n: number) => void;
  onBack: () => void; onNext: () => void;
}> = ({ rawRows, fileName, headerRowIdx, setHeaderRowIdx, onBack, onNext }) => {
  const shown = rawRows.slice(0, 15);
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
        <span>Click the row that has the column names — the one with words like Ticket, Date, Amount. The rows above are usually a title or a date range.</span>
      </div>
      <div className="text-[10px] font-mono text-slate-400">{fileName}</div>
      <div className="border border-slate-200 rounded overflow-auto max-h-[420px]">
        <table className="w-full text-[10px] font-mono">
          <tbody>
            {shown.map((row, i) => {
              const active = i === headerRowIdx;
              return (
                <tr key={i} onClick={() => setHeaderRowIdx(i)}
                    className={`cursor-pointer border-b border-slate-100 ${
                      active ? 'bg-blue-50 ring-1 ring-inset ring-blue-300'
                             : 'hover:bg-slate-50'
                    }`}>
                  <td className={`px-2 py-1.5 text-slate-400 w-10 text-center ${active ? 'text-blue-600 font-bold' : ''}`}>{i}</td>
                  {row.slice(0, 20).map((c, j) => (
                    <td key={j} className={`px-2 py-1.5 whitespace-nowrap ${active ? 'text-blue-800 font-bold' : 'text-slate-600'}`}>
                      {c || <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <NavRow onBack={onBack} onNext={onNext} canNext={headerRowIdx >= 0} />
    </div>
  );
};

/* ── step 3 · column mapping + rules ────────────────────────────────────── */

const MapStep: React.FC<{
  vendorName: string; setVendorName: (s: string) => void;
  headers: string[]; sampleBody: string[][];
  columns: LearnedColumns; setColumns: (c: LearnedColumns) => void;
  rules: LearnedRules; setRules: (r: LearnedRules) => void;
  onBack: () => void; onNext: () => void; canProceed: boolean;
}> = ({ vendorName, setVendorName, headers, sampleBody, columns, setColumns, rules, setRules, onBack, onNext, canProceed }) => {

  const setField = (field: keyof LearnedColumns, header: string) => {
    const next = { ...columns };
    if (header === UNMAPPED) delete next[field];
    else next[field] = header;
    setColumns(next);
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="text-[10px] font-bold uppercase text-slate-500">Name this format</label>
        <input type="text" value={vendorName} onChange={e => setVendorName(e.target.value)}
               placeholder="e.g. NSA Sales Report"
               className="mt-1 w-full max-w-sm px-3 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        <p className="text-[10px] text-slate-400 mt-1">Any name is fine. It appears in Import History so you can tell reports apart.</p>
      </div>

      {FIELD_GROUPS.map(g => (
        <div key={g.title}>
          <div className="text-[10px] font-bold uppercase text-slate-500">{g.title}</div>
          <div className="text-[10px] text-slate-400 mb-2">{g.note}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROFILE_FIELDS.filter(f => FIELD_META[f].kind === g.kind).map(f => {
              const picked = columns[f] ?? '';
              const sample = pickedSample(headers, sampleBody, picked);
              return (
                <div key={f} className="border border-slate-200 rounded p-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-slate-600">{FIELD_META[f].label}</div>
                    <div className="text-[9px] text-slate-400 leading-tight">{FIELD_META[f].hint}</div>
                    <select value={picked || UNMAPPED} onChange={e => setField(f, e.target.value)}
                            className="mt-1 w-full text-[10px] font-mono border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                      <option value={UNMAPPED}>— none —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={h}>{h || `(column ${i + 1})`}</option>
                      ))}
                    </select>
                    {sample && (
                      <div className="text-[9px] text-slate-400 font-mono mt-1 truncate" title={sample}>
                        e.g. {sample}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div>
        <div className="text-[10px] font-bold uppercase text-slate-500">Rules</div>
        <div className="text-[10px] text-slate-400 mb-2">Small choices about how the format expresses things the columns alone do not settle.</div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            <label className="text-[10px] font-bold text-slate-600 w-40 shrink-0">How is a refund shown?</label>
            <select value={rules.refund} onChange={e => setRules({ ...rules, refund: e.target.value as LearnedRules['refund'] })}
                    className="text-[10px] font-mono border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="negative_amount">Amount goes negative</option>
              <option value="credit_column">A separate Credit column</option>
              <option value="status_column">The Status column says REFUND</option>
            </select>
          </div>
          {/* Only ever matters for slash dates where both halves are 12 or
              less. Guessing wrong there does not fail — it moves a ticket to
              another month, so it is worth one question. */}
          <div className="flex items-center gap-2 text-[11px]">
            <label className="text-[10px] font-bold text-slate-600 w-40 shrink-0">Date order, e.g. 06/09/2026</label>
            <select value={rules.dateOrder ?? 'mdy'}
                    onChange={e => setRules({ ...rules, dateOrder: e.target.value as 'mdy' | 'dmy' })}
                    className="text-[10px] font-mono border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="mdy">Month first — that is 9 June</option>
              <option value="dmy">Day first — that is 6 September</option>
            </select>
          </div>
        </div>
      </div>

      <NavRow onBack={onBack} onNext={onNext} canNext={canProceed}
              nextHint={!canProceed ? 'Give it a name and map at least one row identifier plus one money column.' : undefined} />
    </div>
  );
};

/** Show one sample value from the row that comes after the header — proves
 *  to the eye that the right column is picked. Blank when nothing is chosen
 *  or the column happens to be empty in the sample. */
function pickedSample(headers: string[], sampleBody: string[][], header: string): string {
  if (!header) return '';
  const i = headers.indexOf(header);
  if (i < 0) return '';
  for (const r of sampleBody) {
    if (r[i]?.trim()) return r[i].trim();
  }
  return '';
}

/* ── step 4 · dry run + save ────────────────────────────────────────────── */

const PreviewSaveStep: React.FC<{
  profile: LearnedProfile | null;
  dryRun: { rows: any[]; errors: string[]; warnings: string[]; placeholders: number } | null;
  saved: boolean; saving: boolean;
  onBack: () => void; onSave: () => void; onDone: () => void;
}> = ({ profile, dryRun, saved, saving, onBack, onSave, onDone }) => {
  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-slate-500 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
        <span>Reading the sample file with the mapping you just chose. If the ticket numbers and amounts here look right, the mapping is right.</span>
      </div>

      {dryRun && dryRun.placeholders > 0 && (
        <div className="rounded px-3 py-2 bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          <span className="font-bold">
            {dryRun.placeholders} of {dryRun.rows.length} rows lost their reference.
          </span>{' '}
          The column mapped to <span className="font-mono">Ticket Number</span> isn't being used as the row's id —
          a ticket number has to contain at least six digits, and this one doesn't. The rows still import, but under a
          generated id instead of the vendor's own reference.
          <div className="mt-1">
            Go back and map that column to <span className="font-mono font-bold">PNR / Booking Ref</span> instead —
            that slot takes any reference of five characters or more.
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 text-[10px]">
        <Stat label="Rows read" value={String(dryRun?.rows.length ?? 0)} tone={dryRun && dryRun.rows.length > 0 ? 'good' : 'warn'} />
        <Stat label="Warnings"  value={String(dryRun?.warnings.length ?? 0)} tone={dryRun && dryRun.warnings.length > 0 ? 'warn' : 'good'} />
        <Stat label="Errors"    value={String(dryRun?.errors.length ?? 0)}   tone={dryRun && dryRun.errors.length > 0 ? 'bad' : 'good'} />
      </div>

      {dryRun && dryRun.rows.length > 0 && (
        <div className="border border-slate-200 rounded overflow-auto max-h-[280px]">
          <table className="w-full text-[10px] font-mono">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="border-b border-slate-200 text-slate-500">
                {['Ticket', 'Date', 'Amount', 'Currency', 'Status', 'Passenger'].map(h =>
                  <th key={h} className="px-2 py-1.5 text-left font-bold uppercase text-[9px]">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {dryRun.rows.slice(0, 8).map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-2 py-1 text-slate-700">{r.ticketNo}</td>
                  <td className="px-2 py-1 text-slate-500">{r.date || '—'}</td>
                  <td className={`px-2 py-1 ${r.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{r.amount?.toFixed?.(2) ?? r.amount}</td>
                  <td className="px-2 py-1 text-slate-500">{r.currency}</td>
                  <td className="px-2 py-1 text-slate-500">{r.status}</td>
                  <td className="px-2 py-1 text-slate-500 truncate max-w-[220px]">{r.passengerName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dryRun && dryRun.warnings.length > 0 && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer">{dryRun.warnings.length} warning(s)</summary>
          <ul className="pl-4 pt-1 space-y-0.5">
            {dryRun.warnings.slice(0, 20).map((w, i) => <li key={i} className="text-slate-500">• {w}</li>)}
          </ul>
        </details>
      )}
      {dryRun && dryRun.errors.length > 0 && (
        <details className="text-[10px] text-red-600" open>
          <summary className="cursor-pointer font-bold">{dryRun.errors.length} error(s)</summary>
          <ul className="pl-4 pt-1 space-y-0.5">
            {dryRun.errors.slice(0, 20).map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </details>
      )}

      {saved ? (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-emerald-800">
            <CheckCircle2 className="w-4 h-4" />
            Saved. Any future file with the same column layout is read automatically as <span className="font-mono">{profile.vendorName}</span>.
          </div>
          <button onClick={onDone} className="px-3 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-700">
            Done
          </button>
        </div>
      ) : (
        <NavRow onBack={onBack} onNextLabel="Save mapping" onNext={onSave}
                canNext={!!dryRun && dryRun.rows.length > 0 && !saving}
                nextIcon={<Save className="w-3 h-3" />}
                nextHint={dryRun && dryRun.rows.length === 0 ? 'No rows read — go back and check the mapping.' : undefined} />
      )}
    </div>
  );
};

/* ── small pieces used across steps ─────────────────────────────────────── */

const Steps: React.FC<{ step: number }> = ({ step }) => {
  const labels = ['Upload file', 'Pick header row', 'Map columns', 'Preview & save'];
  return (
    <ol className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
            step > i + 1 ? 'bg-emerald-500 text-white'
            : step === i + 1 ? 'bg-blue-600 text-white'
            : 'bg-slate-200 text-slate-500'
          }`}>{i + 1}</span>
          <span className={step === i + 1 ? 'text-slate-800' : 'text-slate-400'}>{l}</span>
          {i < labels.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300" />}
        </li>
      ))}
    </ol>
  );
};

const NavRow: React.FC<{
  onBack: () => void; onNext: () => void;
  canNext?: boolean; onNextLabel?: string; nextIcon?: React.ReactNode; nextHint?: string;
}> = ({ onBack, onNext, canNext = true, onNextLabel = 'Continue', nextIcon = <ChevronRight className="w-3 h-3" />, nextHint }) => (
  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
    <button onClick={onBack} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700">
      <ChevronLeft className="w-3 h-3" /> Back
    </button>
    <div className="flex items-center gap-2">
      {nextHint && <span className="text-[10px] text-slate-400 italic">{nextHint}</span>}
      <button onClick={onNext} disabled={!canNext}
              className="flex items-center gap-1 px-4 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
        {onNextLabel} {nextIcon}
      </button>
    </div>
  </div>
);

const Stat: React.FC<{ label: string; value: string; tone: 'good' | 'warn' | 'bad' }> = ({ label, value, tone }) => (
  <div className={`border rounded px-3 py-2 ${
    tone === 'good' ? 'border-emerald-200 bg-emerald-50'
    : tone === 'warn' ? 'border-amber-200 bg-amber-50'
    : 'border-red-200 bg-red-50'
  }`}>
    <div className={`text-[9px] font-bold uppercase ${
      tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-red-700'
    }`}>{label}</div>
    <div className={`text-lg font-mono font-bold ${
      tone === 'good' ? 'text-emerald-800' : tone === 'warn' ? 'text-amber-800' : 'text-red-800'
    }`}>{value}</div>
  </div>
);
