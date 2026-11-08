import type { Query, QueryClient } from '@tanstack/react-query';
import { BackendError, type MailBackend } from './backend';
import { keys } from './client';
import type { MailChange } from './types';

/** The one loop that keeps mail live: while visible and online it asks what changed since last time and refreshes only what that touches (lists and threads on screen, label counts, changed threads). Nothing else polls. Hidden tabs ask for nothing; failures back off with jitter, longer on a rate limit. */

export interface SyncEnv {
  now(): number;
  visible(): boolean;
  online(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
  random(): number;
  /** Returns an unsubscribe. */
  onWake(fn: (reason: 'visible' | 'online') => void): () => void;
}

const browserSyncEnv: SyncEnv = {
  now: () => Date.now(),
  visible: () => document.visibilityState === 'visible',
  online: () => navigator.onLine !== false,
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (t) => window.clearTimeout(t as number),
  random: Math.random,
  onWake(fn) {
    const vis = () => document.visibilityState === 'visible' && fn('visible');
    const online = () => fn('online');
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', online);
    };
  },
};

const MAX_BACKOFF_MS = 5 * 60_000;
/** A poll that never answers (a port to a reloaded page, a request stuck across sleep) mustn't stop live mail. Above the session backend's 15 s spacing plus a 45 s request. */
const POLL_TIMEOUT_MS = 90_000;
const RATE_LIMIT_FLOOR_MS = 60_000;
/** At a glance, Purchases, packages. */
const BROAD_REFRESH_MS = 5 * 60_000;

// 'category-peek' is keyed by its category's unread count, so the label refresh alone tells it when to search again.
const STATIC_ROOTS = new Set<unknown>([
  keys.account[0],
  'contacts',
  'list-headers',
  'photos',
  'thumbnail',
  'attachment',
  'raw',
  'palette-search',
  'search-peek',
  'category-peek',
]);
const CORE_ROOTS = new Set<unknown>([keys.allThreads[0], keys.labels[0], 'thread']);

const arrivals = new Set<() => void>();

/** Called after a poll finds new mail, so chores like notifications ride this loop instead of polling. */
export function onMailArrived(fn: () => void): () => void {
  arrivals.add(fn);
  return () => arrivals.delete(fn);
}

export interface SyncLoop {
  stop(): void;
  /** Unless one is running. */
  tick(): Promise<void>;
}

export function startSync(backend: () => MailBackend, client: QueryClient, intervalMs: number, env: SyncEnv = browserSyncEnv): SyncLoop {
  let stopped = false;
  let timer: unknown;
  let running: Promise<void> | undefined;
  let failures = 0;
  let lastTick = env.now();
  let lastBroad = env.now();
  let broadPending = false;

  const jitter = (ms: number) => Math.round(ms * (0.8 + env.random() * 0.4));

  const schedule = (ms: number) => {
    env.clearTimer(timer);
    if (!stopped) timer = env.setTimer(() => void tick(), ms);
  };

  const apply = (changes: MailChange[]) => {
    if (!changes.length && !broadPending) return;
    const changed = new Set(changes.flatMap((c) => (c.type === 'threads' ? c.threadIds : [])));
    const all = changes.some((c) => c.type === 'all');
    const threads = all || changed.size > 0;
    const broad = (q: Query) => !CORE_ROOTS.has(q.queryKey[0]) && !STATIC_ROOTS.has(q.queryKey[0]);
    // Read before invalidating: an id no cached query knows is new mail.
    const known = new Set<string>();
    if (changed.size) for (const q of client.getQueryCache().getAll()) collectIds(q.state.data, changed, known);
    const fresh = all || [...changed].some((id) => !known.has(id));
    if (fresh) arrivals.forEach((fn) => fn());
    const touched = (q: Query) => broad(q) && hasAny(q.state.data, changed);

    if (threads) {
      // Marks every cached list stale; only the ones on screen refetch.
      void client.invalidateQueries({ queryKey: keys.allThreads });
      changed.forEach((id) => void client.invalidateQueries({ queryKey: keys.thread(id) }));
      if (all) void client.invalidateQueries({ queryKey: ['thread'] });
      // Smart views holding a changed thread catch up now.
      if (changed.size) void client.invalidateQueries({ predicate: touched });
    }
    if (threads || changes.some((c) => c.type === 'labels')) void client.invalidateQueries({ queryKey: keys.labels });
    // New mail may belong in At a glance, the category tabs or Purchases.
    if (fresh || broadPending) {
      if (env.now() - lastBroad >= BROAD_REFRESH_MS) {
        lastBroad = env.now();
        broadPending = false;
        void client.invalidateQueries({ predicate: broad });
      } else {
        broadPending = true;
        void client.invalidateQueries({ predicate: broad, refetchType: 'none' });
      }
    }
  };

  function tick(): Promise<void> {
    if (running) return running;
    if (stopped) return Promise.resolve();
    env.clearTimer(timer);
    if (!env.visible() || !env.online()) {
      // Asleep until onWake.
      return Promise.resolve();
    }
    running = (async () => {
      try {
        const changes = await within(backend().pollChanges(), POLL_TIMEOUT_MS, env);
        failures = 0;
        lastTick = env.now();
        apply(changes);
        schedule(jitter(intervalMs));
      } catch (err) {
        failures++;
        const limited = err instanceof BackendError && err.code === 'rate-limited';
        const base = Math.max(intervalMs * 2 ** failures, limited ? RATE_LIMIT_FLOOR_MS : 0);
        schedule(jitter(Math.min(MAX_BACKOFF_MS, base)));
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  const unwake = env.onWake((reason) => {
    if (stopped || running) return;
    if (reason === 'online') {
      // Whatever failed while offline gets one more go.
      void client.refetchQueries({ type: 'active', predicate: (q) => q.state.status === 'error' });
    }
    // Back after a while: one catch-up poll. A quick glance away keeps the schedule.
    if (failures === 0 && env.now() - lastTick >= intervalMs / 2) void tick();
    else schedule(failures ? jitter(intervalMs) : Math.max(0, intervalMs - (env.now() - lastTick)));
  });

  schedule(jitter(intervalMs));

  return {
    stop() {
      stopped = true;
      env.clearTimer(timer);
      unwake();
    },
    tick,
  };
}

function collectIds(data: unknown, wanted: Set<string>, out: Set<string>, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 4) return;
  if (Array.isArray(data)) {
    for (const item of data) collectIds(item, wanted, out, depth + 1);
    return;
  }
  const o = data as Record<string, unknown>;
  if (typeof o.id === 'string' && wanted.has(o.id)) out.add(o.id);
  for (const k of ['pages', 'threads', 'items']) if (k in o) collectIds(o[k], wanted, out, depth + 1);
}

function hasAny(data: unknown, wanted: Set<string>): boolean {
  if (!wanted.size) return false;
  const out = new Set<string>();
  collectIds(data, wanted, out);
  return out.size > 0;
}

function within<T>(promise: Promise<T>, ms: number, env: SyncEnv): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = env.setTimer(() => reject(new BackendError('The change poll never answered.', 'network', true)), ms);
    promise.then(
      (v) => (env.clearTimer(t), resolve(v)),
      (e: unknown) => (env.clearTimer(t), reject(e)),
    );
  });
}
