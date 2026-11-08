import { describe, expect, it } from 'vitest';
import { easingFn } from '../../src/app/ui/motion';

describe('easingFn', () => {
  it('follows a positioned linear() spring, overshoot included', () => {
    const f = easingFn('linear(0, 0.5 20%, 1.02 50%, 1)');
    expect(f(0)).toBe(0);
    expect(f(0.1)).toBeCloseTo(0.25);
    expect(f(0.5)).toBeCloseTo(1.02);
    expect(f(0.75)).toBeCloseTo(1.01);
    expect(f(1)).toBe(1);
    expect(f(1.5)).toBe(1);
  });

  it('spreads stops without a position evenly between their neighbours, as CSS does', () => {
    const f = easingFn('linear(0, 0.2, 0.6, 1)');
    expect(f(1 / 3)).toBeCloseTo(0.2);
    expect(f(2 / 3)).toBeCloseTo(0.6);
  });

  it('falls back to straight progress for anything that is not linear()', () => {
    expect(easingFn('ease-out')(0.3)).toBe(0.3);
  });
});
