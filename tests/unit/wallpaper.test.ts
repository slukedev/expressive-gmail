import 'fake-indexeddb/auto';
import { Hct, argbFromHex } from '@material/material-color-utilities';
import { describe, expect, it } from 'vitest';
import { saliencyMap, seedColors, type Pixels } from '../../src/app/features/wallpaper/analyze';
import { checkFile, cropFor, fullCrop, looksTruncated, MAX_ZOOM, nextColor, panCrop, profileAccount, sizePlan, validCrop, zoomCrop, zoomOf } from '../../src/app/features/wallpaper/plan';
import { deletePicture, loadPicture, savePicture, type StoredPicture } from '../../src/app/features/wallpaper/store';

/** A bitmap from a per-pixel colour function. */
function bitmap(width: number, height: number, at: (x: number, y: number) => [number, number, number, number?]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = at(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  return { width, height, data };
}

const hueOf = (hex: string) => Hct.fromInt(argbFromHex(hex)).hue;
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('seedColors', () => {
  it('ranks the dominant colourful hue first and offers the others after it', () => {
    // 70% teal, 30% orange, like a seascape at sunset.
    const seeds = seedColors(bitmap(100, 100, (x) => (x < 70 ? [0, 128, 128] : [230, 120, 20])));
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    expect(hueGap(hueOf(seeds[0]!), hueOf('#008080'))).toBeLessThan(15);
    expect(seeds.slice(1).some((s) => hueGap(hueOf(s), hueOf('#e67814')) < 15)).toBe(true);
  });

  it('puts a colour ahead of the near-grey a photo is mostly made of', () => {
    // A beige wall filling 85% of the frame, a teal coat in the rest.
    const seeds = seedColors(bitmap(100, 100, (x) => (x < 85 ? [181, 168, 152] : [0, 128, 128])));
    expect(hueGap(hueOf(seeds[0]!), hueOf('#008080'))).toBeLessThan(15);
  });

  it('is deterministic for the same pixels', () => {
    const pic = bitmap(90, 60, (x, y) => [(x * 7) % 256, (y * 11) % 256, ((x + y) * 5) % 256]);
    expect(seedColors(pic)).toEqual(seedColors(pic));
  });

  it('offers nothing for a grayscale picture, so the theme falls back instead of going muddy', () => {
    expect(seedColors(bitmap(80, 50, (x, y) => [(x * 3 + y) % 256, (x * 3 + y) % 256, (x * 3 + y) % 256]))).toEqual([]);
  });

  it('ignores pixels you can barely see', () => {
    // Fully transparent red with one opaque blue block: the seed is blue, not red.
    const seeds = seedColors(bitmap(60, 60, (x, y) => (x < 20 && y < 20 ? [26, 115, 232, 255] : [255, 0, 0, 10])));
    expect(hueGap(hueOf(seeds[0]!), hueOf('#1a73e8'))).toBeLessThan(15);
    expect(seedColors(bitmap(20, 20, () => [255, 0, 0, 0]))).toEqual([]);
  });
});

describe('upload decisions', () => {
  it.each([
    ['a big phone photo shrinks to 1024 on its long edge', 8000, 6000, { width: 1024, height: 768, soft: false }],
    ['a screenshot shrinks the same way', 1920, 1080, { width: 1024, height: 576, soft: false }],
    ['a small photo is kept as it is', 640, 480, { width: 640, height: 480, soft: false }],
    ['a panorama keeps enough height for a square cut from it', 12000, 1200, { width: 4096, height: 410, soft: false }],
    ['a tall strip keeps its width the same way', 600, 6000, { width: 410, height: 4096, soft: false }],
    ['a 16 px icon is enlarged smoothly instead of shown as blocks', 16, 16, { width: 512, height: 512, soft: true }],
  ])('%s', (_, w, h, plan) => {
    expect(sizePlan(w, h)).toEqual(plan);
  });

  it.each([
    [{ name: 'IMG_0001.HEIC', type: '', size: 2e6 }, null],
    [{ name: 'photo.jpg', type: 'image/jpeg', size: 51 * 1024 * 1024 }, 'too-big'],
    [{ name: 'notes.txt', type: 'text/plain', size: 10 }, 'not-picture'],
    [{ name: 'shape.svg', type: 'image/svg+xml', size: 300 }, null],
  ])('checks %o before decoding', (file, problem) => {
    expect(checkFile(file)).toBe(problem);
  });
});

describe('looksTruncated', () => {
  const file = (size: number, at: Record<number, number[]> = {}) => {
    const b = new Uint8Array(size).fill(0x5a);
    for (const [i, bytes] of Object.entries(at)) b.set(bytes, Number(i) < 0 ? size + Number(i) : Number(i));
    return b;
  };
  it.each([
    ['a complete JPEG', 'jpeg', file(4000, { [-2]: [0xff, 0xd9] }), false],
    ['a JPEG with padding after its end marker', 'jpeg', file(4000, { [-5]: [0xff, 0xd9, 0, 0, 0x0a] }), false],
    // Pixel and Samsung motion photos: the JPEG ends, then an MP4 follows.
    ['a motion photo with a clip after the picture', 'jpeg', file(400_000, { 1200: [0xff, 0xd9], 250_000: [0xff, 0xd9] }), false],
    // Cut off mid-scan; only the EXIF thumbnail's end marker survives, near the start.
    ['a JPEG cut off mid-scan', 'jpeg', file(300_000, { 1200: [0xff, 0xd9] }), true],
    ['a complete PNG', 'png', file(500, { [-12]: [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] }), false],
    ['a PNG cut off before IEND', 'png', file(500), true],
    ['a GIF, which this does not judge', 'gif', file(10), false],
  ] as const)('%s', (_, format, bytes, truncated) => {
    expect(looksTruncated(format, bytes)).toBe(truncated);
  });
});

describe('picture storage', () => {
  const picture = (id: string): StoredPicture => ({
    id,
    bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    type: 'image/webp',
    width: 2560,
    height: 1440,
    colors: ['#006a6a'],
    name: 'beach.jpg',
  });

  it('keeps one picture, replaces it on a new upload, and forgets it when deleted', async () => {
    expect(await loadPicture()).toBeUndefined();
    await savePicture(picture('a'));
    const first = await loadPicture();
    expect(first?.id).toBe('a');
    expect([...new Uint8Array(first!.bytes)]).toEqual([1, 2, 3, 4]);

    await savePicture(picture('b'));
    expect((await loadPicture())?.id).toBe('b');

    await deletePicture();
    expect(await loadPicture()).toBeUndefined();
  });
});

describe('subject', () => {
  it('finds a face as a compact patch of skin, not the whole warm background', () => {
    // A grey wall with a skin-toned oval where a face would be.
    const pic = bitmap(300, 400, (x, y) => (Math.hypot((x - 180) / 40, (y - 120) / 52) < 1 ? [224, 172, 140] : [90, 92, 96]));
    const s = saliencyMap(pic).subject!;
    expect(s.face).toBe(true);
    expect(s.x * 300).toBeGreaterThan(130);
    expect((s.x + s.width) * 300).toBeLessThan(230);
    expect(s.y * 400).toBeGreaterThan(55);
    expect(s.y * 400).toBeLessThan(90);
  });
});

describe('cropFor (At a glance)', () => {
  const face = { x: 0.4, y: 0.25, width: 0.2, height: 0.25, face: true };

  it('shows the subject in its setting, never one feature filling the shape', () => {
    // A 3:2 photo in the square cookie: the full height shows.
    const c = cropFor(1.5, 1, face);
    expect(c.height).toBeGreaterThan(0.69);
    expect(c.x).toBeLessThanOrEqual(face.x);
    expect(c.x + c.width).toBeGreaterThanOrEqual(face.x + face.width);
  });

  it('keeps the whole face of a phone portrait, eyes in the upper half', () => {
    const c = cropFor(0.75, 1, face);
    const eyes = face.y + face.height * 0.35;
    expect((eyes - c.y) / c.height).toBeGreaterThan(0.25);
    expect((eyes - c.y) / c.height).toBeLessThan(0.5);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y + c.height).toBeLessThanOrEqual(1);
  });

  it('centres a picture with no subject', () => {
    expect(cropFor(2, 1, undefined)).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
  });
});

