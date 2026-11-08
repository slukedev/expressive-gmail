import { describe, expect, it } from 'vitest';
import { keyLabel } from '../../src/app/ui/keys';

describe('keyLabel', () => {
  it('names the command key on a Mac', () => {
    expect(keyLabel('Ctrl K', true)).toBe('⌘K');
    expect(keyLabel('Ctrl Shift Enter', true)).toBe('⌘⇧Enter');
    expect(keyLabel('⌘⇧8', true)).toBe('⌘⇧8');
  });

  it('names Ctrl on Windows and Linux', () => {
    expect(keyLabel('Ctrl K', false)).toBe('Ctrl K');
    expect(keyLabel('⌘B', false)).toBe('Ctrl+B');
    expect(keyLabel('⌘⇧Z', false)).toBe('Ctrl+Shift+Z');
  });
});
