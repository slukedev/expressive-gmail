import { QueryClient, QueryObserver, type InfiniteData } from '@tanstack/react-query';
import { BackendError } from '../../src/app/data/backend';
import { BOOT_CACHE_LIMITS, BootCache, pickEntry, shrinkEntry, withEntry, type BootEntry, type BootStore } from '../../src/app/data/bootCache';
import { keys } from '../../src/app/data/client';
import type { Account, Label, ThreadPage, ThreadSummary } from '../../src/app/data/types';
import type { View } from '../../src/app/router/routes';

const NOW = new Date(2026, 9, 8, 9, 0).getTime();
const INBOX: View = { kind: 'folder', folder: 'inbox' };
const Q = 'in:inbox';

function thread(id: string, snippet = 'Hello'): ThreadSummary {
  return {
    id,
    subject: `Subject ${id}`,
    snippet,
    labelIds: ['INBOX'],
    participants: [{ name: 'Ana Lopez', email: 'ana@example.com' }],
    messageCount: 1,
    draftCount: 0,
    lastDate: NOW,
    hasAttachments: false,
    attachments: [],
  };
}

const account = (email: string, photoUrl?: string): Account => ({ email, name: email.split('@')[0]!, index: 0, ...(photoUrl ? { photoUrl } : {}) });
const LABELS: Label[] = [{ id: 'INBOX', name: 'Inbox', type: 'system', unreadCount: 3 }];

function entry(email: string, savedAt = NOW - 60_000, ids = ['t1', 't2']): BootEntry {
  return {
    email,
    savedAt,
    account: { data: account(email, 'https://lh3.googleusercontent.com/a/me=s128'), at: savedAt },
    labels: { data: LABELS, at: savedAt },
    list: { q: Q, view: INBOX, data: { threads: ids.map((id) => thread(id)), nextPageToken: '50~t1' }, at: savedAt },
  };
}

/** A BootCache over an in-memory store, with saves flushed by hand. */
function setup(initial?: BootStore) {
  let stored: unknown = initial;
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  const cache = new BootCache(client, {
    read: async () => stored,
    write: async (s) => void (stored = s),
    remove: async () => void (stored = undefined),
    now: () => NOW,
    saveDelayMs: 0,
    freshTimeoutMs: 1_000,
  });
  return { client, cache, stored: () => stored as BootStore | undefined };
}

const listKey = keys.threads(Q, INBOX);
const listIds = (client: QueryClient) => client.getQueryData<InfiniteData<ThreadPage>>(listKey)?.pages[0]?.threads.map((t) => t.id);
const flush = () => new Promise((r) => setTimeout(r, 5));

describe('boot cache: which entry a reload gets', () => {
  const store = withEntry(withEntry(undefined, 'session', entry('ada@example.com')), 'session', entry('bob@example.com'));

  it("returns only the hinted account's entry, matched case-insensitively", async () => {
    const { cache } = setup(store);
    expect((await cache.load('session', 'Bob@Example.com'))?.email).toBe('bob@example.com');
    expect(await cache.load('session', 'eve@example.com')).toBeUndefined();
    expect(await cache.load('session', undefined)).toBeUndefined();
  });

  it("wipes the store when the backend changed, so demo and session mail never mix", async () => {
    const { cache, stored } = setup(store);
    expect(await cache.load('demo', 'ada@example.com')).toBeUndefined();
    expect(stored()).toBeUndefined();
  });

  it.each([
    ['a week old', NOW - BOOT_CACHE_LIMITS.maxAgeMs - 1],
    ['from the future', NOW + 2 * 60_000],
  ])('ignores an entry %s', (_name, savedAt) => {
    expect(pickEntry(withEntry(undefined, 'session', entry('ada@example.com', savedAt)), 'session', 'ada@example.com', NOW)).toBeUndefined();
  });
});

