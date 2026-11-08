import { describe, expect, it } from 'vitest';
import { nextAfter, repliedSince, stackOrder, type AsideItem } from '../../src/app/features/replylater/store';

const item = (threadId: string, addedAt: number, lastDate = addedAt - 1000): AsideItem => ({
  threadId,
  subject: threadId,
  from: { email: `${threadId}@example.com` },
  snippet: '',
  addedAt,
  lastDate,
});

describe('Reply later stack', () => {
  const items = [item('c', 300), item('a', 100), item('b', 200)];

  it('answers whatever has waited longest first', () => {
    expect(stackOrder(items).map((i) => i.threadId)).toEqual(['a', 'b', 'c']);
  });

  it('moves to the next one, wrapping past the end, and never back to itself', () => {
    expect(nextAfter(items, 'a')?.threadId).toBe('b');
    expect(nextAfter(items, 'c')?.threadId).toBe('a');
    expect(nextAfter([item('a', 1)], 'a')).toBeNull();
    // A merged-inbox id points at the same raw thread.
    expect(nextAfter(items, 'abc1234~b')?.threadId).toBe('c');
    // Not in the stack (opened from elsewhere): start at the top.
    expect(nextAfter(items, 'zzz')?.threadId).toBe('a');
  });

  it('comes off once you reply from anywhere, but not when someone else writes again', () => {
    const me = ['alex@example.com'];
    const set = item('t', 5_000, 4_000);
    expect(repliedSince(set, { lastDate: 6_000, participants: [{ email: 'lena@example.com' }, { email: 'Alex@Example.com' }] }, me)).toBe(true);
    expect(repliedSince(set, { lastDate: 6_000, participants: [{ email: 'alex@example.com' }, { email: 'lena@example.com' }] }, me)).toBe(false);
    // Your last word predates setting it aside: still owed.
    expect(repliedSince(set, { lastDate: 4_000, participants: [{ email: 'alex@example.com' }] }, me)).toBe(false);
  });
});
