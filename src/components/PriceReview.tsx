import React, { useMemo, useState } from 'react';
import { Download, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import {
  priceTotals, RESULT_LABEL, RESULT_MEANS, needsReason, blocksClosing,
  type PriceLine, type PriceResult, type PriceTotal,
} from '../core/helpers/priceReview';
import { PROFIT_FROM } from '../core/config/profit';
import type { Explanation } from '../core/helpers/sheetMemory';
import { totalInSar, useSarTotal, AED_TO_SAR } from '../core/helpers/sarTotal';

/**
 * The file's prices, under its counts: what operations was given against
 * what each ticket cost us, the commission and the team's markup apart, and
 * a reason for every ticket given at or below cost.
 */
const xlsx = () => import('xlsx');
const fmt = (n: number | null | undefined) => n == null ? '—'
  : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number | null | undefined) => n == null ? '—' : `${n > 0.005 ? '+' : ''}${fmt(n)}`;

const TONE: Record<PriceResult, string> = {
  MARKUP: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  COMMISSION_ONLY: 'bg-sky-50 text-sky-800 border-sky-200',
  PART_COMMISSION: 'bg-amber-50 text-amber-800 border-amber-200',
  EXACTLY_NET: 'bg-amber-50 text-amber-800 border-amber-200',
  BELOW_NET: 'bg-red-50 text-red-700 border-red-200',
  REFUND_SAME: 'bg-slate-50 text-slate-600 border-slate-200',
  REFUND_KEPT: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REFUND_ABOVE: 'bg-red-50 text-red-700 border-red-200',
  AV_PROFIT: 'bg-violet-50 text-violet-800 border-violet-200',
  NOT_COMPARED: 'bg-slate-50 text-slate-500 border-slate-200',
};
const ORDER: PriceResult[] = ['BELOW_NET', 'REFUND_ABOVE', 'EXACTLY_NET', 'PART_COMMISSION', 'COMMISSION_ONLY', 'MARKUP',
  'AV_PROFIT', 'REFUND_KEPT', 'REFUND_SAME', 'NOT_COMPARED'];

/** The reason written for a line, if it was written at these figures. */
export const reasonFor = (l: PriceLine, byKey: Map<string, Explanation>) => {
  const e = byKey.get(l.key);
  return e && e.fingerprint === l.fingerprint ? e : null;
};
/** Lines that keep the file from closing: a loss with no reason. */
export const priceBlockers = (lines: PriceLine[], byKey: Map<string, Explanation>) =>
  lines.filter(l => blocksClosing(l) && !reasonFor(l, byKey));

type Filter = 'EXPLAIN' | 'ALL' | PriceResult;

