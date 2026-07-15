import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from './theme.js';

const STORAGE_KEY = 'aw-theme';

const ThemeModeContext = createContext(null);

const systemPrefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;

const readStoredMode = () => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
};

export function ThemeModeProvider({ children }) {
  const [mode, setModeState] = useState(() => readStoredMode() ?? (systemPrefersDark() ? 'dark' : 'light'));
  // Only follow the OS while the user has never made an explicit choice.
  const [isExplicit, setIsExplicit] = useState(() => readStoredMode() !== null);

  useEffect(() => {
    if (isExplicit) return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setModeState(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [isExplicit]);

  const setMode = useCallback((next) => {
    setModeState(next);
    setIsExplicit(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the theme simply won't persist.
    }
  }, []);

  const toggleMode = useCallback(
    () => setMode(mode === 'light' ? 'dark' : 'light'),
    [mode, setMode],
  );

  const resetToSystem = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
    setIsExplicit(false);
    setModeState(systemPrefersDark() ? 'dark' : 'light');
  }, []);

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const value = useMemo(
    () => ({ mode, isDark: mode === 'dark', setMode, toggleMode, resetToSystem, theme }),
    [mode, setMode, toggleMode, resetToSystem, theme],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within a ThemeModeProvider');
  }
  return context;
}

export default ThemeModeContext;
