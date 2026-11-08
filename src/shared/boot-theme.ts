import { GOOGLE_DARK, GOOGLE_LIGHT } from '../app/theme/google-palette';

/** The last resolved theme, readable synchronously before first paint: the app frame's localStorage (BOOT_THEME_KEY) and mail.google.com's (FRAME_BG_KEY). */
export const BOOT_THEME_KEY = 'bg.boot-theme';
export const FRAME_BG_KEY = 'better-gmail:frame-bg';

type ThemeMode = 'system' | 'light' | 'dark';
type ThemeSource = 'google' | 'dynamic';

/** What the app frame saves: color roles for each scheme its mode can show. */
export interface SavedBootTheme {
  mode: ThemeMode;
  source: ThemeSource;
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

export interface BootTheme {
  dark: boolean;
  source: ThemeSource;
  vars: Record<string, string>;
}

/** What the content script saves: the frame color for each scheme. */
interface SavedFrameBg {
  background?: string;
  light?: string;
  dark?: string;
  system?: boolean;
  isDark?: boolean;
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,/%]+\))$/i;

function prefixed(palette: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) out[`--md-sys-color-${k}`] = v;
  return out;
}

function cleanVars(vars: unknown): Record<string, string> | undefined {
  if (!vars || typeof vars !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (k.startsWith('--md-sys-color-') && typeof v === 'string' && COLOR.test(v)) out[k] = v;
  }
  return out['--md-sys-color-surface-container'] ? out : undefined;
}

function parse(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function resolveDark(mode: ThemeMode, systemDark: boolean) {
  return mode === 'system' ? systemDark : mode === 'dark';
}

/** With nothing saved, the default theme for the system scheme. */
export function pickBootTheme(raw: string | null, systemDark: boolean): BootTheme {
  const saved = parse(raw) as Partial<SavedBootTheme> | undefined;
  if (saved && typeof saved === 'object' && (saved.mode === 'system' || saved.mode === 'light' || saved.mode === 'dark')) {
    const dark = resolveDark(saved.mode, systemDark);
    const vars = cleanVars(dark ? saved.dark : saved.light);
    if (vars) return { dark, source: saved.source === 'dynamic' ? 'dynamic' : 'google', vars };
  }
  return { dark: systemDark, source: 'google', vars: prefixed(systemDark ? GOOGLE_DARK : GOOGLE_LIGHT) };
}

/** The system scheme the content script read from the top document, passed in the frame's URL. */
export function systemDarkFromSearch(search: string): boolean | undefined {
  const v = new URLSearchParams(search).get('dark');
  return v === '1' ? true : v === '0' ? false : undefined;
}

function isDarkColor(color: string) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (!m) return undefined;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128;
}

/** The color Gmail's page paints under the app frame, and whether it's a dark scheme. */
export function pickFrameBg(raw: string | null, systemDark: boolean): { background: string; dark: boolean } {
  const fallback = { background: systemDark ? '#1e1f20' : '#f0f4f9', dark: systemDark };
  if (raw && COLOR.test(raw)) return { background: raw, dark: isDarkColor(raw) ?? systemDark };
  const saved = parse(raw) as SavedFrameBg | undefined;
  if (!saved || typeof saved !== 'object') return fallback;
  if (saved.system) {
    const background = systemDark ? saved.dark : saved.light;
    return typeof background === 'string' && COLOR.test(background) ? { background, dark: systemDark } : fallback;
  }
  if (typeof saved.background !== 'string' || !COLOR.test(saved.background)) return fallback;
  const dark = typeof saved.isDark === 'boolean' ? saved.isDark : (isDarkColor(saved.background) ?? systemDark);
  return { background: saved.background, dark };
}
