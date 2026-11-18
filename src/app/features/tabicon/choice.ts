import type { ShapeName } from '../../ui/ShapeIcon';
import type { TabIconGlyph } from './glyphs';

/** Drawn designs, plus Gmail's own icon. */
export const TAB_ICON_LOOKS = [
  { look: 'mail', label: 'Mail', shape: 'Square', glyph: 'mail' },
  { look: 'letter', label: 'Initial', shape: 'Circle' },
  { look: 'work', label: 'Work', shape: 'Cookie4Sided', glyph: 'work' },
  { look: 'home', label: 'Home', shape: 'Cookie9Sided', glyph: 'home' },
  { look: 'star', label: 'Star', shape: 'Sunny', glyph: 'star' },
  { look: 'favorite', label: 'Heart', shape: 'Cookie12Sided', glyph: 'favorite' },
  { look: 'bolt', label: 'Bolt', shape: 'PuffyDiamond', glyph: 'bolt' },
  { look: 'eco', label: 'Leaf', shape: 'Clover4Leaf', glyph: 'eco' },
  { look: 'classic', label: 'Classic Gmail' },
  { look: 'gmail', label: 'Gmail' },
] as const satisfies readonly { look: string; label: string; shape?: ShapeName; glyph?: TabIconGlyph }[];

export type TabIconLook = (typeof TAB_ICON_LOOKS)[number]['look'];

/** Looks drawn in their own colors, so the color choice doesn't apply. */
export const hasOwnColors = (look: TabIconLook) => look === 'gmail' || look === 'classic';

export interface TabIcon {
  look: TabIconLook;
  /** 'theme' follows the app's colors; otherwise a hex seed from ACCOUNT_COLORS. */
  color: string;
  /** The inbox's unread count on the icon. */
  count: boolean;
}

export const DEFAULT_TAB_ICON: TabIcon = { look: 'mail', color: 'theme', count: true };

/** Undefined for anything that isn't a whole, known choice (an old version, a hand edit). */
export function cleanTabIcon(value: unknown): TabIcon | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const look = TAB_ICON_LOOKS.find((l) => l.look === v.look)?.look;
  const color = v.color === 'theme' || (typeof v.color === 'string' && /^#[0-9a-f]{6}$/.test(v.color)) ? v.color : undefined;
  if (!look || !color || typeof v.count !== 'boolean') return undefined;
  return { look, color, count: v.count };
}

/** An account's own icon, else the one for every account. */
export function tabIconFor(
  settings: { tabIcon: TabIcon; accountPrefs: Record<string, { tabIcon?: TabIcon }> },
  email: string | null | undefined,
): TabIcon {
  const own = email ? settings.accountPrefs[email.trim().toLowerCase()]?.tabIcon : undefined;
  return own ?? settings.tabIcon;
}

/** What a tab's icon shows for this many unread: a drawing, or Gmail's own icon untouched (`null`). */
export function needsDrawing(icon: TabIcon, unread: number): boolean {
  return icon.look !== 'gmail' || (icon.count && unread > 0);
}

/** As the badge reads: Gmail caps its own at 99+. */
export function badgeText(unread: number): string | null {
  if (!Number.isFinite(unread) || unread < 1) return null;
  return unread > 99 ? '99+' : String(Math.floor(unread));
}

/** The first character a person would read, uppercased: "É" for "élodie", one emoji whole. */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const first = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next().value?.segment : undefined;
  return (first ?? Array.from(trimmed)[0] ?? '').toLocaleUpperCase();
}
