/**
 * Low-priority mail searches nobody is waiting on (linking a package email by tracking number, a card's history).
 * One at a time from a token bucket (3 at once, then one every 20 s), only while visible and idle, cached per backend and query, so calling it per row or from a render is fine. Identical queries share one request; failures aren't cached.
 */
import type { MailBackend } from './backend';
import { backend } from './client';
import type { ThreadSummary } from './types';

export interface BackgroundSearchOptions {
  pageSize?: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
}

const BUCKET_SIZE = 3;
const REFILL_MS = 20_000;
const DEFAULT_MAX_AGE = 10 * 60_000;
const CACHE_LIMIT = 200;

interface Job {
  key: string;
  query: string;
  pageSize: number;
  promise: Promise<ThreadSummary[]>;
  resolve: (t: ThreadSummary[]) => void;
  reject: (e: unknown) => void;
  waiters: number;
}

type Cache = Map<string, { at: number; threads: ThreadSummary[] }>;

/** Hooks for tests. */
export interface QueueEnv {
  now(): number;
  visible(): boolean;
  idle(fn: () => void): void;
  setTimer(fn: () => void, ms: number): unknown;
  backend(): MailBackend;
}

const browserEnv: QueueEnv = {
  now: () => Date.now(),
  visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  idle: (fn) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(fn, { timeout: 5_000 });
    else setTimeout(fn, 200);
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  backend,
};

export function createBackgroundQueue(env: QueueEnv = browserEnv) {
  const caches = new WeakMap<MailBackend, Cache>();
  const queue: Job[] = [];
  const inflight = new Map<string, Job>();
  let tokens = BUCKET_SIZE;
  let refilledAt = env.now();
  let running = false;
  let scheduled = false;

  const cacheFor = (b: MailBackend) => {
    let c = caches.get(b);
    if (!c) caches.set(b, (c = new Map()));
    return c;
  };

  const refill = () => {
    const now = env.now();
    const earned = Math.floor((now - refilledAt) / REFILL_MS);
    if (earned > 0) {
      tokens = Math.min(BUCKET_SIZE, tokens + earned);
      refilledAt = tokens === BUCKET_SIZE ? now : refilledAt + earned * REFILL_MS;
    }
  };

  const onVisible = () => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', onVisible);
    schedule(0);
  };

  function schedule(delay: number) {
    if (scheduled || running || !queue.length) return;
    scheduled = true;
    env.setTimer(() => {
      scheduled = false;
      if (!env.visible()) {
        // Hidden tabs ask for nothing.
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
        else schedule(REFILL_MS);
        return;
      }
      env.idle(pump);
    }, delay);
  }

  async function pump() {
    if (running) return;
    refill();
    if (!tokens) return schedule(REFILL_MS - (env.now() - refilledAt));
    const job = queue.shift();
    if (!job) return;
    tokens--;
    running = true;
    const b = env.backend();
    try {
      const page = await b.listThreads({ q: job.query, pageSize: job.pageSize });
      const cache = cacheFor(b);
      cache.set(job.key, { at: env.now(), threads: page.threads });
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      job.resolve(page.threads);
    } catch (e) {
      job.reject(e);
    } finally {
      inflight.delete(job.key);
      running = false;
      schedule(0);
    }
  }

  function search(query: string, opts: BackgroundSearchOptions = {}): Promise<ThreadSummary[]> {
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));
    const key = `${pageSize}\u0000${query.trim()}`;
    const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE;
    let b: MailBackend;
    try {
      b = env.backend();
    } catch (e) {
      return Promise.reject(e);
    }
    const hit = cacheFor(b).get(key);
    if (hit && env.now() - hit.at < maxAge) return Promise.resolve(hit.threads);
    if (opts.signal?.aborted) return Promise.reject(abortError());

    let job = inflight.get(key);
    if (!job) {
      let resolve!: Job['resolve'];
      let reject!: Job['reject'];
      const promise = new Promise<ThreadSummary[]>((res, rej) => ((resolve = res), (reject = rej)));
      job = { key, query: query.trim(), pageSize, promise, resolve, reject, waiters: 0 };
      inflight.set(key, job);
      queue.push(job);
      schedule(0);
    }
    const j = job;
    j.waiters++;
    if (!opts.signal) return j.promise;
    const signal = opts.signal;
    return new Promise((resolve, reject) => {
      const abort = () => {
        reject(abortError());
        // Nobody else wants it and it hasn't started.
        if (--j.waiters === 0 && queue.includes(j)) {
          queue.splice(queue.indexOf(j), 1);
          inflight.delete(j.key);
        }
      };
      signal.addEventListener('abort', abort, { once: true });
      j.promise.then(
        (t) => (signal.removeEventListener('abort', abort), resolve(t)),
        (e) => (signal.removeEventListener('abort', abort), reject(e)),
      );
    });
  }

  return { search, pending: () => queue.length + (running ? 1 : 0) };
}

function abortError() {
  return typeof DOMException !== 'undefined' ? new DOMException('Aborted', 'AbortError') : Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

const shared = createBackgroundQueue();

export function backgroundSearch(query: string, opts?: BackgroundSearchOptions): Promise<ThreadSummary[]> {
  return shared.search(query, opts);
}
