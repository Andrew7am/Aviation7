import React from 'react';

/**
 * Small hand-rolled SVG charts.
 *
 * No charting library: the app ships no dependency it does not need, and these
 * are simple enough that a library would be more code, not less. Everything
 * scales from a viewBox, so the charts fit whatever width the card gives them.
 *
 * A rule inherited from the rest of the ledger: SAR and AED never share an
 * axis. Two currencies plotted against one scale produce a picture that reads
 * like money and is not, so the money chart draws one currency at a time.
 */

/** Distinct enough to tell apart at slice-width, and ordered so the biggest
 *  shares get the strongest colours. */
export const PALETTE = [
  '#2563eb', '#0891b2', '#14b8a6', '#16a34a', '#84cc16',
  '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6',
];
export const paletteAt = (i: number) => PALETTE[i % PALETTE.length];
const MUTED = '#cbd5e1';

const fmtInt = (n: number) => n.toLocaleString('en-US');
const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Compact axis label — 12.5k rather than 12,500, so ticks stay readable. */
function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

export interface Slice {
  key: string; label: string; value: number;
  /** Ticket count, shown alongside `value` when the slice is ranked by money
   *  rather than by ticket count — money says how much a slice earned, this
   *  says how many tickets it took to earn it. Omit when `value` already is
   *  the ticket count, so it isn't printed twice. */
  count?: number;
}

/**
 * Share as a donut, with the long tail folded into one "Others" slice.
 *
 * Showing sixty airlines as sixty slivers communicates nothing; the top few
 * are the story and the rest is one honest remainder that still adds up to the
 * whole.
 */
export const Donut: React.FC<{
  slices: Slice[];
  max?: number;
  centerLabel?: string;
  centerValue?: string;
}> = ({ slices, max = 8, centerLabel = 'Tickets', centerValue }) => {
  const sorted = [...slices].filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  const tailValue = tail.reduce((s, x) => s + x.value, 0);
  const tailCount = tail.reduce((s, x) => s + (x.count ?? 0), 0);
  const shown: (Slice & { color: string })[] = head.map((s, i) => ({ ...s, color: paletteAt(i) }));
  if (tailValue > 0) {
    shown.push({
      key: '__others', label: `Others (${sorted.length - head.length})`, value: tailValue, color: MUTED,
      count: tail.some(x => x.count !== undefined) ? tailCount : undefined,
    });
  }
  const total = shown.reduce((s, x) => s + x.value, 0);

  if (total === 0) {
    return <p className="px-4 py-8 text-xs text-slate-400 italic text-center">Nothing in this period.</p>;
  }

  const R = 60, SW = 22, C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg viewBox="0 0 160 160" className="w-[160px] h-[160px] shrink-0" role="img"
           aria-label={`${centerLabel} by share`}>
        <g transform="translate(80,80) rotate(-90)">
          {shown.map(s => {
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.key} r={R} fill="none" stroke={s.color} strokeWidth={SW}
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc}
              >
                <title>{`${s.label} — ${fmtInt(s.value)}${s.count !== undefined ? ` · ${fmtInt(s.count)} ticket${s.count === 1 ? '' : 's'}` : ''} (${((s.value / total) * 100).toFixed(1)}%)`}</title>
              </circle>
            );
            acc += len;
            return el;
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" className="fill-slate-800"
              style={{ fontSize: 20, fontWeight: 700 }}>
          {centerValue ?? fmtInt(total)}
        </text>
        <text x="80" y="92" textAnchor="middle" className="fill-slate-400"
              style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {centerLabel}
        </text>
      </svg>

      <ul className="flex-1 min-w-[170px] space-y-1">
        {shown.map(s => (
          <li key={s.key} className="flex items-center gap-2 text-[10px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 truncate text-slate-600" title={s.label}>{s.label}</span>
            <span className="font-mono text-slate-500">{fmtInt(s.value)}</span>
            {s.count !== undefined && (
              <span className="font-mono text-slate-400" title="Tickets issued">
                ({fmtInt(s.count)})
              </span>
            )}
            <span className="font-mono font-bold text-slate-700 w-11 text-right">
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export interface Bar { label: string; value: number; secondary?: number }

/**
 * A month-by-month column chart.
 *
 * Values may be negative — a month whose refunds outweigh its sales is a real
 * month — so bars are drawn from a zero baseline that sits wherever the data
 * puts it, and negative columns are red rather than simply missing.
 */
export const TrendBars: React.FC<{
  bars: Bar[];
  money?: boolean;
  /** Colour for the small stacked segment above each bar (refund counts). */
  secondaryLabel?: string;
}> = ({ bars, money = false, secondaryLabel }) => {
  if (bars.length === 0) {
    return <p className="px-4 py-8 text-xs text-slate-400 italic text-center">Nothing in this period.</p>;
  }

  const W = 720, H = 190, PAD_L = 48, PAD_R = 8, PAD_T = 12, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

  const hi = Math.max(0, ...bars.map(b => b.value + (b.secondary ?? 0)));
  const lo = Math.min(0, ...bars.map(b => b.value));
  const span = hi - lo || 1;
  const y = (v: number) => PAD_T + ((hi - v) / span) * plotH;
  const zeroY = y(0);

  const slot = plotW / bars.length;
  const bw = Math.max(3, Math.min(38, slot * 0.62));

  // Enough ticks to read the scale, few enough not to clutter it.
  const ticks = [hi, hi / 2, 0, lo / 2, lo].filter((v, i, a) => a.indexOf(v) === i && Number.isFinite(v));
  // With many months, printing every label overlaps; print every nth instead.
  const step = Math.ceil(bars.length / 14);

  return (
    // A minimum width rather than a plain w-full: squeezed into a phone the
    // whole chart would scale down until the axis was unreadable, so below this
    // it scrolls sideways inside its card and stays legible instead.
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 190, minWidth: 560 }}
         role="img" aria-label="Activity by month">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)}
                stroke={t === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth={t === 0 ? 1 : 1} />
          <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400"
                style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace' }}>
            {money ? short(t) : Math.round(t)}
          </text>
        </g>
      ))}

      {bars.map((b, i) => {
        const cx = PAD_L + slot * i + slot / 2;
        const x = cx - bw / 2;
        const neg = b.value < 0;
        const top = neg ? zeroY : y(b.value);
        const h = Math.max(1, Math.abs(zeroY - y(b.value)));
        const sec = b.secondary ?? 0;
        const secH = sec > 0 ? Math.abs(zeroY - y(sec)) : 0;
        return (
          <g key={b.label}>
            <rect x={x} y={top} width={bw} height={h} rx={2}
                  fill={neg ? '#ef4444' : '#2563eb'}>
              <title>{`${b.label} — ${money ? fmtMoney(b.value) : fmtInt(b.value)}`}</title>
            </rect>
            {secH > 0 && (
              <rect x={x} y={top - secH} width={bw} height={secH} rx={2} fill="#fb923c">
                <title>{`${b.label} — ${fmtInt(sec)} ${secondaryLabel ?? ''}`}</title>
              </rect>
            )}
            {i % step === 0 && (
              <text x={cx} y={H - 10} textAnchor="middle" className="fill-slate-400"
                    style={{ fontSize: 9 }}>
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};