describe('boot cache: size', () => {
  it('keeps the five most recently used accounts, enough for switching between them', () => {
    let store: BootStore | undefined;
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((name, i) => (store = withEntry(store, 'session', entry(`${name}@example.com`, NOW - (6 - i) * 1000))));
    expect(Object.keys(store!.accounts).sort()).toEqual(['b', 'c', 'd', 'e', 'f'].map((n) => `${n}@example.com`));
  });

  it('keeps at most 50 threads with short snippets, and halves the page until it fits the byte budget', () => {
    const many = entry('ada@example.com', NOW, Array.from({ length: 80 }, (_, i) => `t${i}`));
    many.list!.data.threads = many.list!.data.threads.map((t) => ({ ...t, snippet: 'x'.repeat(5_000) }));
    const small = shrinkEntry(many);
    expect(small.list!.data.threads).toHaveLength(BOOT_CACHE_LIMITS.threads);
    expect(small.list!.data.threads.every((t) => t.snippet.length === BOOT_CACHE_LIMITS.snippet)).toBe(true);

    const huge = entry('ada@example.com', NOW, Array.from({ length: 50 }, (_, i) => `t${i}`));
    huge.list!.data.threads = huge.list!.data.threads.map((t) => ({ ...t, subject: 's'.repeat(20_000) }));
    const fitted = shrinkEntry(huge);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(BOOT_CACHE_LIMITS.bytes);
    expect(fitted.list!.data.threads.length).toBeGreaterThan(0);
    expect(fitted.list!.data.threads[0]!.id).toBe('t0');
  });
});

describe('boot cache: hydrate and revalidate', () => {
  it('shows cached data as stale even inside staleTime, so mounting refetches at once', async () => {
    const { client, cache } = setup();
    cache.hydrate(entry('ada@example.com', NOW - 1_000));
    expect(listIds(client)).toEqual(['t1', 't2']);
    expect(client.getQueryData<Account>(keys.account)?.email).toBe('ada@example.com');

    const listThreads = vi.fn(async (): Promise<ThreadPage> => ({ threads: [thread('t3')] }));
    const observer = new QueryObserver(client, { queryKey: keys.labels, queryFn: async () => LABELS });
    const unsubscribe = observer.subscribe(() => undefined);
    expect(observer.getCurrentResult().isFetching).toBe(true);
    unsubscribe();
    await client.fetchInfiniteQuery({ queryKey: listKey, queryFn: listThreads, initialPageParam: undefined });
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(listIds(client)).toEqual(['t3']);
  });

  it('holds mutations until every cached query has been refreshed or failed', async () => {
    const { client, cache } = setup();
    cache.hydrate(entry('ada@example.com'));
    cache.watch('session', 'ada@example.com');
    // On screen, without fetching yet: the test fetches each by hand below.
    const stops = [keys.account, keys.labels, listKey].map((queryKey) => new QueryObserver(client, { queryKey, enabled: false }).subscribe(() => undefined));
    let fresh = false;
    void cache.untilFresh().then(() => (fresh = true));
    expect(cache.revalidating).toBe(true);

    const labels = client.fetchQuery({ queryKey: keys.labels, queryFn: () => new Promise<Label[]>((r) => setTimeout(() => r(LABELS), 10)) });
    // An optimistic patch while the refresh runs is not fresh data.
    client.setQueryData(keys.labels, LABELS);
    await flush();
    expect(fresh).toBe(false);
    await labels;
    await client.fetchQuery({ queryKey: keys.account, queryFn: async () => account('ada@example.com') });
    await flush();
    expect(fresh).toBe(false);
    await client.fetchInfiniteQuery({ queryKey: listKey, queryFn: async () => Promise.reject(new BackendError('offline', 'network')), initialPageParam: undefined }).catch(() => undefined);
    await flush();
    expect(fresh).toBe(true);
    expect(cache.revalidating).toBe(false);
    stops.forEach((stop) => stop());
  });

  it('a cached inbox nobody is looking at (a reload into Starred) does not hold mutations', async () => {
    const { client, cache } = setup();
    cache.hydrate(entry('ada@example.com'));
    cache.watch('session', 'ada@example.com');
    const shown = [keys.account, keys.labels].map((queryKey) => new QueryObserver(client, { queryKey, queryFn: async () => (queryKey === keys.account ? account('ada@example.com') : LABELS) }));
    const stops = shown.map((o) => o.subscribe(() => undefined));
    expect(cache.revalidating).toBe(true);
    await flush();
    expect(cache.revalidating).toBe(false);
    let fresh = false;
    void cache.untilFresh().then(() => (fresh = true));
    await flush();
    expect(fresh).toBe(true);
    stops.forEach((stop) => stop());
  });

  it('cached data cleared by an account switch does not hold mutations', () => {
    const { client, cache } = setup();
    cache.hydrate(entry('ada@example.com'));
    client.clear();
    expect(cache.revalidating).toBe(false);
  });

  it('saves what the backend confirmed, never cached data played back, and keeps a known photo', async () => {
    const initial = withEntry(undefined, 'session', entry('ada@example.com'));
    const { client, cache, stored } = setup(initial);
    cache.hydrate((await cache.load('session', 'ada@example.com'))!);
    cache.watch('session', 'ada@example.com');
    client.setQueryData(listKey, { pages: [{ threads: [thread('patched')] }], pageParams: [undefined] });
    await flush();
    expect(stored()).toBe(initial);

    // Gmail's header wasn't drawn yet: this read has no photo.
    await client.fetchQuery({ queryKey: keys.account, queryFn: async () => account('ada@example.com') });
    await client.fetchInfiniteQuery({ queryKey: listKey, queryFn: async () => ({ threads: [thread('t9')] }), initialPageParam: undefined, staleTime: 0 });
    await flush();
    const saved = pickEntry(stored(), 'session', 'ada@example.com', NOW)!;
    expect(saved.list?.data.threads.map((t) => t.id)).toEqual(['t9']);
    expect(saved.account?.data.photoUrl).toBe('https://lh3.googleusercontent.com/a/me=s128');
    expect(saved.labels?.data).toEqual(LABELS);
  });
});

