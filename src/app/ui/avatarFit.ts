import { useEffect, useState } from 'react';
import { readKey, writeKey } from '../state/storage';
import { AVATAR_FITS_KEY } from '../data/cacheKeys';

/**
 * How an avatar image sits in its circle, worked out once from its pixels:
 * cover fills it (photos, logos drawn edge to edge); placeholder is Google's silhouette or letter tile; tile scales a logo's solid tile up to fill
 * the circle in the tile's colour; mark centres a transparent logo on a contrasting circle; unknown means unreadable pixels, where large
 * icons (128px) fill and small favicons sit inside. `x` and `y` are % of the avatar from the centre.
 */
export type AvatarFit =
  | { kind: 'cover'; scale: number; x: number; y: number }
  | { kind: 'placeholder' }
  | { kind: 'tile'; bg: string; scale: number; x: number; y: number }
  | { kind: 'mark'; bg: string; scale: number; x: number; y: number }
  | { kind: 'unknown'; large: boolean };

const SIZE = 48;
const LIGHT_MARK_BG = '#ffffff';
const DARK_MARK_BG = '#1f1f1f';
/** A logo on a transparent background fills this much of the circle. */
const MARK_FILL = 0.62;

type Pixels = Uint8ClampedArray;
type RGBA = [number, number, number, number];

const lum = (p: RGBA) => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
const dist = (a: RGBA, b: RGBA) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

function at(px: Pixels, x: number, y: number): RGBA {
  const i = (y * SIZE + x) * 4;
  return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
}

function average(list: RGBA[]): RGBA {
  const n = Math.max(1, list.length);
  return [0, 1, 2, 3].map((c) => list.reduce((s, p) => s + p[c]!, 0) / n) as RGBA;
}

/** `inset` px inside the box. */
function ring(box: Box, inset: number): [number, number][] {
  const out: [number, number][] = [];
  const x0 = Math.round(box.x0 + inset);
  const x1 = Math.round(box.x1 - inset);
  const y0 = Math.round(box.y0 + inset);
  const y1 = Math.round(box.y1 - inset);
  if (x1 <= x0 || y1 <= y0) return out;
  for (let x = x0; x <= x1; x++) out.push([x, y0], [x, y1]);
  for (let y = y0; y <= y1; y++) out.push([x0, y], [x1, y]);
  return out;
}

