import { describe, expect, it } from 'vitest';
import { nextUnread } from '../../src/app/features/shortcuts/nextUnread';

describe('nextUnread', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const unread = new Set(['b', 'e']);
  const isUnread = (id: string) => unread.has(id);

  it('finds the nearest unread in either direction, skipping the current one', () => {
    expect(nextUnread(ids, 1, 1, isUnread)).toBe('e');
    expect(nextUnread(ids, 4, -1, isUnread)).toBe('b');
    expect(nextUnread(ids, 2, -1, isUnread)).toBe('b');
  });

  it('starts from the top when nothing is focused, and stops at the ends instead of wrapping', () => {
    expect(nextUnread(ids, -1, 1, isUnread)).toBe('b');
    expect(nextUnread(ids, -1, -1, isUnread)).toBeUndefined();
    expect(nextUnread(ids, 4, 1, isUnread)).toBeUndefined();
    expect(nextUnread(ids, 0, -1, isUnread)).toBeUndefined();
  });
});
