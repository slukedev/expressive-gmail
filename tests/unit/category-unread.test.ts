import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { countTab, unreadBadge, useCategoryUnread } from '../../src/app/features/list/categoryCount';
import { queryClient, setBackend } from '../../src/app/data/client';
import type { MailBackend } from '../../src/app/data/backend';
import type { ThreadPage, ThreadQuery, ThreadSummary } from '../../src/app/data/types';
import { parseLabels } from '../../src/session/labels';
import { fixture } from '../session/helpers';

const thread = (id: string, labelIds = ['INBOX', 'UNREAD']) => ({ id, labelIds }) as unknown as ThreadSummary;

/** A search over `n` unread threads that answers at most `cap` per page and reports Gmail's guessed total. */
function search(n: number, { cap = 100, estimate }: { cap?: number; estimate?: number } = {}) {
  const calls: ThreadQuery[] = [];
  const list = async (query: ThreadQuery): Promise<ThreadPage> => {
    calls.push(query);
    const start = Number(query.pageToken ?? 0);
    const size = Math.min(query.pageSize ?? 50, cap);
    const threads = Array.from({ length: Math.max(0, Math.min(size, n - start)) }, (_, i) => thread(`t${start + i}`));
    const next = start + threads.length;
    return { threads, ...(next < n ? { nextPageToken: String(next) } : {}), ...(estimate === undefined ? {} : { resultSizeEstimate: estimate }) };
  };
  return { list, calls };
}

const badge = async (n: number, opts?: Parameters<typeof search>[1]) => {
  const { threads, more } = await countTab(search(n, opts).list, 'q');
  return unreadBadge(threads.length, more);
};

describe('counting a category tab', () => {
  it("counts the threads, never Gmail's guessed total", async () => {
    // Gmail answered "of many" (201) over six unread updates, and a round 200 over 40.
    expect(await badge(6, { estimate: 201 })).toBe('6');
    expect(await badge(40, { estimate: 200 })).toBe('40');
    expect(await badge(0, { estimate: 3 })).toBe('0');
  });

  it('is exact below the limit when the backend pages in smaller steps, and asks only for what is left', async () => {
    const { list, calls } = search(43, { cap: 25 });
    const { threads, more } = await countTab(list, 'q');
    expect([threads.length, more]).toEqual([43, false]);
    expect(calls.map((c) => c.pageSize)).toEqual([50, 25]);
    expect(await badge(49)).toBe('49');
    expect(await badge(50)).toBe('50');
  });

  it('stops at the limit with one request and reads as a floor, however much more there is', async () => {
    const { list, calls } = search(5000);
    const { threads, more } = await countTab(list, 'q');
    expect(calls).toHaveLength(1);
    expect(unreadBadge(threads.length, more)).toBe('50+');
  });

  it('counts a thread once when offset pages overlap, and stops on a page with nothing new', async () => {
    // Gmail shifting its offsets as mail moves: every page repeats the last 20 threads of the one before, and the
    // last page repeats itself with a next token forever.
    const real = 30;
    const calls: ThreadQuery[] = [];
    const list = async (query: ThreadQuery): Promise<ThreadPage> => {
      calls.push(query);
      const start = Math.min(Number(query.pageToken ?? 0), real - 10);
      const threads = Array.from({ length: Math.min(25, real - start) }, (_, i) => thread(`t${start + i}`));
      return { threads, nextPageToken: String(start + threads.length - 20), resultSizeEstimate: 201, resultSizeAtLeast: true };
    };
    const { threads, more } = await countTab(list, 'q');
    expect(new Set(threads.map((t) => t.id)).size).toBe(threads.length);
    expect(threads.length).toBeLessThanOrEqual(real);
    expect(calls.length).toBeLessThanOrEqual(3);
    // Never more than the distinct threads it saw, and honest that it stopped short.
    expect(unreadBadge(threads.length, more)).toBe(`${threads.length}+`);
  });

  it("doesn't loop on a page that comes back empty with a next token", async () => {
    let calls = 0;
    const { threads, more } = await countTab(async () => (calls++, { threads: [], nextPageToken: 'again' }), 'q');
    expect([threads.length, more, calls]).toEqual([0, false, 1]);
  });
});

describe('a category badge on a real account', () => {
  // A real /i/s response: Gmail's Promotions inbox tab claims 1,048 unread, its Updates tab sends no unread number.
  const labels = parseLabels(undefined, fixture<unknown[][]>('s-send-response-2022.json')[2]);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);

  afterEach(() => queryClient.clear());

  function mailbox(unread: Record<string, number>) {
    const asked: string[] = [];
    setBackend({
      listThreads: async (query: ThreadQuery): Promise<ThreadPage> => {
        asked.push(query.q ?? '');
        const category = /category:(\w+)/.exec(query.q ?? '')![1]!;
        return { threads: Array.from({ length: unread[category] ?? 0 }, (_, i) => thread(`${category}${i}`)), resultSizeEstimate: 201, resultSizeAtLeast: true };
      },
    } as unknown as MailBackend);
    return asked;
  }

  it("shows the unread mail the tab lists, not Gmail's own tab count", async () => {
    mailbox({ promotions: 30 });
    const { result } = renderHook(() => useCategoryUnread('promotions', labels, true), { wrapper });
    await waitFor(() => expect(result.current.count).toBeDefined());
    expect(result.current).toMatchObject({ count: 30, more: false });
    expect(unreadBadge(result.current.count!, result.current.more)).toBe('30');
  });

  it('counts a tab Gmail sends no unread number for the same way', async () => {
    mailbox({ updates: 7 });
    const { result } = renderHook(() => useCategoryUnread('updates', labels, true), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(7));
  });

  it('asks nothing while the visible list loads, or when the category has no unread mail at all', async () => {
    const asked = mailbox({ promotions: 30, social: 0 });
    const waiting = renderHook(() => useCategoryUnread('promotions', labels, false), { wrapper });
    const empty = renderHook(() => useCategoryUnread('social', labels, true), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual([]);
    expect(waiting.result.current.count).toBeUndefined();
    expect(empty.result.current.count).toBe(0);
  });
});
