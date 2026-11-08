import {
  Hct,
  MaterialDynamicColors,
  SchemeTonalSpot,
  SchemeVibrant,
  SchemeNeutral,
  SchemeExpressive,
  argbFromHex,
  hexFromArgb,
  type DynamicScheme,
} from '@material/material-color-utilities';

export type SchemeVariant = 'tonal-spot' | 'vibrant' | 'expressive' | 'neutral';

export interface ThemeSpec {
  seed: string;
  variant: SchemeVariant;
  dark: boolean;
  /** -1 (reduced) to 1 (high). 0 is the standard scheme. */
  contrast: number;
}

export const DEFAULT_SEED = '#0b57d0';

// Each scheme style sets its own colourfulness, so only hue tells presets apart: ~26 degrees apart.
export const SEED_PRESETS: { name: string; seed: string }[] = [
  { name: 'Gmail blue', seed: '#0b57d0' },
  { name: 'Violet', seed: '#6750a4' },
  { name: 'Plum', seed: '#7b2f8f' },
  { name: 'Rose', seed: '#984061' },
  { name: 'Coral', seed: '#b3261e' },
  { name: 'Orange', seed: '#a04100' },
  { name: 'Amber', seed: '#8b5000' },
  { name: 'Gold', seed: '#795900' },
  { name: 'Olive', seed: '#5f6300' },
  { name: 'Green', seed: '#386a20' },
  { name: 'Mint', seed: '#006d43' },
  { name: 'Teal', seed: '#006a6a' },
  { name: 'Cyan', seed: '#00687a' },
  { name: 'Sky', seed: '#00639b' },
];

/** A good way round the wheel from `away`, so the next one always looks different. */
export function randomSeed(away?: string, random = Math.random): string {
  const from = away ? Hct.fromInt(argbFromHex(away)).hue : NaN;
  for (let tries = 0; ; tries++) {
    const hue = random() * 360;
    const diff = (((hue - from) % 360) + 360) % 360;
    if (!(Math.min(diff, 360 - diff) < 45) || tries > 8) return hexFromArgb(Hct.from(hue, 48 + random() * 24, 40).toInt());
  }
}

export const isPresetSeed = (seed: string) => SEED_PRESETS.some((p) => p.seed === seed);

export function normalizeHex(value: string): string | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return undefined;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}

const SCHEMES = {
  'tonal-spot': SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  neutral: SchemeNeutral,
} as const;

const toKebab = (s: string) => s.replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const built = new Map<string, DynamicScheme>();

export function buildScheme(spec: ThemeSpec): DynamicScheme {
  const key = `${spec.seed}|${spec.variant}|${spec.dark}|${spec.contrast}`;
  let scheme = built.get(key);
  if (!scheme) {
    const Scheme = SCHEMES[spec.variant] ?? SchemeTonalSpot;
    scheme = new Scheme(Hct.fromInt(argbFromHex(spec.seed)), spec.dark, spec.contrast, '2025', 'phone');
    if (built.size > 32) built.delete(built.keys().next().value!);
    built.set(key, scheme);
  }
  return scheme;
}

// A scheme is 50 colour solves, and the current light and dark pair is asked for on every change.
const schemes = new Map<string, Record<string, string>>();

export function themeToCssVars(spec: ThemeSpec): Record<string, string> {
  const key = `${spec.seed}|${spec.variant}|${spec.dark}|${spec.contrast}`;
  let vars = schemes.get(key);
  if (!vars) {
    vars = solveScheme(spec);
    if (schemes.size > 16) schemes.delete(schemes.keys().next().value!);
    schemes.set(key, vars);
  }
  return vars;
}

function solveScheme(spec: ThemeSpec): Record<string, string> {
  const scheme = buildScheme(spec);
  const colors = new MaterialDynamicColors();
  const out: Record<string, string> = {};
  for (const dc of colors.allColors) {
    out[`--md-sys-color-${toKebab(dc.name)}`] = hexFromArgb(dc.getArgb(scheme));
  }
  return out;
}

// HCT solves are slow and every list row asks again on each render; the inputs are few.
const solved = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = solved.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    solved.set(key, v);
  }
  return v;
}

export function labelChipColors(hex: string, dark: boolean): { bg: string; fg: string } {
  return cached(`chip${hex}${dark}`, () => solveChip(hex, dark));
}

function solveChip(hex: string, dark: boolean): { bg: string; fg: string } {
  const hct = Hct.fromInt(argbFromHex(hex));
  const chroma = Math.min(Math.max(hct.chroma, 16), 48);
  const bg = Hct.from(hct.hue, chroma, dark ? 30 : 90);
  const fg = Hct.from(hct.hue, chroma, dark ? 90 : 25);
  return { bg: hexFromArgb(bg.toInt()), fg: hexFromArgb(fg.toInt()) };
}

/** Avatar fallback tile color for a sender, stable per address. */
export function avatarColor(key: string, dark: boolean): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hues = [25, 50, 145, 175, 200, 230, 265, 300, 330, 355];
  const hue = hues[h % hues.length];
  return cached(`avatar${hue}${dark}`, () => ({
    bg: hexFromArgb(Hct.from(hue, 36, dark ? 35 : 82).toInt()),
    fg: hexFromArgb(Hct.from(hue, 40, dark ? 92 : 20).toInt()),
  }));
}

/** The solid swatch Gmail shows for a label in the menu. */
export function labelDotColor(hex: string, dark: boolean): string {
  return cached(`dot${hex}${dark}`, () => {
    const hct = Hct.fromInt(argbFromHex(hex));
    return hexFromArgb(Hct.from(hct.hue, Math.max(hct.chroma, 36), dark ? 72 : 58).toInt());
  });
}
