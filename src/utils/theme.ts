import { useCallback, useState } from 'react';

/**
 * Light or dark, chosen in the header and remembered on this device. The
 * first choice follows the device's own setting; index.html applies it
 * before the first paint. The colours themselves are in theme-dark.css.
 */
export function useTheme(): { dark: boolean; toggleTheme: () => void } {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggleTheme = useCallback(() => {
    setDark(d => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* private window: this session only */ }
      return next;
    });
  }, []);
  return { dark, toggleTheme };
}
