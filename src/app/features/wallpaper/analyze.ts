import { Hct, QuantizerCelebi, Score, hexFromArgb } from '@material/material-color-utilities';

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray;
}

export interface Analysis {
  /** Up to four theme seeds, best first, as Android's wallpaper picker offers them. Empty when nothing is usable. */
  colors: string[];
  /** Any pixel not fully opaque. */
  alpha: boolean;
  saliency: SaliencyMap;
}

/** 0 to 255 per cell, about 64 cells on the long edge. */
export interface SaliencyMap {
  width: number;
  height: number;
  data: Uint8Array;
  /** 0 to 1 of the picture: a face where one shows, else the salient region. */
  subject?: SubjectBox;
}

export interface SubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Skin or the browser's face detector, not just "where the detail is". */
  face: boolean;
}

/** WallpaperColors' MAX_WALLPAPER_EXTRACTION_AREA. */
const SEED_AREA = 112 * 112;
// Score never returns an empty list; this stands for "nothing suitable".
const NONE = 0xff010203;

/** Sampled down to about SEED_AREA. */
function seedPixels({ width, height, data }: Pixels): number[] {
  const step = Math.max(1, Math.sqrt((width * height) / SEED_AREA));
  const out: number[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const o = (Math.floor(y) * width + Math.floor(x)) * 4;
      // Nearly transparent pixels aren't what anyone sees.
      if (data[o + 3]! < 128) continue;
      out.push(((0xff << 24) | (data[o]! << 16) | (data[o + 1]! << 8) | data[o + 2]!) >>> 0);
    }
  }
  return out;
}

/** The TypeScript port's k-means starts from Math.random, so a picture could theme differently each time. Android seeds its Random with 0x42688; this does the same for one synchronous call. */
function seeded<T>(fn: () => T): T {
  const original = Math.random;
  let state = 0x42688;
  Math.random = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/** Below this HCT chroma a colour is a tinted grey: its hue is noise. */
const GREY = 8;
/** At and above this a colour reads as a colour. */
const COLOURFUL = 16;

/** Android's way (Celebi, then Score), except photos are mostly skin, sky and shadow, so Score often ranks a near-grey first; colourful, lit candidates move ahead and tinted greys drop. */
export function seedColors(pixels: Pixels, desired = 4): string[] {
  const argb = seedPixels(pixels);
  if (!argb.length) return [];
  const ranked = Score.score(seeded(() => QuantizerCelebi.quantize(argb, 128)), { desired: desired * 2, fallbackColorARGB: NONE, filter: true }).filter((c) => c !== NONE);
  const hct = new Map(ranked.map((c) => [c, Hct.fromInt(c)]));
  // Shadows and highlights carry little colour, whatever their measured chroma.
  const lit = (c: number) => hct.get(c)!.tone >= 20 && hct.get(c)!.tone <= 92;
  const strong = ranked.filter((c) => hct.get(c)!.chroma >= COLOURFUL && lit(c));
  const weak = ranked.filter((c) => hct.get(c)!.chroma >= GREY && !strong.includes(c));
  return [...strong, ...weak.filter(lit), ...weak.filter((c) => !lit(c))].slice(0, desired).map((c) => hexFromArgb(c));
}

export function hasAlpha({ data }: Pixels) {
  for (let o = 3; o < data.length; o += 4) if (data[o]! < 255) return true;
  return false;
}

const SALIENCY_EDGE = 64;

/** A cheap "what is this a picture of": skin, detail, colours apart from the average, and a pull to the middle. Enough to keep a face or a dog out from behind the reading pane; "Keep in view" covers the rest. */
export function saliencyMap({ width, height, data }: Pixels): SaliencyMap {
  const step = Math.max(1, Math.max(width, height) / SALIENCY_EDGE);
  const w = Math.max(1, Math.round(width / step));
  const h = Math.max(1, Math.round(height / step));
  // Box pooling, so noise doesn't read as detail.
  const r = new Float32Array(w * h);
  const g = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * step);
      const y0 = Math.floor(y * step);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) * step)));
      const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * step)));
      const sy = Math.max(1, Math.floor((y1 - y0) / 4));
      const sx = Math.max(1, Math.floor((x1 - x0) / 4));
      let n = 0;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      for (let yy = y0; yy < y1; yy += sy) {
        for (let xx = x0; xx < x1; xx += sx) {
          const o = (yy * width + xx) * 4;
          const a = data[o + 3]! / 255;
          rr += data[o]! * a;
          gg += data[o + 1]! * a;
          bb += data[o + 2]! * a;
          n++;
        }
      }
      const i = y * w + x;
      r[i] = rr / n;
      g[i] = gg / n;
      b[i] = bb / n;
    }
  }
  const n = w * h;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    mr += r[i]!;
    mg += g[i]!;
    mb += b[i]!;
  }
  mr /= n;
  mg /= n;
  mb /= n;
  const lum = (i: number) => 0.299 * r[i]! + 0.587 * g[i]! + 0.114 * b[i]!;
  const raw = new Float32Array(n);
  const skinCells = new Uint8Array(n);
  let max = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Detail: the luma gradient to the neighbours.
      const gx = x > 0 && x < w - 1 ? lum(i + 1) - lum(i - 1) : 0;
      const gy = y > 0 && y < h - 1 ? lum(i + w) - lum(i - w) : 0;
      const detail = Math.min(1, Math.hypot(gx, gy) / 60);
      // Standing apart from the picture's average colour.
      const apart = Math.min(1, Math.hypot(r[i]! - mr, g[i]! - mg, b[i]! - mb) / 120);
      // Skin, by the usual YCbCr box.
      const Y = lum(i);
      const cb = 128 - 0.168736 * r[i]! - 0.331264 * g[i]! + 0.5 * b[i]!;
      const cr = 128 + 0.5 * r[i]! - 0.418688 * g[i]! - 0.081312 * b[i]!;
      const skin = Y > 60 && Y < 235 && cb > 85 && cb < 125 && cr > 138 && cr < 170 ? 1 : 0;
      skinCells[i] = skin;
      const dx = (x + 0.5) / w - 0.5;
      const dy = (y + 0.5) / h - 0.45;
      const center = Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
      const v = (0.4 * detail + 0.35 * apart + 0.5 * skin) * (0.35 + 0.65 * center);
      raw[i] = v;
      if (v > max) max = v;
    }
  }
  // Blur once (3 x 3) so a subject reads as a region.
  const out = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let k = 0;
      for (let j = -1; j <= 1; j++) {
        for (let q = -1; q <= 1; q++) {
          const yy = y + j;
          const xx = x + q;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          sum += raw[yy * w + xx]!;
          k++;
        }
      }
      out[y * w + x] = max ? Math.round((sum / k / max) * 255) : 0;
    }
  }
  const salient = salientBox(out, w, h);
  const face = faceBox(skinCells, w, h);
  // Skin away from everything else that draws the eye is a hand or a wall, not a face.
  const meets = face && face.x < salient.x + salient.width && salient.x < face.x + face.width && face.y < salient.y + salient.height && salient.y < face.y + face.height;
  return { width: w, height: h, data: out, subject: meets ? face : salient };
}