describe('nextColor (Shuffle colors)', () => {
  const colors = ['#aa0000', '#00aa00', '#0000aa'];
  it('steps through the picture\'s colours and wraps', () => {
    expect(nextColor(colors, '#aa0000', true)).toBe('#00aa00');
    expect(nextColor(colors, '#0000aa', true)).toBe('#aa0000');
  });
  it('starts from its first colour when the theme is not from it', () => {
    expect(nextColor(colors, '#123456', false)).toBe('#aa0000');
  });
  it('offers nothing when the only colour is already in use', () => {
    expect(nextColor(['#aa0000'], '#aa0000', true)).toBeNull();
    expect(nextColor([], '#aa0000', true)).toBeNull();
  });
});

describe('profileAccount (At a glance default photo)', () => {
  const home = { email: 'alex@example.com', photoUrl: 'a', home: true };
  const work = { email: 'alex@work.example.com', photoUrl: 'b' };
  it('is the account in view', () => {
    expect(profileAccount({ email: 'alex@example.com', photoUrl: 'a' }, [home])?.photoUrl).toBe('a');
  });
  it('in All inboxes or a circle, is the account this tab signed in with', () => {
    expect(profileAccount({ email: 'all', members: [] }, [work, home])?.email).toBe('alex@example.com');
  });
  it('in a circle without that account, is its first', () => {
    expect(profileAccount({ email: 'circle', members: [] }, [work])?.email).toBe('alex@work.example.com');
  });
});