describe('boot cache: invalidation', () => {
  it('forgets everything when the backend says the user is signed out', async () => {
    const { client, cache, stored } = setup(withEntry(undefined, 'session', entry('ada@example.com')));
    cache.watch('session', 'ada@example.com');
    await client
      .fetchQuery({ queryKey: keys.account, queryFn: async () => Promise.reject(new BackendError('signed out', 'unauthenticated')) })
      .catch(() => undefined);
    await flush();
    expect(stored()).toBeUndefined();
  });

  it('a sign-in error while the cached list is still on screen stops holding mutations back', async () => {
    const { client, cache } = setup(withEntry(undefined, 'session', entry('ada@example.com')));
    cache.hydrate((await cache.load('session', 'ada@example.com'))!);
    cache.watch('session', 'ada@example.com');
    const stop = new QueryObserver(client, { queryKey: listKey, enabled: false }).subscribe(() => undefined);
    let fresh = false;
    void cache.untilFresh().then(() => (fresh = true));
    await client
      .fetchQuery({ queryKey: keys.account, queryFn: async () => Promise.reject(new BackendError('signed out', 'unauthenticated')) })
      .catch(() => undefined);
    await flush();
    expect(fresh).toBe(true);
    expect(cache.revalidating).toBe(false);
    stop();
  });

  it("takes another account's cached mail off screen when the real account differs from the hint", async () => {
    const { client, cache, stored } = setup(withEntry(undefined, 'session', entry('ada@example.com')));
    cache.hydrate((await cache.load('session', 'ada@example.com'))!);
    cache.watch('session', 'ada@example.com');
    await client.fetchQuery({ queryKey: keys.account, queryFn: async () => account('bob@example.com') });
    await flush();
    expect(listIds(client)).toBeUndefined();
    expect(client.getQueryData(keys.labels)).toBeUndefined();
    expect(stored()).toBeUndefined();
    expect(cache.revalidating).toBe(false);
  });
});
