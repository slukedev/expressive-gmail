/** Darkens emails that paint their own colors, as Gmail on Android does: light backgrounds become dark surfaces with their hue kept, text is lightened only where hard to read, pictures keep their colors. */

export type Rgb = { r: number; g: number; b: number; a: number };

export function parseColor(css: string): Rgb | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(css.trim());
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: alpha };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  return null;
}

const toCss = ({ r, g, b, a }: Rgb) => (a >= 1 ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`);

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }: Rgb) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Hsl = { h: number; s: number; l: number };

function toHsl({ r, g, b }: Rgb): Hsl {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }: Hsl, a: number): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255, a };
}

/** Dark ones (a black banner, a red button) already work. */
function isLight(c: Rgb) {
  return toHsl(c).l > 0.55 || luminance(c) > 0.4;
}

/** White lands exactly on `paper` and paler tints a little above it, keeping their hue so a cream newsletter still reads warm. */
export function darkBackground(c: Rgb, paper: Rgb): Rgb {
  if (!isLight(c)) return c;
  const src = toHsl(c);
  const base = toHsl(paper);
  // 0 for white, about 0.45 for a mid tone.
  const depth = Math.min(1, 1 - src.l) / 0.45;
  return fromHsl({ h: src.h, s: Math.min(src.s, 0.9) * 0.55, l: base.l + Math.min(depth, 1) * 0.14 }, c.a);
}

/** Lightens, keeping hue, until it clears `min` contrast (4.5:1, WCAG AA body text). */
export function readableText(c: Rgb, bg: Rgb, min = 4.5): Rgb {
  if (contrast(c, bg) >= min) return c;
  const hsl = toHsl(c);
  // Mirror the lightness first (near-black becomes near-white), then climb.
  let l = Math.max(1 - hsl.l, 0.72);
  const s = Math.min(hsl.s, 0.85);
  let out = fromHsl({ h: hsl.h, s, l }, c.a);
  while (contrast(out, bg) < min && l < 0.98) {
    l = Math.min(0.98, l + 0.02);
    out = fromHsl({ h: hsl.h, s, l }, c.a);
  }
  return out;
}

/** A step above the paper so they still show. */
function darkBorder(c: Rgb, paper: Rgb): Rgb {
  if (!isLight(c)) return c;
  const d = darkBackground(c, paper);
  const hsl = toHsl(d);
  return fromHsl({ ...hsl, l: Math.min(hsl.l + 0.08, 0.5) }, c.a);
}

const SKIP = new Set(['IMG', 'PICTURE', 'VIDEO', 'SVG', 'CANVAS', 'IFRAME', 'SCRIPT', 'STYLE', 'BR', 'HR']);

/** Inline !important styles so the email's own CSS can't undo them. Document order, so a parent's new background is known before its children's text is checked against it. */
export function adaptDocument(doc: Document, paper: Rgb) {
  const win = doc.defaultView;
  if (!win) return;
  const backgrounds = new Map<Element, Rgb>();
  const elements = [doc.body, ...doc.body.querySelectorAll('*')];
  for (const el of elements) {
    if (SKIP.has(el.tagName.toUpperCase()) || el.closest('svg')) continue;
    const style = win.getComputedStyle(el);
    const parentBg = (el.parentElement && backgrounds.get(el.parentElement)) ?? paper;
    let bg = parentBg;
    const own = parseColor(style.backgroundColor);
    const hasImage = style.backgroundImage && style.backgroundImage !== 'none';
    if (own && own.a > 0 && !hasImage) {
      const next = darkBackground(own, paper);
      if (next !== own) (el as HTMLElement).style.setProperty('background-color', toCss(next), 'important');
      // A see-through tint sits on whatever is under it.
      bg = own.a >= 0.5 ? { ...next, a: 1 } : parentBg;
    } else if (hasImage && own && own.a > 0) {
      // A picture behind text: assume the picture wins.
      bg = { ...own, a: 1 };
    }
    backgrounds.set(el, bg);

    const text = parseColor(style.color);
    if (text && text.a > 0 && !hasImage) {
      const next = readableText(text, bg);
      if (next !== text) (el as HTMLElement).style.setProperty('color', toCss(next), 'important');
    }
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (style.getPropertyValue(`border-${side}-style`) === 'none') continue;
      const border = parseColor(style.getPropertyValue(`border-${side}-color`));
      if (!border || border.a === 0) continue;
      const next = darkBorder(border, paper);
      if (next !== border) (el as HTMLElement).style.setProperty(`border-${side}-color`, toCss(next), 'important');
    }
  }
}
