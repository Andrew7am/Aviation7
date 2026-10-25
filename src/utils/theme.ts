import { useCallback, useState } from 'react';

/**
 * Light, or one of three dark looks - picked in the header and remembered on
 * this device. The first choice follows the device's own setting; index.html
 * applies it before the first paint. The colours are in theme-dark.css.
 */
export type Theme = 'light' | 'dimmed' | 'graphite' | 'warm';
export const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dimmed', label: 'Dark - dimmed' },
  { id: 'graphite', label: 'Dark - graphite' },
  { id: 'warm', label: 'Dark - warm' },
];

function current(): Theme {
  const el = document.documentElement;
  if (!el.classList.contains('dark')) return 'light';
  const d = el.dataset.dark;
  return d === 'graphite' || d === 'warm' ? d : 'dimmed';
}

export function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle('dark', t !== 'light');
  if (t === 'light' || t === 'dimmed') delete el.dataset.dark; else el.dataset.dark = t;
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, set] = useState<Theme>(current);
  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
    try { localStorage.setItem('theme', t); } catch { /* private window: this session only */ }
    set(t);
  }, []);
  return { theme, setTheme };
}