/** `r` is a fraction of the side: catches round tiles. */
function circle(box: Box, r: number): [number, number][] {
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) + 1;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const out: [number, number][] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    out.push([Math.round(cx + Math.cos(a) * side * r), Math.round(cy + Math.sin(a) * side * r)]);
  }
  return out.filter(([x, y]) => x >= 0 && y >= 0 && x < SIZE && y < SIZE);
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pixels that aren't background (transparent, or the corner colour). */
function contentBox(px: Pixels, isBackground: (p: RGBA) => boolean): Box | null {
  let x0 = SIZE;
  let y0 = SIZE;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (isBackground(at(px, x, y))) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Puts `box` at `fill` of the avatar's width, centred. */
function place(box: Box, fill: number) {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const scale = (fill * SIZE) / Math.max(w, h);
  const cx = (box.x0 + box.x1 + 1) / 2;
  const cy = (box.y0 + box.y1 + 1) / 2;
  return {
    scale: Math.round(scale * 1000) / 1000,
    x: Math.round(((SIZE / 2 - cx) / SIZE) * scale * 1000) / 10,
    y: Math.round(((SIZE / 2 - cy) / SIZE) * scale * 1000) / 10,
  };
}

/** Nearly all points opaque and close to one colour. */
function flatRing(points: RGBA[]): RGBA | null {
  if (points.length < 8) return null;
  const opaque = points.filter((p) => p[3] > 200);
  if (opaque.length / points.length < 0.85) return null;
  const avg = average(opaque);
  const close = opaque.filter((p) => dist(p, avg) < 60).length / opaque.length;
  return close > 0.85 ? avg : null;
}

const css = (p: RGBA) => `rgb(${Math.round(p[0])} ${Math.round(p[1])} ${Math.round(p[2])})`;

/** Exported for tests. */
export function fitFromPixels(px: Pixels, brand: boolean): AvatarFit {
  const corners = [at(px, 0, 0), at(px, SIZE - 1, 0), at(px, 0, SIZE - 1), at(px, SIZE - 1, SIZE - 1)];
  const transparentCorners = corners.filter((p) => p[3] < 64).length >= 3;
  const cornerColour = average(corners);

  // People: whatever Google gives is what Gmail shows. Judging placeholders by colour hid simple pictures people chose, so Google's own "no photo" marks decide.
  if (!brand) return { kind: 'cover', scale: 1, x: 0, y: 0 };

  const isBackground = transparentCorners
    ? (p: RGBA) => p[3] < 64
    : (p: RGBA) => p[3] > 200 && dist(p, cornerColour) < 40;
  const box = contentBox(px, isBackground);
  if (!box) return { kind: 'mark', bg: LIGHT_MARK_BG, scale: 1, x: 0, y: 0 };
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) + 1;

  // Is the content itself a solid tile (a rounded square or circle)?
  const tileColour =
    flatRing(ring(box, side * 0.1).map(([x, y]) => at(px, x, y))) ?? flatRing(circle(box, 0.4).map(([x, y]) => at(px, x, y)));
  if (tileColour) {
    // A little extra trims its rounded corners.
    if (side >= SIZE * 0.92) return { kind: 'cover', scale: 1.06, x: 0, y: 0 };
    return { kind: 'tile', bg: css(tileColour), ...place(box, 1.12) };
  }

  if (!transparentCorners) {
    // A logo on its own solid background: that background becomes the circle.
    return { kind: 'tile', bg: css(cornerColour), ...place(box, MARK_FILL) };
  }

  // A transparent logo: a circle that contrasts with its colours.
  let total = 0;
  let weight = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]! / 255;
    if (a < 0.5) continue;
    total += lum([px[i]!, px[i + 1]!, px[i + 2]!, 255]) * a;
    weight += a;
  }
  const light = weight > 0 && total / weight > 0.78;
  return { kind: 'mark', bg: light ? DARK_MARK_BG : LIGHT_MARK_BG, ...place(box, MARK_FILL) };
}

/** Background then figure: today's blue default-user (also served under ordinary /a-/ addresses) and the older grey one. */
const SILHOUETTES: [RGBA, RGBA][] = [
  [[160, 195, 255, 255], [67, 116, 224, 255]],
  [[225, 225, 225, 255], [189, 189, 189, 255]],
];

/** Nearly every pixel one of its two colours, the background in the corners. Exact colours, so a simple picture someone chose still counts as a photo. */
export function isSilhouette(px: Pixels): boolean {
  // Google's pixels sit within a few units of these; a drawing in similar blues doesn't.
  const near = (p: RGBA, c: RGBA) => p[3] > 200 && dist(p, c) < 10;
  const total = SIZE * SIZE;
  return SILHOUETTES.some(([bg, figure]) => {
    if (!near(at(px, 0, 0), bg) || !near(at(px, SIZE - 1, 0), bg)) return false;
    let back = 0;
    let fore = 0;
    for (let i = 0; i < px.length; i += 4) {
      const p: RGBA = [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
      if (near(p, bg)) back++;
      else if (near(p, figure)) fore++;
    }
    // The rest is the edge between the two, blended by scaling down.
    return (back + fore) / total > 0.75 && back / total > 0.5 && fore / total > 0.18;
  });
}

/** createImageBitmap can't take SVG; an <img> of the same bytes can, and a blob: URL keeps the canvas readable. */
function svgImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG did not load'));
    };
    img.src = url;
  });
}

