const AED_KEYS = ['iata', 'rts', 'flyadeal dxb', 'air arabia', 'airarabia', 'flydubai', 'fly dubai', 'riyadh air', 'riyadhair', 'turkish', 'websales'];

export function sourceToCurrency(source: string): 'SAR' | 'AED' {
  const s = (source || '').toLowerCase();
  if (AED_KEYS.some(k => s.includes(k))) return 'AED';
  return 'SAR';
}
