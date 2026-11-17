import { shapePath, type ShapeName } from '../../ui/ShapeIcon';
import { badgeText, TAB_ICON_LOOKS, type TabIconLook } from './choice';
import { TAB_ICON_GLYPHS, type TabIconGlyph } from './glyphs';

/** Drawn at 64 so the browser has detail to scale down to 16 and 32. */
export const SIZE = 64;
const BADGE_HEIGHT = 30;
const MARK_WITH_BADGE = 54;
const BADGE_PAD = 7;
// Clear space between the badge and the tile, so a red pill never reads as part of a red tile.
const BADGE_GAP = 4;
const FONT = '"Google Sans Flex", system-ui, sans-serif';

export interface TabIconColors {
  tile: string;
  onTile: string;
  badge: string;
  onBadge: string;
}

export interface TabIconSpec {
  look: Exclude<TabIconLook, 'gmail'> | 'image';
  colors: TabIconColors;
  /** Shown only when there's something to count. */
  unread: number | null;
  /** For `letter`. */
  initial?: string;
}

type Mark =
  | { kind: 'shape'; shape: ShapeName; glyph?: TabIconGlyph; glyphSize: number }
  | { kind: 'letter'; text: string }
  | { kind: 'image' };

export interface TabIconLayout {
  mark: Mark;
  colors: TabIconColors;
  badge: { text: string; x: number; width: number; height: number } | null;
}

// Pointy shapes leave less room inside them.
const GLYPH_SIZE: Partial<Record<ShapeName, number>> = { Square: 42, Circle: 40, Cookie4Sided: 38, Sunny: 32, PuffyDiamond: 32, Clover4Leaf: 32 };

/** Where everything goes; `measure` says how wide a badge's text sets. */
export function tabIconLayout(spec: TabIconSpec, measure: (text: string) => number): TabIconLayout {
  const design = TAB_ICON_LOOKS.find((l) => l.look === spec.look) as { shape?: ShapeName; glyph?: TabIconGlyph } | undefined;
  const shape = design?.shape ?? 'Square';
  const mark: Mark =
    spec.look === 'image'
      ? { kind: 'image' }
      : spec.look === 'letter'
        ? { kind: 'letter', text: spec.initial || '@' }
        : { kind: 'shape', shape, glyph: design?.glyph ?? 'mail', glyphSize: GLYPH_SIZE[shape] ?? 36 };
  const text = spec.unread === null ? null : badgeText(spec.unread);
  const width = text ? Math.min(SIZE, Math.max(BADGE_HEIGHT, Math.ceil(measure(text)) + BADGE_PAD * 2)) : 0;
  return { mark, colors: spec.colors, badge: text ? { text, x: SIZE - width, width, height: BADGE_HEIGHT } : null };
}

const BADGE_FONT = `700 25px ${FONT}`;
const LETTER_FONT = `600 38px ${FONT}`;

function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, h / 2);
}

export function paintTabIcon(g: CanvasRenderingContext2D, layout: TabIconLayout, image?: CanvasImageSource) {
  const { mark, colors, badge } = layout;
  g.clearRect(0, 0, SIZE, SIZE);
  g.save();
  // With a badge the mark steps down and in, so the badge covers its corner, not its middle.
  if (badge) {
    g.translate(0, SIZE - MARK_WITH_BADGE);
    g.scale(MARK_WITH_BADGE / SIZE, MARK_WITH_BADGE / SIZE);
  }
  if (mark.kind === 'image') {
    if (image) g.drawImage(image, 0, 0, SIZE, SIZE);
  } else if (mark.kind === 'letter') {
    g.fillStyle = colors.tile;
    g.beginPath();
    g.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = colors.onTile;
    g.font = LETTER_FONT;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const m = g.measureText(mark.text);
    // Centred on the ink, not the font's line box, so a "g" and an "A" sit alike.
    g.fillText(mark.text, SIZE / 2, SIZE / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    g.save();
    g.scale(SIZE, SIZE);
    g.fillStyle = colors.tile;
    g.fill(new Path2D(shapePath(mark.shape)));
    g.restore();
    if (mark.glyph) {
      const scale = mark.glyphSize / 24;
      g.translate((SIZE - mark.glyphSize) / 2, (SIZE - mark.glyphSize) / 2);
      g.scale(scale, scale);
      g.fillStyle = colors.onTile;
      g.fill(new Path2D(TAB_ICON_GLYPHS[mark.glyph]));
    }
  }
  g.restore();
  if (!badge) return;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  pill(g, badge.x - BADGE_GAP, -BADGE_GAP, badge.width + BADGE_GAP * 2, badge.height + BADGE_GAP * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = colors.badge;
  pill(g, badge.x, 0, badge.width, badge.height);
  g.fill();
  g.fillStyle = colors.onBadge;
  g.font = BADGE_FONT;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const m = g.measureText(badge.text);
  g.fillText(badge.text, badge.x + badge.width / 2, badge.height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  g.restore();
}

const cache = new Map<string, string>();
const imageIds = new WeakMap<HTMLImageElement, number>();
let nextImageId = 0;

/** As a PNG `data:` URL, which every browser takes as a favicon. Null where there's no canvas. */
export function renderTabIcon(spec: TabIconSpec, image?: HTMLImageElement): string | null {
  if (image && !imageIds.has(image)) imageIds.set(image, ++nextImageId);
  const key = JSON.stringify([spec, image && imageIds.get(image)]);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.font = BADGE_FONT;
  paintTabIcon(g, tabIconLayout(spec, (t) => g.measureText(t).width), image);
  const url = canvas.toDataURL('image/png');
  if (cache.size > 48) cache.delete(cache.keys().next().value!);
  cache.set(key, url);
  return url;
}
