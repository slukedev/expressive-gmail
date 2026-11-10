import { describe, expect, it } from 'vitest';
import { peekCount, unreadBadge } from '../../src/app/features/list/categoryCount';

const threads = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) })) as never[];

describe('category unread count', () => {
  it('counts the threads when they all fit, whatever Gmail says the total is', () => {
    // Gmail's "of many" (201) on a short unread search showed "200+ unread" over six threads.
    const c = peekCount({ threads: threads(6), resultSizeEstimate: 201 });
    expect(c).toEqual({ count: 6, more: false });
    expect(unreadBadge(c.count, c.more)).toBe('6');
  });

  it('shows a floor, not 200+, when the page is full and Gmail stopped counting', () => {
    const c = peekCount({ threads: threads(10), nextPageToken: 't', resultSizeEstimate: 200, resultSizeAtLeast: true });
    expect(c).toEqual({ count: 10, more: true });
    expect(unreadBadge(c.count, c.more)).toBe('10+');
  });

  it('uses a real total above the page', () => {
    expect(peekCount({ threads: threads(10), nextPageToken: 't', resultSizeEstimate: 1234 })).toEqual({ count: 1234, more: false });
    expect(peekCount({ threads: threads(10), nextPageToken: 't' })).toEqual({ count: 10, more: true });
  });
});