export const PriceReview: React.FC<{
  lines: PriceLine[] | null;
  explanations: Explanation[];
  /** Absent for someone who cannot write a reason. */
  onReason?: (l: PriceLine, note: string) => Promise<void>;
  onClearReason?: (l: PriceLine) => Promise<void>;
  /** "KSAML2533", or "whole sheet" - for the heading and the file name. */
  scope: string;
  error?: string;
  /** "Also in riyals", when the page around it holds the switch. */
  sar?: [boolean, (on: boolean) => void];
}> = ({ lines, explanations, onReason, onClearReason, scope, error, sar }) => {
  const byKey = useMemo(() => new Map(explanations.map(e => [e.findingKey, e])), [explanations]);
  const own = useSarTotal();
  const [sarOn, setSarOn] = sar ?? own;
  const [picked, setFilter] = useState<Filter | null>(null);
  const [open, setOpen] = useState(true);
  const [reqOpen, setReqOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');
  const [saveErr, setSaveErr] = useState('');

  const all = lines ?? [];
  const totals = useMemo(() => priceTotals(all, false), [all]);
  /* Riyals and dirhams as one riyal figure (AED x 1.02), beside each
     currency's own - only when there are dirhams to convert. */
  const sarTotal = useMemo(() => totals.some(t => t.currency === 'AED') ? totalInSar(totals) : null, [totals]);
  const perReq = useMemo(() => priceTotals(all, true), [all]);
  const counts = useMemo(() => {
    const m = new Map<PriceResult, number>();
    all.forEach(l => m.set(l.result, (m.get(l.result) ?? 0) + 1));
    return m;
  }, [all]);
  const toExplain = all.filter(needsReason);
  // What needs a reason first, while anything does; otherwise everything.
  const filter: Filter = picked ?? (toExplain.length ? 'EXPLAIN' : 'ALL');
  const blockers = priceBlockers(all, byKey);
  const shown = (filter === 'ALL' ? all : filter === 'EXPLAIN' ? toExplain : all.filter(l => l.result === filter))
    .slice().sort((a, b) => ORDER.indexOf(a.result) - ORDER.indexOf(b.result) || a.req.localeCompare(b.req) || a.issued.localeCompare(b.issued));

  const save = async (l: PriceLine, typed: string) => {
    const note = typed.trim();
    if (!note || !onReason) return;
    setSaving(l.key); setSaveErr('');
    try { await onReason(l, note); setDraft(d => { const n = { ...d }; delete n[l.key]; return n; }); }
    catch (e) { setSaveErr(e instanceof Error ? e.message : 'The reason could not be saved.'); }
    finally { setSaving(''); }
  };
  const clear = async (l: PriceLine) => {
    if (!onClearReason) return;
    setSaving(l.key); setSaveErr('');
    try { await onClearReason(l); } catch (e) { setSaveErr(e instanceof Error ? e.message : 'The reason could not be removed.'); }
    finally { setSaving(''); }
  };

  const exportReport = async () => {
    const XLSX = await xlsx();
    const line = (l: PriceLine) => ({
      'Request': l.req, 'Kind': l.kind === 'SALE' ? 'Ticket' : 'Refund', 'Ticket(s)': l.docs.join(' / '),
      'Team member': l.member, 'Issued': l.issued, 'Currency': l.currency,
      'Ticket price': l.price ?? '', 'Commission': l.commission ?? '',
      'Our net': l.kind === 'SALE' ? (l.net ?? '') : '', 'Given to operations': l.kind === 'SALE' ? l.toOps : '',
      'Refunded to us': l.kind === 'REFUND' ? (l.net ?? '') : '', 'Refunded to operations': l.kind === 'REFUND' ? l.toOps : '',
      'Aviation profit': l.markup ?? '', 'Our profit (commission + aviation)': l.profit ?? '',
      'Result': RESULT_LABEL[l.result], 'Before 9 Nov': l.early ? 'yes' : '', 'What it means': l.why || RESULT_MEANS[l.result],
      'Reason': reasonFor(l, byKey)?.note ?? '', 'Reason by': reasonFor(l, byKey)?.createdBy ?? '',
      ...(l.converted ? { 'Note': 'Our cost was in another currency, converted at the peg' } : {}),
    });
    const total = (t: PriceTotal) => ({
      'Request': t.req, 'Currency': t.currency, 'Tickets compared': t.tickets,
      'Charged to operations': t.charged, 'Our net': t.net, 'Commission': t.commission, 'Aviation profit': t.aviation,
      'Our profit (commission + aviation)': t.profit,
      'Aviation: markup': t.markup, 'Aviation: given below the price': t.belowPrice, 'Aviation: refunds kept (+) / given over (-)': t.refunds,
      ...Object.fromEntries(ORDER.map(r => [RESULT_LABEL[r], t.counts[r] ?? 0])),
    });
    const wb = XLSX.utils.book_new();
    const inSarRow = totalInSar(priceTotals(all, false));
    const summary = XLSX.utils.json_to_sheet([...priceTotals(all, false).map(t => ({ ...total(t), Request: 'ALL' })),
      // Both: each currency's own, and riyals and dirhams as riyals.
      ...(inSarRow && priceTotals(all, false).some(t => t.currency === 'AED')
        ? [{ ...total(inSarRow), Request: 'ALL', Currency: `SAR (SAR + AED x ${AED_TO_SAR})` }] : []),
      ...perReq.map(total)]);
    XLSX.utils.sheet_add_aoa(summary, [[],
      ['Scope', scope], ['Before 9 Nov', `Before ${PROFIT_FROM} their Net Cost was the cost: those tickets are added up but never asked about and never hold a file`],
      ['Their figures', 'Net Cost (given to operations) and Refund Amount, from their sheet as last uploaded'],
      ['Charged to operations', 'Our net + commission + aviation profit, after refunds'],
      ['Aviation profit', 'Markup above the ticket price, less anything given below it, plus what refunds left with the team'],
      ['Our profit', 'Commission + aviation profit = charged to operations - our net'],
      ['Rounding', 'A difference of 1.00 or less is taken as none'],
      ['Exported', new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })]], { origin: -1 });
    XLSX.utils.book_append_sheet(wb, summary, 'Summary');
    const compared = all.filter(l => l.result !== 'NOT_COMPARED');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compared.length ? compared.map(line) : [{ Request: 'None' }]), 'Tickets');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toExplain.length ? toExplain.map(line) : [{ Request: 'None' }]), 'To explain');
    const skipped = all.filter(l => l.result === 'NOT_COMPARED');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(skipped.length ? skipped.map(line) : [{ Request: 'None' }]), 'Not compared');
    XLSX.writeFile(wb, `Prices_${scope.replace(/[^A-Za-z0-9_-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const chip = (f: Filter, label: string, n: number, tone: string) => (
    <button key={f} type="button" onClick={() => setFilter(f)}
      className={`px-2 py-1 rounded border text-mini font-bold whitespace-nowrap ${tone} ${filter === f ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}>
      {label} {n}</button>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-micro font-bold uppercase text-slate-500 hover:text-slate-700">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Prices: net, commission and aviation profit
        </button>
        <span className={`text-xs font-bold ${blockers.length ? 'text-red-600' : 'text-emerald-600'}`}>
          {lines === null ? '' : blockers.length
            ? `${blockers.length} below our net with no reason`
            : toExplain.length ? `${toExplain.length} to explain, none holding the file` : 'nothing to explain'}
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer"
          title="Riyals and dirhams added up in riyals, at 1.02 a dirham, beside each currency's own figures">
          <input type="checkbox" checked={sarOn} onChange={e => setSarOn(e.target.checked)} /> Total in SAR (AED × {AED_TO_SAR})
        </label>
        <button type="button" onClick={() => void exportReport()} disabled={!all.length}
          className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded hover:bg-slate-50 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> Price report (Excel)
        </button>
      </div>
      {open && (
        <div className="p-4 space-y-3">
          {error && <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
          {lines === null && !error && (
            <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Reading their prices…</div>
          )}
          {lines !== null && !all.length && (
            <p className="text-xs text-slate-500">No ticket of theirs to compare here.</p>
          )}
          {[...totals.map(t => ({ t, sar: false })), ...(sarOn && sarTotal ? [{ t: sarTotal, sar: true }] : [])].map(({ t, sar: combined }) => (
            <div key={combined ? 'SAR-ALL' : t.currency} className={combined ? 'border-t border-dashed border-slate-300 pt-3' : ''}>
              <div className="text-mini font-bold uppercase text-slate-400 mb-1">
                {combined
                  ? <>Total in SAR: SAR + AED × {AED_TO_SAR}{sarTotal?.left.length ? ` · ${sarTotal.left.join(', ')} not included` : ''}</>
                  : <>{t.currency} · {t.tickets} ticket{t.tickets === 1 ? '' : 's'} compared
                    {t.counts.AV_PROFIT ? ` · ${t.counts.AV_PROFIT} refund${t.counts.AV_PROFIT === 1 ? '' : 's'} marked AV` : ''}
                    {t.counts.NOT_COMPARED ? ` · ${t.counts.NOT_COMPARED} not compared (left out, see Not compared)` : ''}</>}
              </div>
              {/* The file the way it is talked about: charged = net + commission + aviation. */}
              <div className="flex flex-wrap items-stretch gap-2">
                {([
                  ['Charged to operations', fmt(t.charged), 'text-slate-900', '='],
                  ['Our net', fmt(t.net), '', '+'],
                  ['Commission', fmt(t.commission), t.commission < 0 ? 'text-red-600' : 'text-sky-700', '+'],
                  ['Aviation profit', signed(t.aviation), t.aviation < 0 ? 'text-red-600' : 'text-emerald-700', ''],
                ] as const).map(([label, v, tone, op]) => (
                  <React.Fragment key={label}>
                    <div className="bg-slate-50 rounded px-3 py-2 min-w-[140px] flex-1">
                      <div className="text-mini text-slate-500">{label}</div>
                      <div className={`font-mono font-bold text-sm ${tone || 'text-slate-700'}`}>{v}</div>
                    </div>
                    {op && <span className="self-center font-mono font-bold text-slate-400">{op}</span>}
                  </React.Fragment>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-mini text-slate-500">
                <span>Aviation profit: markup <b className="font-mono text-slate-700">{signed(t.markup)}</b></span>
                <span>below the price <b className={`font-mono ${t.belowPrice < 0 ? 'text-red-600' : 'text-slate-700'}`}>{signed(t.belowPrice)}</b></span>
                <span>refunds <b className={`font-mono ${t.refunds < 0 ? 'text-red-600' : 'text-slate-700'}`}>{signed(t.refunds)}</b></span>
                <span className="text-slate-300">|</span>
                <span>Our profit (commission + aviation) <b className={`font-mono ${t.profit < 0 ? 'text-red-600' : 'text-slate-800'}`}>{signed(t.profit)}</b></span>
              </div>
            </div>
          ))}

          {perReq.length > 1 && (
            <div className="border border-slate-200 rounded">
              <button type="button" onClick={() => setReqOpen(!reqOpen)}
                className="w-full px-3 py-1.5 text-left text-mini font-bold uppercase text-slate-500 flex items-center gap-1.5 hover:bg-slate-50">
                {reqOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Request by request ({perReq.length})
              </button>
              {reqOpen && (
                <div className="overflow-auto max-h-[40vh]">
                  <table className="w-full text-xs min-w-[720px]">
                    <thead className="sticky top-0 bg-white"><tr className="text-micro uppercase text-slate-400 border-b border-slate-100">
                      {['Request', 'Cur', 'Tickets', 'Charged', 'Our net', 'Commission', 'Aviation', 'Markup', 'Below price', 'Refunds', 'Profit', 'Below net'].map(h =>
                        <th key={h} className={`px-2 py-1.5 ${h === 'Request' || h === 'Cur' ? 'text-left' : 'text-right'}`}>{h}</th>)}
                    </tr></thead>
                    <tbody className="font-mono">
                      {perReq.map(t => (
                        <tr key={t.req + t.currency} className="border-b border-slate-50">
                          <td className="px-2 py-1 font-bold text-purple-700">{t.req}</td><td className="px-2 py-1">{t.currency}</td>
                          <td className="px-2 py-1 text-right">{t.tickets}</td><td className="px-2 py-1 text-right">{fmt(t.charged)}</td>
                          <td className="px-2 py-1 text-right">{fmt(t.net)}</td><td className="px-2 py-1 text-right">{fmt(t.commission)}</td>
                          <td className={`px-2 py-1 text-right font-bold ${t.aviation < 0 ? 'text-red-600' : ''}`}>{signed(t.aviation)}</td>
                          <td className="px-2 py-1 text-right">{signed(t.markup)}</td>
                          <td className={`px-2 py-1 text-right ${t.belowPrice < 0 ? 'text-red-600' : ''}`}>{signed(t.belowPrice)}</td>
                          <td className="px-2 py-1 text-right">{signed(t.refunds)}</td>
                          <td className="px-2 py-1 text-right font-bold">{signed(t.profit)}</td>
                          <td className={`px-2 py-1 text-right ${t.counts.BELOW_NET ? 'text-red-600 font-bold' : 'text-slate-400'}`}>{t.counts.BELOW_NET || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {all.length > 0 && (<>
            <div className="flex flex-wrap gap-1.5">
              {chip('EXPLAIN', 'To explain', toExplain.length, 'bg-white text-slate-700 border-slate-300')}
              {chip('ALL', 'All', all.length, 'bg-white text-slate-700 border-slate-300')}
              {ORDER.filter(r => counts.get(r)).map(r => chip(r, RESULT_LABEL[r], counts.get(r)!, TONE[r]))}
            </div>
            {saveErr && <div role="alert" className="text-xs text-red-600">{saveErr}</div>}
            <div className="overflow-auto max-h-[60vh] border border-slate-100 rounded">
              <table className="w-full text-xs min-w-[980px]">
                <thead className="sticky top-0 z-10 bg-white"><tr className="text-micro uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-2 py-1.5 text-left">Ticket</th><th className="px-2 py-1.5 text-left">Request</th>
                  <th className="px-2 py-1.5 text-right">Price</th><th className="px-2 py-1.5 text-right">Commission</th>
                  <th className="px-2 py-1.5 text-right">Our net</th><th className="px-2 py-1.5 text-right">To operations</th>
                  <th className="px-2 py-1.5 text-right" title="Aviation profit: given to operations less the ticket price">Aviation</th><th className="px-2 py-1.5 text-right" title="Commission + aviation">Profit</th>
                  <th className="px-2 py-1.5 text-left">Result and reason</th>
                </tr></thead>
                <tbody>
                  {shown.map(l => {
                    const reason = reasonFor(l, byKey), old = byKey.get(l.key);
                    const needs = needsReason(l), blocks = blocksClosing(l) && !reason;
                    return (
                      <tr key={l.key} className={`border-b border-slate-50 align-top ${blocks ? 'bg-red-50/40' : ''}`}>
                        <td className="px-2 py-1.5">
                          <div className="font-mono font-bold text-slate-700">{l.kind === 'REFUND' && <span className="font-sans text-mini text-slate-500 mr-1">Refund</span>}
                            {l.docs.length > 2 ? `${l.docs[0]} +${l.docs.length - 1}` : l.docs.join(' + ') || '—'}</div>
                          <div className="text-mini text-slate-400">{l.member} · {l.issued} · {l.currency}{l.converted ? ' · converted at the peg' : ''}</div>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-purple-700">{l.req || '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(l.price)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(l.commission)}</td>
                        <td className="px-2 py-1.5 text-right font-mono" title={l.kind === 'REFUND' ? 'Refunded to us by the supplier' : undefined}>{fmt(l.net)}</td>
                        <td className="px-2 py-1.5 text-right font-mono" title={l.kind === 'REFUND' ? 'Their Refund Amount' : 'Their Net Cost'}>{l.result === 'NOT_COMPARED' && l.kind === 'REFUND' && l.why?.startsWith('No Refund') ? '—' : fmt(l.toOps)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${(l.markup ?? 0) < 0 ? 'text-red-600' : ''}`}>{signed(l.markup)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono font-bold ${(l.profit ?? 0) < -0.005 ? 'text-red-600' : ''}`}>{signed(l.profit)}</td>
                        <td className="px-2 py-1.5 min-w-[260px]">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-mini font-bold ${TONE[l.result]}`}>{RESULT_LABEL[l.result]}</span>
                          {l.early && l.result !== 'AV_PROFIT' && (
                            <span className="ml-1.5 text-mini text-slate-400" title={`Before ${PROFIT_FROM} their Net Cost was the cost: not asked about`}>before 9 Nov</span>)}
                          <span className="text-mini text-slate-500 ml-1.5">{l.why || (needs ? RESULT_MEANS[l.result] : '')}</span>
                          {reason && (
                            <div className="mt-1 text-mini text-slate-700">
                              <b>Why:</b> {reason.note}
                              <span className="text-slate-400"> · {reason.createdBy || ''} {reason.createdAt ? reason.createdAt.slice(0, 10) : ''}</span>
                              {onClearReason && <button type="button" disabled={saving === l.key} onClick={() => void clear(l)}
                                className="ml-2 text-slate-400 hover:text-red-600">Remove</button>}
                            </div>
                          )}
                          {needs && !reason && onReason && (
                            <div className="mt-1 flex gap-1.5">
                              <input value={draft[l.key] ?? old?.note ?? ''} placeholder={blocks ? 'Why? Needed to close' : 'Why?'}
                                aria-label={`Reason for ${l.docs[0] ?? l.key}`}
                                onChange={e => setDraft(d => ({ ...d, [l.key]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') void save(l, draft[l.key] ?? old?.note ?? ''); }}
                                className="flex-1 min-w-0 px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                              <button type="button" disabled={saving === l.key || !(draft[l.key] ?? old?.note ?? '').trim()}
                                onClick={() => void save(l, draft[l.key] ?? old?.note ?? '')}
                                className="px-2 py-1 rounded bg-blue-700 text-white text-mini font-bold disabled:opacity-40">
                                {saving === l.key ? 'Saving…' : 'Save'}</button>
                            </div>
                          )}
                          {needs && !reason && old && <div className="mt-0.5 text-mini text-amber-700">A reason was written for other figures; save it again if it still holds.</div>}
                        </td>
                      </tr>
                    );
                  })}
                  {!shown.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Nothing here.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-mini text-slate-400">
              Price = our net + the supplier's commission. Aviation profit = given to operations − price; profit = commission + aviation profit.
              A refund compares their Refund Amount with what the supplier gave us back. A difference of 1.00 or less is rounding.
              Their figures come from their sheet as last uploaded on the Airtable page. Before {PROFIT_FROM} their Net Cost was the cost: those
              tickets are added up but never asked about and never hold a file.
            </p>
          </>)}
        </div>
      )}
    </div>
  );
};