/** Trimmed to a face's proportions from its top (a neck or shoulders don't count). Null when there's too little skin. */
function faceBox(skin: Uint8Array, w: number, h: number): SubjectBox | null {
  const seen = new Uint8Array(w * h);
  let best: { x0: number; y0: number; x1: number; y1: number; n: number } | null = null;
  for (let start = 0; start < w * h; start++) {
    if (!skin[start] || seen[start]) continue;
    const box = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      box.n++;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x + 1);
      box.y1 = Math.max(box.y1, y + 1);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && skin[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (!best || box.n > best.n) best = box;
  }
  // At least half a percent of the picture, compact (not a skin-coloured wall or sand), touching at most one edge.
  if (!best || best.n < w * h * 0.005) return null;
  const area = (best.x1 - best.x0) * (best.y1 - best.y0);
  const edges = Number(best.x0 === 0) + Number(best.y0 === 0) + Number(best.x1 === w) + Number(best.y1 === h);
  if (area > w * h * 0.2 || best.n / area < 0.45 || edges > 1) return null;
  const width = best.x1 - best.x0;
  // Cells are square: a face is about 1.3 times as tall as wide.
  const height = Math.min(best.y1 - best.y0, Math.ceil(width * 1.3));
  return { x: best.x0 / w, y: best.y0 / h, width: width / w, height: height / h, face: true };
}

/** The most salient fifth: its weighted centre, two deviations wide. */
function salientBox(data: Uint8Array, w: number, h: number): SubjectBox {
  const cut = [...data].sort((a, b) => a - b)[Math.floor(data.length * 0.8)]!;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i]! < cut || !data[i]) continue;
    sw += data[i]!;
    sx += data[i]! * ((i % w) + 0.5);
    sy += data[i]! * (Math.floor(i / w) + 0.5);
  }
  if (!sw) return { x: 0.3, y: 0.3, width: 0.4, height: 0.4, face: false };
  const cx = sx / sw;
  const cy = sy / sw;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i]! < cut || !data[i]) continue;
    vx += data[i]! * ((i % w) + 0.5 - cx) ** 2;
    vy += data[i]! * (Math.floor(i / w) + 0.5 - cy) ** 2;
  }
  const rx = Math.max(w * 0.08, Math.sqrt(vx / sw));
  const ry = Math.max(h * 0.08, Math.sqrt(vy / sw));
  const x0 = Math.max(0, cx - rx);
  const y0 = Math.max(0, cy - ry);
  return { x: x0 / w, y: y0 / h, width: (Math.min(w, cx + rx) - x0) / w, height: (Math.min(h, cy + ry) - y0) / h, face: false };
}

export function analyze(pixels: Pixels): Analysis {
  return { colors: seedColors(pixels), alpha: hasAlpha(pixels), saliency: saliencyMap(pixels) };
}
