/** Decisions about pictures, kept apart from the canvas work so they can be tested alone. */
import type { SubjectBox } from './analyze';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Decoding more would take hundreds of megabytes. */
export const MAX_PIXELS = 120_000_000;
/** Shown at 112 px, so this stays sharp on a 3x screen zoomed in; about 100 KB as WebP. */
const LONG_EDGE = 1024;
/** Panoramas may run longer so the square cut from them isn't a smear. */
const SHORT_EDGE_FLOOR = 512;
const LONG_EDGE_CAP = 4096;
/** Smaller pictures are enlarged to this in smooth steps. */
const MIN_LONG_EDGE = 512;
/** Pictures saved larger than this by older versions are shrunk when next opened. */
export const OVERSIZED_EDGE = 1400;
/** Past fitting its square. */
export const MAX_ZOOM = 4;
/** The built-ins have no fine detail to lose. */
const ANALYSIS_EDGE = 1024;

export type UploadProblem = 'too-big' | 'not-picture';

export type Format = 'heic' | 'avif' | 'svg' | 'gif' | 'jpeg' | 'png' | 'other';

export function formatOf(file: { name: string; type: string }): Format {
  const type = file.type.toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic';
  if (type === 'image/avif' || ext === 'avif') return 'avif';
  if (type === 'image/svg+xml' || ext === 'svg') return 'svg';
  if (type === 'image/gif' || ext === 'gif') return 'gif';
  if (type === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') return 'jpeg';
  if (type === 'image/png' || ext === 'png') return 'png';
  return 'other';
}

const PICTURE_EXT = /\.(jpe?g|jfif|png|webp|gif|avif|heic|heif|svg|bmp|ico|tiff?)$/i;

/** The browser gets the final say when it opens the file. */
export function checkFile(file: { name: string; type: string; size: number }): UploadProblem | null {
  if (file.size > MAX_FILE_BYTES) return 'too-big';
  // Some systems leave the type empty (HEIC on Windows, files from a phone); trust the extension then.
  if (!file.type.toLowerCase().startsWith('image/') && !PICTURE_EXT.test(file.name)) return 'not-picture';
  return null;
}

export interface SizePlan {
  width: number;
  height: number;
  /** Enlarged from a small original. */
  soft: boolean;
}

export function sizePlan(width: number, height: number): SizePlan {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  let s = LONG_EDGE / long;
  if (short * s < SHORT_EDGE_FLOOR) s = Math.max(s, Math.min(SHORT_EDGE_FLOOR / short, LONG_EDGE_CAP / long));
  s = Math.min(1, s);
  let soft = false;
  if (long * s < MIN_LONG_EDGE) {
    s = MIN_LONG_EDGE / long;
    soft = true;
  }
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)), soft };
}

/** WebP keeps transparency and is small; Safari can't encode it, so JPEG there, or PNG with transparency. */
export function encodeOrder(alpha: boolean): { type: string; quality?: number }[] {
  return [{ type: 'image/webp', quality: 0.8 }, alpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.82 }];
}

export function analysisSize(width: number, height: number) {
  const s = Math.min(1, ANALYSIS_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Browsers draw a cut-off JPEG or PNG as far as it got. A complete JPEG has FF D9 at the end, or past its first 64 KB when a phone appended a motion clip (the EXIF thumbnail's marker sits inside those 64 KB); a PNG ends with IEND. */
export function looksTruncated(format: Format, file: Uint8Array): boolean {
  const n = file.length;
  if (format === 'jpeg') {
    let end = n;
    while (end > 0 && (file[end - 1] === 0x00 || file[end - 1] === 0x0a || file[end - 1] === 0x0d || file[end - 1] === 0x20)) end--;
    if (end >= 2 && file[end - 2] === 0xff && file[end - 1] === 0xd9) return false;
    const from = Math.min(65536, Math.floor(n / 2));
    for (let i = n - 2; i >= from; i--) if (file[i] === 0xff && file[i + 1] === 0xd9) return false;
    return true;
  }
  if (format === 'png') {
    for (let i = n - 4; i >= Math.max(0, n - 64); i--) if (file[i] === 0x49 && file[i + 1] === 0x45 && file[i + 2] === 0x4e && file[i + 3] === 0x44) return false;
    return true;
  }
  return false;
}

export type Who = { email: string; photoUrl?: string };

/** The account in view, or in a merged view the one this tab signed in with. */
export function profileAccount<A extends Who & { members?: unknown }, V extends Who & { home?: boolean }>(account: A | undefined, inScope: V[]): Who | undefined {
  if (!account?.members) return account;
  return inScope.find((a) => a.home) ?? inScope[0];
}

/** As a share of the picture each way. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole subject in its setting rather than one feature, closer only when it'd be a speck, with a face's eyes about two fifths down. */
export function cropFor(imageAspect: number, boxAspect: number, subject: SubjectBox | undefined): Crop {
  const maxH = Math.min(1, imageAspect / boxAspect);
  const maxW = maxH * (boxAspect / imageAspect);
  if (!subject) return { x: (1 - maxW) / 2, y: (1 - maxH) / 2, width: maxW, height: maxH };
  const height = Math.max(Math.min(maxH, subject.height / 0.2), maxH * 0.7);
  const width = height * (boxAspect / imageAspect);
  const cx = subject.x + subject.width / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), 1 - width);
  // A face's eyes sit about a third of the way down its box.
  const eyes = subject.y + subject.height * 0.35;
  const y = Math.min(Math.max(eyes - height * 0.4, 0), 1 - height);
  return { x: Math.max(0, x), y, width, height };
}

/** For Shuffle colors. */
export function nextColor(colors: string[], seed: string, dynamic: boolean) {
  if (!colors.length) return null;
  const at = dynamic ? colors.indexOf(seed) : -1;
  const next = colors[(at + 1) % colors.length]!;
  return dynamic && next === seed ? null : next;
}

export function fullCrop(aspect: number): Crop {
  return cropFor(aspect, 1, undefined);
}

/** 1 and up. */
export function zoomOf(crop: Crop, aspect: number) {
  return fullCrop(aspect).width / crop.width;
}

export function clampCrop(c: Crop): Crop {
  return { ...c, x: Math.min(Math.max(c.x, 0), 1 - c.width), y: Math.min(Math.max(c.y, 0), 1 - c.height) };
}

/** Keeping the focus point still. */
export function zoomCrop(crop: Crop, aspect: number, zoom: number, focus = { x: 0.5, y: 0.5 }): Crop {
  const base = fullCrop(aspect);
  const z = Math.min(Math.max(zoom, 1), MAX_ZOOM);
  const width = base.width / z;
  const height = base.height / z;
  const fx = crop.x + crop.width * focus.x;
  const fy = crop.y + crop.height * focus.y;
  return clampCrop({ x: fx - width * focus.x, y: fy - height * focus.y, width, height });
}

/** By a share of the crop's own size, as a drag does. */
export function panCrop(crop: Crop, dx: number, dy: number): Crop {
  return clampCrop({ ...crop, x: crop.x - dx * crop.width, y: crop.y - dy * crop.height });
}

/** Anything out of range or the wrong shape is dropped. */
export function validCrop(c: unknown): Crop | null {
  if (!c || typeof c !== 'object') return null;
  const { x, y, width, height } = c as Record<string, unknown>;
  const n = [x, y, width, height];
  if (!n.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const crop = { x, y, width, height } as Crop;
  if (crop.width <= 0 || crop.height <= 0 || crop.width > 1 || crop.height > 1) return null;
  return clampCrop(crop);
}
