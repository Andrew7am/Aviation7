import React, { useEffect, useState } from 'react';
import { LearnedProfile } from '../core/ai/learnedProfile';
import { AIProfileService } from '../services/AIProfileService';
import { ManualParserMapper } from './ManualParserMapper';
import { Sparkles, Wrench, Plus, Trash2, FileText } from 'lucide-react';

const svc = new AIProfileService();

/**
 * Settings — admin-only screen for teaching and managing the report formats
 * the app knows how to read.
 *
 * The built-in parsers (IATA, NSA, Flynas, ...) don't live here — they are
 * code that ships with the app. This screen manages the profiles a person
 * or the AI taught the app on top of that: their column mappings, and a
 * button to teach a new one.
 */
export const Settings: React.FC = () => {
  const [profiles, setProfiles] = useState<LearnedProfile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [teaching, setTeaching] = useState(false);
  const [error, setError]       = useState('');

  const reload = () => {
    setLoading(true);
    svc.listProfiles()
      .then(p => { setProfiles(p); setError(''); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const removeProfile = async (p: LearnedProfile) => {
    if (!confirm(`Forget the "${p.vendorName}" format? Files with this exact column layout will stop being read automatically.`)) return;
    try {
      await svc.deleteProfile(p.fingerprint);
      reload();
    } catch (e) {
      alert(`Could not remove: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (teaching) {
    return (
      <div className="p-6">
        <ManualParserMapper onDone={() => { setTeaching(false); reload(); }} />
      </div>
    );
  }

  const ai     = profiles.filter(p => (p.origin ?? 'ai') === 'ai');
  const manual = profiles.filter(p => p.origin === 'manual');

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h2 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Settings — Admin Only</h2>
        <p className="text-sm text-slate-600 mt-1">
          Report formats the app has been taught to read on top of its built-in vendors.
        </p>
      </div>

      {error && (
        <div className="rounded px-3 py-2 bg-red-50 border border-red-200 text-[11px] text-red-700 font-mono">{error}</div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <header className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Report formats
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {loading ? 'Loading…' : `${profiles.length} taught format${profiles.length === 1 ? '' : 's'}. Built-in vendors are always on and are not listed here.`}
            </div>
          </div>
          <button onClick={() => setTeaching(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-blue-700">
            <Plus className="w-3 h-3" /> Teach a new format
          </button>
        </header>

        {!loading && profiles.length === 0 && (
          <div className="px-6 py-10 text-center text-slate-400 text-sm">
            Nothing taught yet. Click <span className="font-mono font-bold text-slate-600">Teach a new format</span> to walk a sample report through the mapping.
          </div>
        )}

        {manual.length > 0 && (
          <ProfileGroup title="Taught by hand" icon={<Wrench className="w-3 h-3" />} tone="blue"
                       profiles={manual} onRemove={removeProfile} />
        )}
        {ai.length > 0 && (
          <ProfileGroup title="Learned by AI" icon={<Sparkles className="w-3 h-3" />} tone="violet"
                       profiles={ai} onRemove={removeProfile} />
        )}
      </section>
    </div>
  );
};

const ProfileGroup: React.FC<{
  title: string; icon: React.ReactNode; tone: 'blue' | 'violet';
  profiles: LearnedProfile[]; onRemove: (p: LearnedProfile) => void;
}> = ({ title, icon, tone, profiles, onRemove }) => (
  <div>
    <div className={`px-4 py-2 border-b border-slate-100 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${
      tone === 'blue' ? 'text-blue-700 bg-blue-50/50' : 'text-violet-700 bg-violet-50/50'
    }`}>
      {icon} {title} <span className="text-slate-400 font-mono">· {profiles.length}</span>
    </div>
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-[9px] font-bold uppercase text-slate-400 border-b border-slate-100">
          <th className="px-4 py-2">Vendor</th>
          <th className="px-4 py-2">Columns mapped</th>
          <th className="px-4 py-2">Row identifier</th>
          <th className="px-4 py-2">Refund rule</th>
          <th className="px-4 py-2 text-right"></th>
        </tr>
      </thead>
      <tbody>
        {profiles.map(p => (
          <tr key={p.fingerprint} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="px-4 py-2 font-bold text-slate-700">{p.vendorName}</td>
            <td className="px-4 py-2 font-mono text-slate-500">
              {Object.entries(p.columns).filter(([, v]) => v).length}
              <span className="text-slate-300"> / {p.headers.length}</span>
            </td>
            <td className="px-4 py-2 font-mono text-slate-500">
              {p.columns.ticket ? 'Ticket' : p.columns.pnr ? 'PNR' : <span className="text-slate-300">—</span>}
            </td>
            <td className="px-4 py-2 font-mono text-slate-500">{p.rules.refund.replace(/_/g, ' ')}</td>
            <td className="px-4 py-2 text-right">
              <button onClick={() => onRemove(p)}
                      className="p-1 text-slate-400 hover:text-red-600" title="Forget this format">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
