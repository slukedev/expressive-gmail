import { describe, expect, it } from 'vitest';
import { countLabel } from '../../src/app/features/storage/buckets';

describe('countLabel', () => {
  it('counts what is loaded once every page is read', () => {
    expect(countLabel(3, 3, false)).toBe('3');
    expect(countLabel(12, 4, false)).toBe('12');
    expect(countLabel(37, 201, false, true)).toBe('37');
  });

  it('trusts an estimate above the loaded pages', () => {
    expect(countLabel(50, 1234, true)).toBe('1,234');
  });

  it('shows a floor when Gmail stopped counting', () => {
    expect(countLabel(50, 200, true, true)).toBe('200+');
    expect(countLabel(250, 200, true, true)).toBe('250+');
  });

  it('says "+" when more pages exist and nothing better is known', () => {
    expect(countLabel(50, undefined, true)).toBe('50+');
    expect(countLabel(50, 50, true)).toBe('50+');
  });
});
