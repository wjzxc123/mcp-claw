export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'mcp-claw-theme';

export function getStoredThemeMode(): ThemeMode {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function saveThemeMode(mode: ThemeMode): void {
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyThemeMode(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveThemeMode(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  return resolved;
}
