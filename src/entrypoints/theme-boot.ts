import { BOOT_THEME_KEY, pickBootTheme, systemDarkFromSearch } from '../shared/boot-theme';

/** A classic script in app.html's head, so the first paint already has the last theme (MV3 allows no inline scripts). */
export default defineUnlistedScript(() => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(BOOT_THEME_KEY);
  } catch {
    // Storage blocked: the system scheme's default theme still beats a white frame.
  }
  const systemDark = systemDarkFromSearch(location.search) ?? matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = pickBootTheme(raw, systemDark);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  root.dataset.themeMode = theme.dark ? 'dark' : 'light';
  root.dataset.themeSource = theme.source;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.style.backgroundColor = 'var(--md-sys-color-surface-container)';
});
