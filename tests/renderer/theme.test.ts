import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyThemeMode, getStoredThemeMode, saveThemeMode } from '../../src/renderer/theme';

describe('theme', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
  });

  it('stores and reads theme mode', () => {
    expect(getStoredThemeMode()).toBe('system');

    saveThemeMode('light');

    expect(getStoredThemeMode()).toBe('light');
  });

  it('applies explicit theme mode', () => {
    const resolved = applyThemeMode('dark');

    expect(resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeMode).toBe('dark');
  });

  it('resolves system theme mode from media query', () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    const resolved = applyThemeMode('system');

    expect(resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: original,
    });
  });
});
