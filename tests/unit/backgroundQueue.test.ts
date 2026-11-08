import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundQueue } from '../../src/app/data/backgroundQueue';
import type { MailBackend } from '../../src/app/data/backend';

function setup() {
  const asked: string[] = [];
  let visible = true;
  const backend = {
    listThreads: vi.fn(async ({ q }: { q: string }) => {
      asked.push(q);
      return { threads: [{ id: `t-${q}` }] };
    }),
  } as unknown as MailBackend;
  const queue = createBackgroundQueue({
    now: () => Date.now(),
    visible: () => visible,
    idle: (fn) => setTimeout(fn, 0),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    backend: () => backend,
  });
  return { queue, asked, hide: () => (visible = false), show: () => (visible = true) };
}

describe('backgroundSearch', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('runs three at once, then one every 20 seconds', async () => {
    const { queue, asked } = setup();
    const all = ['a', 'b', 'c', 'd', 'e'].map((q) => queue.search(q));
    await vi.advanceTimersByTimeAsync(100);
    expect(asked).toEqual(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(asked).toEqual(['a', 'b', 'c', 'd']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(asked).toHaveLength(5);
    expect((await Promise.all(all)).map((t) => t[0]!.id)).toEqual(['t-a', 't-b', 't-c', 't-d', 't-e']);
  });

  it('shares one request for the same query and answers repeats from cache', async () => {
    const { queue, asked } = setup();
    const [x, y] = [queue.search('tracking 1Z999'), queue.search(' tracking 1Z999 ')];
    await vi.advanceTimersByTimeAsync(100);
    expect(await x).toBe(await y);
    await queue.search('tracking 1Z999');
    expect(asked).toEqual(['tracking 1Z999']);
    // Past maxAge it asks again.
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const again = queue.search('tracking 1Z999');
    await vi.advanceTimersByTimeAsync(100);
    await again;
    expect(asked).toHaveLength(2);
  });

  it('waits while the tab is hidden', async () => {
    const { queue, asked, hide, show } = setup();
    hide();
    const p = queue.search('q');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(asked).toEqual([]);
    show();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(asked).toEqual(['q']);
    await p;
  });

  it('drops a queued search when its only caller aborts', async () => {
    const { queue, asked } = setup();
    ['a', 'b', 'c'].forEach((q) => void queue.search(q));
    const ctl = new AbortController();
    const p = queue.search('d', { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual(['a', 'b', 'c']);
  });
});
