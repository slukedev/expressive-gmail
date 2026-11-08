import { Hct, argbFromHex } from '@material/material-color-utilities';
import { SEED_PRESETS, normalizeHex, randomSeed } from '../../src/app/theme/color';

const hue = (hex: string) => Hct.fromInt(argbFromHex(hex)).hue;
const gap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('random theme colours', () => {
  it('each roll lands well round the wheel from the last, and over many rolls covers all of it', () => {
    let seed = SEED_PRESETS[0]!.seed;
    const sextants = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const next = randomSeed(seed);
      expect(next).toMatch(/^#[0-9a-f]{6}$/);
      // Hue shifts a degree or two once a colour is fitted to the screen's gamut.
      expect(gap(hue(next), hue(seed))).toBeGreaterThan(40);
      sextants.add(Math.floor(hue(next) / 60));
      seed = next;
    }
    expect(sextants.size).toBe(6);
  });

  it('gives up looking for distance rather than spin when the dice keep landing close', () => {
    expect(randomSeed('#0b57d0', () => 0.75)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('colour values', () => {
  it('reads #rgb and #rrggbb in any case, and nothing else', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' 0b57D0 ')).toBe('#0b57d0');
    for (const bad of ['', '#12', '#12345', 'red', '#ggg000', 'url(x)']) expect(normalizeHex(bad)).toBeUndefined();
  });
});
