import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailApiBackend } from '../../src/app/data/api/gmail-backend';
import { MAX_TRIES } from '../../src/app/data/api/http';
import { memoryStore } from '../../src/app/data/api/storage';
import { keys } from '../../src/app/data/client';
import { startSync, type SyncEnv } from '../../src/app/data/sync';
import type { MailBackend } from '../../src/app/data/backend';
import { fakeFetch, json } from './fake-fetch';

/**
 * The request budget on the real Gmail API backend over a fake fetch, inbox and counts on screen, sync at 20 s:
 * idle visible: one history.list per 20 s (+1 profile read); hidden: nothing; back after an hour: one catch-up poll;
 * one new message: the poll, the list page, label counts; rate limited: backs off from a one minute floor.
 */
const INTERVAL = 20_000;
const MINUTE = 60_000;

function world() {
  const net = fakeFetch();
  let history: unknown[] = [];
  let historyId = 100;
  let historyStatus = 200;
  net
    .on('GET', /\/profile$/, () => json({ emailAddress: 'me@example.com', historyId: String(historyId) }))
    .on('GET', /\/history\?/, () => {
      if (historyStatus !== 200) return json({ error: { code: historyStatus, message: 'nope' } }, historyStatus);
      const out = history;
      history = [];
      return json({ history: out, historyId: String(historyId) });
    })
    .on('GET', /\/labels$/, () => json({ labels: [] }))
    .on('GET', /\/threads\?/, () => json({ threads: [], resultSizeEstimate: 0 }));
  const backend = new GmailApiBackend(async () => 'token', {
    fetchImpl: net.fetchImpl,
    storage: memoryStore(),
    sleep: async () => undefined,
    random: () => 0.5,
  }) as MailBackend;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 2 * MINUTE, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
  const observers = [
    new QueryObserver(client, { queryKey: keys.threads('in:inbox', { kind: 'folder', folder: 'inbox' }), queryFn: () => backend.listThreads({ q: 'in:inbox' }) }),
    new QueryObserver(client, { queryKey: keys.labels, queryFn: () => backend.listLabels() }),
  ];
  const unsubs = observers.map((o) => o.subscribe(() => undefined));

  let visible = true;
  const wakers = new Set<(r: 'visible' | 'online') => void>();
  const env: SyncEnv = {
    now: () => Date.now(),
    visible: () => visible,
    online: () => true,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    random: () => 0.5,
    onWake: (fn) => (wakers.add(fn), () => wakers.delete(fn)),
  };
  const loop = startSync(() => backend, client, INTERVAL, env);

  return {
    net,
    loop,
    count: (re?: RegExp) => net.calls.filter((c) => !re || re.test(c.url)).length,
    reset: () => net.calls.splice(0),
    newMail() {
      historyId++;
      history = [{ id: String(historyId), messagesAdded: [{ message: { id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] } }] }];
    },
    failWith: (status: number) => (historyStatus = status),
    setVisible(v: boolean) {
      visible = v;
      if (v) wakers.forEach((w) => w('visible'));
    },
    stop() {
      loop.stop();
      unsubs.forEach((u) => u());
      client.clear();
    },
  };
}

async function pass(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('request budget', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('idles at one change poll per 20 seconds while visible', async () => {
    const w = world();
    await pass(1_000);
    w.reset(); // the first list and label reads
    await pass(5 * MINUTE);
    // Jitter is fixed at the midpoint, so exactly one poll per interval.
    expect(w.count()).toBeLessThanOrEqual(16);
    expect(w.count(/\/history\?/) + w.count(/\/profile$/)).toBe(w.count());
    w.stop();
  });

  it('asks for nothing while hidden, then catches up once', async () => {
    const w = world();
    await pass(2 * INTERVAL); // polling has started from a known history id
    w.setVisible(false);
    await pass(INTERVAL); // a poll already scheduled may still find the tab hidden
    w.reset();
    await pass(60 * MINUTE);
    expect(w.count()).toBe(0);
    w.newMail();
    w.setVisible(true);
    await pass(1_000);
    expect(w.count(/\/history\?/)).toBe(1);
    // New mail: the list on screen and the counts, once each.
    expect(w.count(/\/threads\?/)).toBe(1);
    expect(w.count(/\/labels$/)).toBe(1);
    w.stop();
  });

  it('shows new mail within one interval for the cost of one list read and one label read', async () => {
    const w = world();
    await pass(2 * INTERVAL);
    w.reset();
    w.newMail();
    await pass(INTERVAL + 1_000);
    expect(w.count(/\/history\?/)).toBe(1);
    expect(w.count(/\/threads\?/)).toBe(1);
    expect(w.count(/\/labels$/)).toBe(1);
    expect(w.count()).toBe(3);
    w.stop();
  });

  it('backs off while Gmail fails, and rate limits slow it down for at least a minute', async () => {
    const w = world();
    await pass(2 * INTERVAL);
    w.failWith(429);
    w.reset();
    await pass(10 * MINUTE);
    // 30 polls at the normal pace; backing off from a one-minute floor leaves a handful
    // (each of them tried MAX_TRIES times by the API client, which honors Retry-After).
    expect(w.count(/\/history\?/) / MAX_TRIES).toBeLessThanOrEqual(5);
    w.stop();
  });
});

describe('sync loop', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('keeps going after a poll that never answers', async () => {
    let calls = 0;
    const backend = { pollChanges: () => (++calls === 1 ? new Promise(() => undefined) : Promise.resolve([])) } as unknown as MailBackend;
    const env: SyncEnv = {
      now: () => Date.now(),
      visible: () => true,
      online: () => true,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      random: () => 0.5,
      onWake: () => () => undefined,
    };
    const loop = startSync(() => backend, new QueryClient(), INTERVAL, env);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(calls).toBeGreaterThan(1);
    loop.stop();
  });
});
