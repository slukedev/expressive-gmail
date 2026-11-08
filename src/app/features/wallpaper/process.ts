import { hasAlpha, type SaliencyMap } from './analyze';
import { analyzeOffThread } from './run-analysis';
import { checkFile, encodeOrder, formatOf, looksTruncated, MAX_PIXELS, sizePlan, type Format } from './plan';
import type { StoredPicture } from './store';

/** Worded for the person who picked it. */
export class PictureError extends Error {}

const MESSAGES = {
  'too-big': 'That file is over 50 MB. Choose a smaller picture.',
  'not-picture': "That file isn't a picture. Choose a JPEG, PNG, WebP or GIF.",
  heic: "This browser can't open HEIC photos. Save it as a JPEG and try again.",
  avif: "This browser can't open AVIF pictures. Save it as a JPEG or PNG and try again.",
  svg: "This SVG can't be used as a background. Try a PNG or JPEG.",
  broken: "This picture couldn't be opened. The file may be damaged.",
  huge: 'This picture is too large to open here. Try one under 100 megapixels.',
} as const;

const fail = (key: keyof typeof MESSAGES) => new PictureError(MESSAGES[key]);

function canvas(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw fail('broken');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/** Through an <img>: browsers apply EXIF orientation, convert CMYK JPEGs, draw a GIF's first frame, and open SVG as an inert picture that only reaches us as pixels. */
async function decode(file: File, format: Format): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw fail(format === 'heic' ? 'heic' : format === 'avif' ? 'avif' : format === 'svg' ? 'svg' : 'broken');
  } finally {
    URL.revokeObjectURL(url);
  }
  return img;
}

/** Halving or doubling steps: one big jump aliases down and blocks up. */
function resample(src: CanvasImageSource, sw: number, sh: number, dw: number, dh: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let w = sw;
  let h = sh;
  let out: HTMLCanvasElement | null = null;
  while (w !== dw || h !== dh) {
    const nw = dw > w ? Math.min(dw, w * 2) : Math.max(dw, Math.round(w / 2));
    const nh = dh > h ? Math.min(dh, h * 2) : Math.max(dh, Math.round(h / 2));
    const { c, ctx } = canvas(nw, nh);
    ctx.drawImage(cur, 0, 0, w, h, 0, 0, nw, nh);
    cur = out = c;
    w = nw;
    h = nh;
  }
  if (out) return out;
  const { c, ctx } = canvas(dw, dh);
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh);
  return c;
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

function pixelsOf(c: HTMLCanvasElement, format: Format) {
  try {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    return { width: c.width, height: c.height, data };
  } catch {
    // A tainted canvas: some browsers refuse to read back an SVG.
    throw fail(format === 'svg' ? 'svg' : 'broken');
  }
}

async function encode(out: HTMLCanvasElement, format: Format): Promise<Blob> {
  const alpha = hasAlpha(pixelsOf(out, format));
  for (const { type, quality } of encodeOrder(alpha)) {
    const b = await toBlob(out, type, quality);
    // Safari hands back a PNG when asked for WebP.
    if (b && b.type === type) return b;
  }
  throw fail('broken');
}

/** Older, larger pictures come back shrunk under the same id. Null when there's nothing to gain. */
export async function shrinkPicture(p: StoredPicture): Promise<StoredPicture | null> {
  const plan = sizePlan(p.width, p.height);
  if (plan.width >= p.width) return null;
  const img = await decode(new File([p.bytes], 'picture', { type: p.type }), 'other');
  const out = resample(img, img.naturalWidth, img.naturalHeight, plan.width, plan.height);
  const blob = await encode(out, 'other');
  if (blob.size >= p.bytes.byteLength) return null;
  return { ...p, bytes: await blob.arrayBuffer(), type: blob.type, width: plan.width, height: plan.height };
}

/** Throws a PictureError with words for the person. */
export async function processPicture(file: File): Promise<StoredPicture> {
  const problem = checkFile(file);
  if (problem) throw fail(problem);
  const format = formatOf(file);
  if ((format === 'jpeg' || format === 'png') && looksTruncated(format, new Uint8Array(await file.arrayBuffer()))) throw fail('broken');
  const img = await decode(file, format);
  // An SVG without its own size reports 0 (or 300 x 150).
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (format === 'svg' && (!w || !h || (w === 300 && h === 150))) {
    w = 1600;
    h = 1000;
  }
  if (!w || !h) throw fail('broken');
  if (w * h > MAX_PIXELS) throw fail('huge');

  const plan = sizePlan(w, h);
  const out = resample(img, img.naturalWidth || w, img.naturalHeight || h, plan.width, plan.height);
  const blob = await encode(out, format);

  // Analysed from what's stored, as it will be seen.
  const shown = await decode(new File([blob], 'picture', { type: blob.type }), 'other');
  const { c: back, ctx } = canvas(plan.width, plan.height);
  ctx.drawImage(shown, 0, 0, plan.width, plan.height);
  const analysis = await analyzeOffThread(pixelsOf(back, format));

  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    bytes: await blob.arrayBuffer(),
    type: blob.type,
    width: plan.width,
    height: plan.height,
    saliency: await withFaces(shown, analysis.saliency),
    colors: analysis.colors,
    name: file.name,
  };
}

interface DetectedFace {
  boundingBox: DOMRectReadOnly;
}
type FaceDetectorCtor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => { detect(source: CanvasImageSource): Promise<DetectedFace[]> };

/** Faces outrank everything. Where the Shape Detection API exists (Chrome with it on, some Android) they set the subject; elsewhere saliency stands alone. */
async function withFaces(img: HTMLImageElement, map: SaliencyMap): Promise<SaliencyMap> {
  const Detector = (globalThis as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
  if (!Detector) return map;
  try {
    const faces = await new Detector({ fastMode: true, maxDetectedFaces: 8 }).detect(img);
    if (!faces.length) return map;
    const data = map.data.map((v) => v >> 1);
    const sx = map.width / img.naturalWidth;
    const sy = map.height / img.naturalHeight;
    for (const { boundingBox: b } of faces) {
      // The face and a little around it count as the subject.
      const x0 = Math.max(0, Math.floor((b.x - b.width * 0.3) * sx));
      const y0 = Math.max(0, Math.floor((b.y - b.height * 0.3) * sy));
      const x1 = Math.min(map.width, Math.ceil((b.x + b.width * 1.3) * sx));
      const y1 = Math.min(map.height, Math.ceil((b.y + b.height * 1.6) * sy));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * map.width + x] = 255;
    }
    return { ...map, data };
  } catch {
    return map;
  }
}

