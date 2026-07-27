export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'themeMode';
// Legacy key from before 'system' existed — a plain 'true'/'false' dark-mode
// flag. Only used as a one-time migration source so users who'd already
// picked light or dark keep that exact choice instead of being silently
// reset to 'system' the first time they load this build.
const LEGACY_DARK_KEY = 'darkMode';

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveIsDark(mode: ThemeMode): boolean {
  return mode === 'system' ? systemPrefersDark() : mode === 'dark';
}

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    const legacy = localStorage.getItem(LEGACY_DARK_KEY);
    if (legacy !== null) return legacy === 'false' ? 'light' : 'dark';
  } catch {}
  return 'system';
}

export function setStoredThemeMode(mode: ThemeMode) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_KEY, mode);
    // Kept in sync for any code path not yet migrated off the legacy key.
    localStorage.setItem(LEGACY_DARK_KEY, String(resolveIsDark(mode)));
  } catch {}
}

export function applyThemeClass(isDark: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark);
}
