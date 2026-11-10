import { describe, expect, it } from 'vitest';
import { countTab, unreadBadge } from '../../src/app/features/list/categoryCount';
import type { ThreadPage, ThreadQuery } from '../../src/app/data/types';

/** A search over `n` unread threads that answers at most `cap` per page and reports Gmail's guessed total. */
function search(n: number, { cap = 100, estimate }: { cap?: number; estimate?: number } = {}) {
  const calls: ThreadQuery[] = [];
  const list = async (query: ThreadQuery): Promise<ThreadPage> => {
    calls.push(query);
    const start = Number(query.pageToken ?? 0);
    const size = Math.min(query.pageSize ?? 50, cap);
    const threads = Array.from({ length: Math.max(0, Math.min(size, n - start)) }, (_, i) => ({ id: `t${start + i}` })) as never[];
    const next = start + threads.length;
    return { threads, ...(next < n ? { nextPageToken: String(next) } : {}), ...(estimate === undefined ? {} : { resultSizeEstimate: estimate }) };
  };
  return { list, calls };
}

const badge = async (n: number, opts?: Parameters<typeof search>[1]) => {
  const { threads, more } = await countTab(search(n, opts).list, 'q');
  return unreadBadge(threads.length, more);
};

describe('counting a category tab Gmail sends no count for', () => {
  it("counts the threads, never Gmail's guessed total", async () => {
    // Gmail answered "of many" (201) over six unread updates, and a round 200 over 40.
    expect(await badge(6, { estimate: 201 })).toBe('6');
    expect(await badge(40, { estimate: 200 })).toBe('40');
    expect(await badge(0, { estimate: 3 })).toBe('0');
  });

  it('is exact up to 99 when the backend pages in smaller steps, and asks only for what is left', async () => {
    const { list, calls } = search(73, { cap: 50 });
    const { threads, more } = await countTab(list, 'q');
    expect([threads.length, more]).toEqual([73, false]);
    expect(calls.map((c) => c.pageSize)).toEqual([100, 50]);
    expect(await badge(99, { cap: 50 })).toBe('99');
  });

  it('stops at 100 and reads 99+, however much more there is', async () => {
    const { list, calls } = search(5000, { cap: 50 });
    const { threads, more } = await countTab(list, 'q');
    expect([threads.length, more]).toEqual([100, true]);
    expect(calls).toHaveLength(2);
    expect(unreadBadge(threads.length, more)).toBe('99+');
    expect(await badge(100)).toBe('99+');
  });

  it("doesn't loop on a page that comes back empty with a next token", async () => {
    let calls = 0;
    const { threads } = await countTab(async () => (calls++, { threads: [], nextPageToken: 'again' }), 'q');
    expect([threads.length, calls]).toEqual([0, 1]);
  });
});