describe('cropping the picture', () => {
  const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

  it('starts from the biggest centred square', () => {
    expect(fullCrop(4 / 3)).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
    expect(fullCrop(3 / 4)).toEqual({ x: 0, y: 0.125, width: 1, height: 0.75 });
  });

  it('zooms around the middle and stops at the edges of the zoom range', () => {
    const z2 = zoomCrop(fullCrop(1), 1, 2);
    expect(z2).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    close(zoomOf(z2, 1), 2);
    close(zoomOf(zoomCrop(z2, 1, 99), 1), MAX_ZOOM);
    expect(zoomCrop(z2, 1, 0.1)).toEqual(fullCrop(1));
  });

  it('keeps the point under the pointer still while zooming', () => {
    const start = zoomCrop(fullCrop(1), 1, 2);
    const next = zoomCrop(start, 1, 4, { x: 0.25, y: 0.75 });
    close(start.x + start.width * 0.25, next.x + next.width * 0.25);
    close(start.y + start.height * 0.75, next.y + next.height * 0.75);
  });

  it('drags the picture, never past its edges', () => {
    const z2 = zoomCrop(fullCrop(1), 1, 2);
    expect(panCrop(z2, 0.5, 0)).toEqual({ ...z2, x: 0 });
    expect(panCrop(z2, -10, -10)).toEqual({ ...z2, x: 0.5, y: 0.5 });
    expect(panCrop(fullCrop(4 / 3), 1, 0).x).toBe(0);
  });

  it('drops a stored crop that does not make sense', () => {
    expect(validCrop({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(validCrop({ x: 0.9, y: 0, width: 0.5, height: 0.5 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
    expect(validCrop({ x: 0, y: 0, width: 2, height: 0.5 })).toBeNull();
    expect(validCrop({ x: 'a', y: 0, width: 0.5, height: 0.5 })).toBeNull();
    expect(validCrop(null)).toBeNull();
  });
});
