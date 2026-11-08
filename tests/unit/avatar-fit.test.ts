import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_COPIES, UNREADABLE_RETRY_MS, fitFromPixels, isSilhouette, localCopy } from '../../src/app/ui/avatarFit';

const S = 48;
type RGBA = [number, number, number, number];

function image(paint: (x: number, y: number) => RGBA): Uint8ClampedArray {
  const px = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(paint(x, y), (y * S + x) * 4);
  return px;
}
const inCircle = (x: number, y: number, r: number, cx = S / 2, cy = S / 2) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const inRoundedSquare = (x: number, y: number, lo: number, hi: number, r: number) => {
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const nx = Math.max(lo + r - x, 0, x - (hi - r));
  const ny = Math.max(lo + r - y, 0, y - (hi - r));
  return nx * nx + ny * ny <= r * r;
};
const CLEAR: RGBA = [0, 0, 0, 0];
const WHITE: RGBA = [255, 255, 255, 255];
const GREEN: RGBA = [52, 140, 80, 255];

describe('avatar fit for brand logos', () => {
  it('fills the circle with a full-bleed tile, even when its corners are white (Nextdoor)', () => {
    const tile = image((x, y) => (inRoundedSquare(x, y, 0, S - 1, 10) ? (inCircle(x, y, 9) ? WHITE : GREEN) : WHITE));
    expect(fitFromPixels(tile, true)).toMatchObject({ kind: 'cover' });
  });

  it('scales a tile inside a transparent margin up to fill the circle, in the tile colour', () => {
    const tile = image((x, y) => (inRoundedSquare(x, y, 10, 37, 6) ? (inCircle(x, y, 5) ? WHITE : GREEN) : CLEAR));
    const fit = fitFromPixels(tile, true);
    expect(fit).toMatchObject({ kind: 'tile', bg: 'rgb(52 140 80)' });
    expect((fit as { scale: number }).scale).toBeGreaterThan(1.8);
  });

  it('recognises a round white tile (Google) and fills the circle with white', () => {
    const tile = image((x, y) => (inCircle(x, y, 22) ? (inCircle(x, y, 8) ? [66, 133, 244, 255] : WHITE) : CLEAR));
    expect(fitFromPixels(tile, true)).toMatchObject({ kind: 'tile', bg: 'rgb(255 255 255)' });
  });

  it("puts a transparent dark logo on white and a transparent light logo on dark, at a comfortable size (Kohl's)", () => {
    // A "K": a stem and two arms, 36px tall, on transparency.
    const k = (x: number, y: number) =>
      y >= 6 && y <= 41 && ((x >= 8 && x <= 15) || Math.abs(x - 16 - Math.abs(y - 24)) <= 4);
    const dark = fitFromPixels(image((x, y) => (k(x, y) ? [140, 20, 50, 255] : CLEAR)), true);
    expect(dark).toMatchObject({ kind: 'mark', bg: '#ffffff' });
    expect((dark as { scale: number }).scale).toBeCloseTo(0.62 * (48 / 36), 1);
    expect(fitFromPixels(image((x, y) => (k(x, y) ? [250, 250, 250, 255] : CLEAR)), true)).toMatchObject({ kind: 'mark', bg: '#1f1f1f' });
  });
});

describe('avatar fit for people', () => {
  it('shows a picture someone chose as Google gives it, even a simple two-colour drawing', () => {
    // A drawn letter on a flat ground, the kind of picture the colour-count guess used to take for a placeholder.
    const drawn = image((x, y) => (inCircle(x, y, 8, 24, 18) || (y > 32 && inCircle(x, y, 16, 24, 48)) ? [70, 120, 220, 255] : [168, 199, 250, 255]));
    expect(fitFromPixels(drawn, false)).toEqual({ kind: 'cover', scale: 1, x: 0, y: 0 });
  });
});

describe("Google's generic silhouette", () => {
  const person = (x: number, y: number) => inCircle(x, y, 8, 24, 18) || (y > 32 && inCircle(x, y, 16, 24, 48));

  it.each([
    ['blue (default-user)', [160, 195, 255, 255], [67, 116, 224, 255]],
    ['grey (the older one)', [225, 225, 225, 255], [189, 189, 189, 255]],
  ] as [string, RGBA, RGBA][])('is told apart by its exact colours: %s', (_name, bg, figure) => {
    expect(isSilhouette(image((x, y) => (person(x, y) ? figure : bg)))).toBe(true);
  });

  it('leaves a drawing in similar blues, and an ordinary photo, as photos', () => {
    expect(isSilhouette(image((x, y) => (person(x, y) ? [70, 120, 220, 255] : [168, 199, 250, 255])))).toBe(false);
    expect(isSilhouette(image((x, y) => [(x * 5) % 256, (y * 5) % 256, 120, 255]))).toBe(false);
  });
});

describe('localCopy', () => {
  const image = () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
  let made = 0;
  const revoked: string[] = [];

  beforeEach(() => {
    made = 0;
    revoked.length = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:copy-${++made}`, revokeObjectURL: (u: string) => revoked.push(u) }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it(`keeps at most ${MAX_COPIES} copies, revoking the stalest`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => image()));
    const urls = Array.from({ length: MAX_COPIES + 2 }, (_, i) => `https://lh3.google.com/u/0/cap-${i}`);
    for (const url of urls) await localCopy(url);
    await Promise.resolve();
    expect(revoked).toEqual(['blob:copy-1', 'blob:copy-2']);
    // A copy still kept comes back as is.
    expect(await localCopy(urls.at(-1)!)).toBe(`blob:copy-${MAX_COPIES + 2}`);
  });

  it('tries an unreadable image again after a while, not on every error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let readable = false;
    const fetchMock = vi.fn(async () => {
      if (!readable) throw new TypeError('Failed to fetch');
      return image();
    });
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://lh3.google.com/u/0/retry';
    expect(await localCopy(url)).toBeUndefined();
    readable = true;
    expect(await localCopy(url)).toBeUndefined();
    vi.setSystemTime(Date.now() + UNREADABLE_RETRY_MS);
    expect(await localCopy(url)).toMatch(/^blob:copy-/);
  });
});
