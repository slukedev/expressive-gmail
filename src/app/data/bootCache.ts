import type { InfiniteData, QueryCacheNotifyEvent, QueryClient } from '@tanstack/react-query';
import type { View } from '../router/routes';
import { readKey, removeKey, writeKey } from '../state/storage';
import type { BackendKind } from './backend';
import { BOOT_CACHE_KEY } from './cacheKeys';
import { keys, queryClient } from './client';
import type { Account, Label, ThreadPage, ThreadSummary } from './types';

/** The last-seen inbox, so a reload paints mail before Gmail's session is ready. Per account and backend, small (first inbox page, labels, account), shown stale while refreshing, and dropped on sign-out, a backend change, or an account that turns out to differ. */

const DAY = 24 * 60 * 60_000;

export const BOOT_CACHE_LIMITS = {
  accounts: 5,
  threads: 50,
  snippet: 200,
  participants: 6,
  maxAgeMs: 7 * DAY,
  bytes: 256 * 1024,
};

interface Stamped<T> {
  data: T;
  /** When the backend last confirmed this, epoch ms. */
  at: number;
}

interface CachedList extends Stamped<ThreadPage> {
  q: string;
  view: View;
}

export interface BootEntry {
  email: string;
  savedAt: number;
  account?: Stamped<Account>;
  labels?: Stamped<Label[]>;
  list?: CachedList;
}

export interface BootStore {
  v: 1;
  backend: BackendKind;
  accounts: Record<string, BootEntry>;
}

const norm = (email: string) => email.trim().toLowerCase();

function isStore(value: unknown): value is BootStore {
  const s = value as BootStore | null | undefined;
  return !!s && s.v === 1 && typeof s.backend === 'string' && !!s.accounts && typeof s.accounts === 'object';
}

/** Unless it is missing, too old or from the future. */
export function pickEntry(store: unknown, backend: BackendKind, email: string, now: number): BootEntry | undefined {
  if (!isStore(store) || store.backend !== backend) return undefined;
  const entry = store.accounts[norm(email)];
  if (!entry || norm(entry.email) !== norm(email)) return undefined;
  if (now - entry.savedAt > BOOT_CACHE_LIMITS.maxAgeMs || entry.savedAt > now + 60_000) return undefined;
  return entry;
}

/** Drops other backends' data and the least recent accounts. */
export function withEntry(store: unknown, backend: BackendKind, entry: BootEntry): BootStore {
  const kept = isStore(store) && store.backend === backend ? { ...store.accounts } : {};
  kept[norm(entry.email)] = shrinkEntry(entry);
  const recent = Object.entries(kept)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, BOOT_CACHE_LIMITS.accounts);
  return { v: 1, backend, accounts: Object.fromEntries(recent) };
}

function shrinkThread(t: ThreadSummary): ThreadSummary {
  const out: ThreadSummary = {
    ...t,
    snippet: t.snippet.length > BOOT_CACHE_LIMITS.snippet ? t.snippet.slice(0, BOOT_CACHE_LIMITS.snippet) : t.snippet,
    participants: t.participants.slice(-BOOT_CACHE_LIMITS.participants),
  };
  if (t.recipients) out.recipients = t.recipients.slice(0, BOOT_CACHE_LIMITS.participants);
  return out;
}

/** Caps threads, snippets and participants, then halves the page until it fits the byte budget. */
export function shrinkEntry(entry: BootEntry): BootEntry {
  if (!entry.list) return entry;
  let threads = entry.list.data.threads.slice(0, BOOT_CACHE_LIMITS.threads).map(shrinkThread);
  const build = (): BootEntry => ({ ...entry, list: { ...entry.list!, data: { ...entry.list!.data, threads } } });
  let out = build();
  while (threads.length > 1 && JSON.stringify(out).length > BOOT_CACHE_LIMITS.bytes) {
    threads = threads.slice(0, Math.floor(threads.length / 2));
    out = build();
  }
  if (JSON.stringify(out).length > BOOT_CACHE_LIMITS.bytes) {
    const { list: _list, ...rest } = out;
    void _list;
    return rest;
  }
  return out;
}

/** A read without a photo never replaces one a previous read found. */
export function keepPhoto(prev: Account | undefined, next: Account): Account {
  if (next.photoUrl || !prev?.photoUrl || norm(prev.email) !== norm(next.email)) return next;
  return { ...next, photoUrl: prev.photoUrl };
}

function isHomeView(view: View | undefined): boolean {
  return (view?.kind === 'folder' && view.folder === 'inbox') || (view?.kind === 'category' && view.category === 'primary');
}

type Part = 'account' | 'labels' | 'list';

function partOf(key: readonly unknown[]): Part | undefined {
  if (key[0] === keys.account[0] && key.length === 1) return 'account';
  if (key[0] === keys.labels[0] && key.length === 1) return 'labels';
  if (key[0] === keys.allThreads[0] && isHomeView((key[1] as { view?: View } | undefined)?.view)) return 'list';
  return undefined;
}

export interface BootCacheDeps {
  read: () => Promise<unknown>;
  write: (store: BootStore) => Promise<void>;
  remove: () => Promise<void>;
  now?: () => number;
  saveDelayMs?: number;
  /** Mutations stop waiting for fresh data after this long. */
  freshTimeoutMs?: number;
}