async function decode(blob: Blob): Promise<Pixels | null> {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (blob.type.startsWith('image/svg')) ctx.drawImage(await svgImage(blob), 0, 0, SIZE, SIZE);
  else {
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
    bitmap.close();
  }
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

/** So a long list of new senders doesn't open dozens of requests at once. */
const READ_CONCURRENCY = 6;
let reading = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (reading >= READ_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  reading++;
  try {
    return await task();
  } finally {
    reading--;
    waiting.shift()?.();
  }
}

const READ_TIMEOUT_MS = 4_000;

/** A read that found nothing (offline, signed out). */
export const UNREADABLE_RETRY_MS = 5 * 60_000;
const MAX_BLOBS = 300;
/** Each holds an image's bytes in memory until evicted and revoked. */
export const MAX_COPIES = 100;

interface Read<T> {
  value: Promise<T>;
  /** When it settled empty, so it can be tried again later. */
  failedAt?: number;
}

/** Unless it came back empty a while ago. */
function cachedRead<T>(map: Map<string, Read<T>>, url: string): Read<T> | undefined {
  const read = map.get(url);
  if (read?.failedAt !== undefined && Date.now() - read.failedAt >= UNREADABLE_RETRY_MS) {
    map.delete(url);
    return undefined;
  }
  return read;
}

const blobs = new Map<string, Read<Blob | null>>();

/** Without cookies first; some Google contact photos only load with them. */
function imageBlob(url: string): Promise<Blob | null> {
  let read = cachedRead(blobs, url);
  if (!read) {
    const entry: Read<Blob | null> = {
      value: limited(async () => {
        for (const credentials of ['omit', 'include'] as const) {
          try {
            // A hanging read (Safari can hold a request to a host it hasn't been allowed on) would block every avatar after it.
            const res = await fetch(url, { credentials, referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
            const body = res.ok ? await res.blob() : null;
            if (body?.type.startsWith('image/') || (body && !body.type)) return body;
          } catch {
            // Not readable from here: try the next way.
          }
        }
        return null;
      }).then((blob) => {
        if (!blob) entry.failedAt = Date.now();
        return blob;
      }),
    };
    read = entry;
    blobs.set(url, read);
    if (blobs.size > MAX_BLOBS) blobs.delete(blobs.keys().next().value!);
  }
  return read.value;
}

/** Google's image hosts answer CORS for anyone, so this works where the extension's fetch can't reach the host (Safari, until granted). */
function corsPixels(url: string): Promise<Pixels | null> {
  if (/^(data|blob):/.test(url) || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      try {
        // A page canvas: Safari's OffscreenCanvas won't draw an <img>.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        resolve(ctx.getImageData(0, 0, SIZE, SIZE).data);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

async function pixelsOf(url: string, brand: boolean): Promise<Pixels | null> {
  const blob = await imageBlob(url);
  if (!blob) return limited(() => corsPixels(url));
  // Drawn faces (an SVG) are as flat as Google's placeholders by colour count; only logos are judged from SVG.
  if (!brand && blob.type.startsWith('image/svg')) return null;
  try {
    return await decode(blob);
  } catch {
    return null;
  }
}

/** A picture whose pixels can't be read counts as a photo. */
export async function isGooglePlaceholder(url: string): Promise<boolean> {
  const px = await pixelsOf(url, false).catch(() => null);
  return !!px && isSilhouette(px);
}

const copies = new Map<string, Read<string | undefined>>();

/** A copy this frame can show when the address can't: bytes the extension read (with Google's cookies where it may), as a blob: URL. Oldest copies are revoked past MAX_COPIES. */
export function localCopy(url: string): Promise<string | undefined> {
  if (/^(data|blob):/.test(url) || typeof URL.createObjectURL !== 'function') return Promise.resolve(undefined);
  let read = cachedRead(copies, url);
  if (read) {
    // Most recently used last, so eviction takes the stalest.
    copies.delete(url);
    copies.set(url, read);
    return read.value;
  }
  const entry: Read<string | undefined> = {
    value: imageBlob(url).then((blob) => {
      if (!blob) {
        entry.failedAt = Date.now();
        return undefined;
      }
      return URL.createObjectURL(blob);
    }),
  };
  read = entry;
  copies.set(url, read);
  while (copies.size > MAX_COPIES) {
    const [oldest, evicted] = copies.entries().next().value!;
    copies.delete(oldest);
    void evicted.value.then((copy) => copy && URL.revokeObjectURL(copy));
  }
  return read.value;
}

/** Width needs no access to pixels. */
function naturalWidth(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img.naturalWidth);
    img.onerror = () => resolve(0);
    img.src = url;
  });
}

const fits = new Map<string, Promise<AvatarFit>>();
/** [fit, when], read synchronously so an avatar seen before never waits a render, and stored so a reload doesn't read the pixels again. */
const settled = new Map<string, [AvatarFit, number]>();
const MAX_SETTLED = 600;
const DAY = 24 * 60 * 60_000;
/** One from unreadable pixels sooner, in case access was granted since. */
const FIT_TTL_MS = { read: 30 * DAY, unknown: DAY };

/** So storage holds keys, not images (an inline logo's data: URL). */
function digest(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

const fitKey = (url: string, brand: boolean) => `${brand ? 'b' : 'p'}|${url.length > 300 ? `#${digest(url)}` : url}`;

const fresh = ([fit, at]: [AvatarFit, number]) => Date.now() - at < (fit.kind === 'unknown' ? FIT_TTL_MS.unknown : FIT_TTL_MS.read);

const restored: Promise<void> = readKey<Record<string, [AvatarFit, number]>>(AVATAR_FITS_KEY).then((saved) => {
  for (const [key, entry] of Object.entries(saved ?? {})) {
    if (Array.isArray(entry) && entry[0]?.kind && fresh(entry) && !settled.has(key)) settled.set(key, entry);
  }
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void writeKey(AVATAR_FITS_KEY, Object.fromEntries(settled)).catch(() => undefined), 2_000);
}

let onUnreadable: ((url: string) => void) | undefined;
/** For the photo log. */
export function reportUnreadable(fn: (url: string) => void) {
  onUnreadable = fn;
}

/** Then the image shows as a plain photo anyway. */
const FIT_WAIT_MS = 700;

const PERSON_FIT: AvatarFit = { kind: 'cover', scale: 1, x: 0, y: 0 };
const PERSON: Promise<AvatarFit> = Promise.resolve(PERSON_FIT);

function avatarFit(url: string, brand: boolean): Promise<AvatarFit> {
  // A person's picture shows as Google gives it: nothing to read.
  if (!brand) return PERSON;
  const key = fitKey(url, brand);
  let fit = fits.get(key);
  if (!fit) {
    // A fit saved on an earlier visit is taken as is.
    fit = restored.then(async (): Promise<AvatarFit> => {
      const known = settled.get(key);
      if (known && fresh(known)) {
        // Most recently used last.
        settled.delete(key);
        settled.set(key, known);
        return known[0];
      }
      const px = await pixelsOf(url, brand);
      let f: AvatarFit;
      if (px) f = fitFromPixels(px, brand);
      else {
        onUnreadable?.(url);
        f = { kind: 'unknown', large: (await naturalWidth(url)) >= 96 };
      }
      settled.delete(key);
      settled.set(key, [f, Date.now()]);
      if (settled.size > MAX_SETTLED) settled.delete(settled.keys().next().value!);
      scheduleSave();
      return f;
    });
    fits.set(key, fit);
    if (fits.size > 600) fits.delete(fits.keys().next().value!);
  }
  return fit;
}

/** Undefined while it's worked out. */
export function useAvatarFit(url: string | undefined, brand: boolean): AvatarFit | undefined {
  const [state, setState] = useState<{ url: string; fit: AvatarFit } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let settled = false;
    // A slow read never keeps a photo hidden behind its initial.
    const wait = setTimeout(() => live && !settled && setState({ url, fit: brand ? { kind: 'unknown', large: true } : { kind: 'cover', scale: 1, x: 0, y: 0 } }), FIT_WAIT_MS);
    void avatarFit(url, brand).then((fit) => {
      settled = true;
      if (live) setState({ url, fit });
    });
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [url, brand]);
  if (url && !(state && state.url === url)) {
    // A person's picture needs no reading, and a brand's fit seen before is known: neither waits a render.
    if (!brand) return PERSON_FIT;
    const known = settled.get(fitKey(url, true));
    if (known) return known[0];
  }
  return state && state.url === url ? state.fit : undefined;
}
