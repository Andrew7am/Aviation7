import { useCallback, useState } from 'react';

/**
 * Light or dark - one button in the header, remembered on this device. The
 * first choice follows the device's own setting; index.html applies it before
 * the first paint. The colours are in theme-dark.css.
 *
 * There were three dark looks; the user kept graphite and dropped the other
 * two (16 Nov 2026). A device that saved 'dimmed' or 'warm' gets dark.
 */
export type Theme = 'light' | 'dark';

function current(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle('dark', t === 'dark');
  delete el.dataset.dark;
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