export class BootCache {
  private readonly now: () => number;
  private pending = new Set<string>();
  private freshWaiters: (() => void)[] = [];
  private stopWatch: (() => void) | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: QueryClient,
    private readonly deps: BootCacheDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** A store left by another backend is wiped. */
  async load(backend: BackendKind, email: string | undefined): Promise<BootEntry | undefined> {
    const store = await this.deps.read().catch(() => undefined);
    if (isStore(store) && store.backend !== backend) {
      await this.deps.remove().catch(() => undefined);
      return undefined;
    }
    return email ? pickEntry(store, backend, email, this.now()) : undefined;
  }

  /** Timestamped when last confirmed and invalidated, so every mounted query refetches at once. */
  hydrate(entry: BootEntry) {
    const seed = (key: readonly unknown[], data: unknown, at: number) => {
      this.client.setQueryData(key, data, { updatedAt: at });
      const query = this.client.getQueryCache().find({ queryKey: key, exact: true });
      if (query) this.pending.add(query.queryHash);
      void this.client.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
    };
    if (entry.account) seed(keys.account, entry.account.data, entry.account.at);
    if (entry.labels) seed(keys.labels, entry.labels.data, entry.labels.at);
    if (entry.list) {
      const data: InfiniteData<ThreadPage> = { pages: [entry.list.data], pageParams: [undefined] };
      seed(keys.threads(entry.list.q, entry.list.view), data, entry.list.at);
    }
  }

  /** True while something on screen came from the cache unrefreshed. A cached list nobody shows never refetches, and an account switch clears it: neither may hold mutations back. */
  get revalidating() {
    for (const hash of [...this.pending]) {
      const query = this.client.getQueryCache().get(hash);
      if (!query) this.pending.delete(hash);
      else if (query.getObserversCount() > 0 || query.state.fetchStatus === 'fetching') return true;
    }
    return false;
  }

  /** Or after a timeout. */
  untilFresh(): Promise<void> {
    if (!this.revalidating) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.deps.freshTimeoutMs ?? 20_000);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.freshWaiters.push(done);
    });
  }

  private settle(hash: string) {
    if (!this.pending.delete(hash) || this.revalidating) return;
    const waiters = this.freshWaiters;
    this.freshWaiters = [];
    waiters.forEach((fn) => fn());
  }

  /** Only data the backend confirmed at least once this session is written back. */
  watch(backend: BackendKind, email: string): () => void {
    this.stopWatch?.();
    const confirmed = new Set<string>();
    let listHash: string | undefined;
    const unsubscribe = this.client.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
      if (event.type !== 'updated') return;
      const { query, action } = event;
      const part = partOf(query.queryKey);
      if (!part) return;
      if (action.type === 'error') {
        this.settle(query.queryHash);
        if ((action.error as { code?: string } | null)?.code === 'unauthenticated') void this.clear();
        return;
      }
      if (action.type !== 'success') return;
      if (!action.manual) {
        confirmed.add(query.queryHash);
        if (part === 'account' && norm((query.state.data as Account).email) !== norm(email)) {
          this.discard();
          return;
        }
        this.settle(query.queryHash);
      }
      if (!confirmed.has(query.queryHash)) return;
      if (part === 'list') listHash = query.queryHash;
      this.scheduleSave(backend, email, () => listHash);
    });
    const stop = () => {
      unsubscribe();
      clearTimeout(this.saveTimer);
      if (this.stopWatch === stop) this.stopWatch = undefined;
    };
    this.stopWatch = stop;
    return stop;
  }

  private scheduleSave(backend: BackendKind, email: string, listHash: () => string | undefined) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(backend, email, listHash()), this.deps.saveDelayMs ?? 1_500);
  }

  private async save(backend: BackendKind, email: string, listHash: string | undefined) {
    const cache = this.client.getQueryCache();
    const account = cache.find<Account>({ queryKey: keys.account, exact: true });
    const labels = cache.find<Label[]>({ queryKey: keys.labels, exact: true });
    const list = listHash ? cache.get<InfiniteData<ThreadPage>>(listHash) : undefined;
    if (account?.state.data && norm(account.state.data.email) !== norm(email)) return;
    const store = await this.deps.read().catch(() => undefined);
    const prev = pickEntry(store, backend, email, this.now());
    const entry: BootEntry = { ...prev, email: norm(email), savedAt: this.now() };
    if (account?.state.data) entry.account = { data: keepPhoto(prev?.account?.data, account.state.data), at: account.state.dataUpdatedAt };
    if (labels?.state.data) entry.labels = { data: labels.state.data, at: labels.state.dataUpdatedAt };
    const first = list?.state.data?.pages[0];
    const { q, view } = (list?.queryKey[1] ?? {}) as { q?: string; view?: View };
    if (first && typeof q === 'string' && view) entry.list = { q, view, data: first, at: list!.state.dataUpdatedAt };
    await this.deps.write(withEntry(store, backend, entry)).catch(() => undefined);
  }

  /** The cache was for someone else. */
  private discard() {
    for (const hash of [...this.pending]) {
      const query = this.client.getQueryCache().get(hash);
      if (query) void this.client.resetQueries({ queryKey: query.queryKey, exact: true });
    }
    void this.clear();
  }

  async clear() {
    clearTimeout(this.saveTimer);
    this.stopWatch?.();
    // Nothing settles these once the watch has stopped.
    this.pending.clear();
    const waiters = this.freshWaiters;
    this.freshWaiters = [];
    waiters.forEach((fn) => fn());
    await this.deps.remove().catch(() => undefined);
  }
}

export const bootCache = new BootCache(queryClient, {
  read: () => readKey(BOOT_CACHE_KEY),
  write: (store) => writeKey(BOOT_CACHE_KEY, store),
  remove: () => removeKey(BOOT_CACHE_KEY),
});
