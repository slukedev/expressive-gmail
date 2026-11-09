import { describe, expect, it } from 'vitest';
import { assignKey, canonicalKey, cleanShortcutKeys, isBindable, keysFor, resetKey, reboundShortcut } from '../../src/app/features/shortcuts/bindings';
import { fromStorage } from '../../src/app/state/settings';

describe('shortcut bindings', () => {
  it("keeps Gmail's keys, aliases included, until something changes", () => {
    expect(canonicalKey('e', {})).toBe('e');
    expect(canonicalKey('y', {})).toBe('e');
    expect(canonicalKey('=', {})).toBe('+');
    expect(canonicalKey('q', {})).toBeNull();
    // Named keys and sequence starters are never remapped.
    expect(canonicalKey('Enter', {})).toBe('Enter');
    expect(canonicalKey('g', {})).toBe('g');
  });

  it('runs an action from its new key, and its old keys and aliases stop doing anything', () => {
    const custom = assignKey({}, 'archive', 'q');
    expect(canonicalKey('q', custom)).toBe('e');
    expect(canonicalKey('e', custom)).toBeNull();
    expect(canonicalKey('y', custom)).toBeNull();
    expect(keysFor('archive', custom)).toEqual(['q']);
  });

  it("takes a key from the action that had it: a default goes quietly, a chosen one becomes no key", () => {
    // s was Star's by default.
    let custom = assignKey({}, 'archive', 's');
    expect(canonicalKey('s', custom)).toBe('e');
    expect(keysFor('star', custom)).toEqual([]);
    // Moving it again leaves Archive with nothing rather than falling back to e silently.
    custom = assignKey(custom, 'mute', 's');
    expect(custom.archive).toBe('');
    expect(keysFor('archive', custom)).toEqual([]);
    expect(canonicalKey('e', custom)).toBeNull();
    expect(canonicalKey('s', custom)).toBe('m');
  });

  it('forgets a choice that is the default again, but keeps one that drops an alias', () => {
    expect(assignKey(assignKey({}, 'star', 'w'), 'star', 's')).toEqual({});
    expect(assignKey({}, 'archive', 'e')).toEqual({ archive: 'e' });
    expect(canonicalKey('y', { archive: 'e' })).toBeNull();
    expect(resetKey({ archive: 'q', star: 'w' }, 'archive')).toEqual({ star: 'w' });
  });

  it('shows hints in the current keys', () => {
    const custom = assignKey(assignKey({}, 'markUnread', 'n'), 'archive', 'U');
    expect(reboundShortcut('Shift U', custom)).toBe('n');
    expect(reboundShortcut('e', custom)).toBe('Shift U');
    expect(reboundShortcut('#', custom)).toBe('#');
    expect(reboundShortcut('Ctrl K', custom)).toBe('Ctrl K');
    expect(reboundShortcut('g r', custom)).toBe('g r');
    expect(reboundShortcut('s', { star: '' })).toBeUndefined();
  });

  it('only binds one visible character that does not start a sequence', () => {
    for (const k of ['q', 'Q', '7', '~', 'é']) expect(isBindable(k)).toBe(true);
    for (const k of ['g', '*', ' ', 'Enter', 'Shift', '']) expect(isBindable(k)).toBe(false);
  });

  it('drops stored keys it cannot use, through settings too', () => {
    expect(cleanShortcutKeys({ archive: 'q', star: '', nope: 'x', mute: 'g', pin: 'Enter', spam: 3 })).toEqual({ archive: 'q', star: '' });
    expect(cleanShortcutKeys(['q'])).toEqual({});
    expect(fromStorage({ shortcutKeys: { archive: 'q', trash: '**' } }).shortcutKeys).toEqual({ archive: 'q' });
    expect(fromStorage({ shortcutKeys: 'q' }).shortcutKeys).toEqual({});
  });
});
