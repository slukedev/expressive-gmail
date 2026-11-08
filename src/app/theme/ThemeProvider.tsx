import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { isRandomTheme, useSettings, useSettingsStore } from '../state/settings';
import { BOOT_THEME_KEY, systemDarkFromSearch, type SavedBootTheme } from '../../shared/boot-theme';
import { themeToCssVars } from './color';
import { themeFading } from './crossfade';
import { GOOGLE_DARK, GOOGLE_LIGHT } from './google-palette';

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

// The top document's scheme is the real system setting even where the frame's media query isn't.
let hostDark: boolean | null = typeof window !== 'undefined' && window.parent !== window ? (systemDarkFromSearch(location.search) ?? null) : null;
// theme-boot.js already painted the last theme; keep it until settings load.
const booted = typeof document !== 'undefined' && !!document.documentElement.dataset.themeMode;
const darkListeners = new Set<() => void>();
if (typeof window !== 'undefined' && window.parent !== window) {
  window.addEventListener('message', (e) => {
    const d = e.data as { source?: string; type?: string; dark?: unknown };
    // Only the embedding page can send this, and it carries nothing but a light/dark flag.
    if (e.source !== window.parent || d?.source !== 'better-gmail/content' || d.type !== 'scheme' || typeof d.dark !== 'boolean') return;
    hostDark = d.dark;
    darkListeners.forEach((fn) => fn());
  });
}

function subscribeDark(cb: () => void) {
  darkQuery?.addEventListener('change', cb);
  darkListeners.add(cb);
  // Chromium can drop a busy frame's media-query change event.
  window.addEventListener('focus', cb);
  document.addEventListener('visibilitychange', cb);
  return () => {
    darkQuery?.removeEventListener('change', cb);
    darkListeners.delete(cb);
    window.removeEventListener('focus', cb);
    document.removeEventListener('visibilitychange', cb);
  };
}

export function useSystemDark() {
  return useSyncExternalStore(subscribeDark, () => hostDark ?? darkQuery?.matches ?? false, () => false);
}

export function useResolvedDark() {
  const mode = useSettings((s) => s.themeMode);
  const systemDark = useSystemDark();
  return mode === 'system' ? systemDark : mode === 'dark';
}

function prefixed(palette: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) out[`--md-sys-color-${k}`] = v;
  return out;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const dark = useResolvedDark();
  const source = useSettings((s) => s.themeSource);
  const seed = useSettings((s) => s.seed);
  const variant = useSettings((s) => s.variant);
  const contrast = useSettings((s) => s.contrast);
  const mode = useSettings((s) => s.themeMode);
  const nextSeed = useSettings((s) => (isRandomTheme(s) ? s.nextRandomSeed : ''));
  const loaded = useSettingsStore((s) => s.loaded);
  const vars = useMemo(
    () =>
      source === 'google'
        ? prefixed(dark ? GOOGLE_DARK : GOOGLE_LIGHT)
        : themeToCssVars({ seed, variant, dark, contrast }),
    [source, seed, variant, dark, contrast],
  );

  const latest = useRef({ vars, dark, source });
  latest.current = { vars, dark, source };
  const applied = useRef<Record<string, string> | null>(null);
  const fading = useRef(false);
  useLayoutEffect(() => {
    if (!loaded && booted) return;
    const apply = () => {
      const { vars, dark, source } = latest.current;
      // Every write to the root restyles the whole app; a fade ending on the theme it started with writes nothing.
      if (applied.current === vars) return;
      applied.current = vars;
      const root = document.documentElement;
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
      // theme-boot.js's inline scheme would outlive a later theme change.
      root.style.removeProperty('color-scheme');
      root.style.removeProperty('background-color');
      root.dataset.themeMode = dark ? 'dark' : 'light';
      root.dataset.themeSource = source;
    };
    // Changes made through settings already cross-fade (crossfade.ts); this catches the rest,
    // like the system scheme flipping. Dragging a seed colour retargets the running fade.
    const first = !applied.current;
    if (first || fading.current || themeFading() || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    fading.current = true;
    const t = document.startViewTransition(apply);
    t.ready.catch(() => {});
    void t.finished.finally(() => {
      fading.current = false;
      apply();
    });
  }, [vars, dark, source, loaded]);

  useEffect(() => {
    // Defaults before settings load aren't the user's theme; don't remember them.
    if (!loaded) return;
    const schemeVars = (d: boolean) => (d === dark ? vars : source === 'google' ? prefixed(d ? GOOGLE_DARK : GOOGLE_LIGHT) : themeToCssVars({ seed, variant, dark: d, contrast }));
    // A random theme's next load paints the colour it will roll to (settings.ts), not this one.
    const bootVars = (d: boolean) => (nextSeed ? themeToCssVars({ seed: nextSeed, variant, dark: d, contrast }) : schemeVars(d));
    const light = mode === 'dark' ? undefined : bootVars(false);
    const darkVars = mode === 'light' ? undefined : bootVars(true);
    // Read by theme-boot.js on the next load, before anything paints.
    try {
      localStorage.setItem(BOOT_THEME_KEY, JSON.stringify({ mode, source, light, dark: darkVars } satisfies SavedBootTheme));
    } catch {
      // No storage: the next load starts from the system scheme.
    }
    if (window.parent === window) return;
    // The frame behind the iframe paints first on load; keep it matched for both schemes.
    window.parent.postMessage(
      {
        source: 'better-gmail/app',
        type: 'theme',
        background: vars['--md-sys-color-surface-container'],
        light: (light ?? bootVars(false))['--md-sys-color-surface-container'],
        dark: (darkVars ?? bootVars(true))['--md-sys-color-surface-container'],
        system: mode === 'system',
        isDark: dark,
      },
      'https://mail.google.com',
    );
  }, [loaded, vars, dark, mode, source, seed, variant, contrast, nextSeed]);

  return children;
}
