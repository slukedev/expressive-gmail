import { describe, expect, it } from 'vitest';
import { switchLink, switchRequest } from '../../src/shared/switch-link';

describe('switch link', () => {
  it('reads what the Mac app asks for', () => {
    expect(switchRequest(new URL(switchLink(true)).hash, '')).toBe(true);
    expect(switchRequest(new URL(switchLink(false)).hash, '')).toBe(false);
  });

  it('ignores ordinary Gmail links and anything followed from a website', () => {
    expect(switchRequest('#inbox', '')).toBeNull();
    expect(switchRequest('#better-gmail=maybe', '')).toBeNull();
    expect(switchRequest('#better-gmail=off', 'https://example.com/')).toBeNull();
  });
});
