/** Chores that follow new mail: blocked senders to Spam, and desktop notifications. Both run on the sync loop's arrivals; hidden tabs ask for nothing, except one leader tab (Web Locks) that keeps checking so notifications arrive with no tab on screen, backing off on rate limits. */
import { BackendError } from '../data/backend';
import type { ThreadSummary } from '../data/types';

const MINUTE = 60_000;
/** While no visible tab is syncing. */
const HIDDEN_CHECK_MS = MINUTE;
const MAX_HIDDEN_MS = 10 * MINUTE;
const RATE_LIMIT_FLOOR_MS = 5 * MINUTE;
/** A visible tab reported mail this recently, so its sync is running. */
const QUIET_MS = 90_000;
/** Bursts of arrivals (two tabs, a catch-up poll) collapse into one check. */
const MIN_CHECK_GAP_MS = 15_000;

/** Longer after failures, longest when rate-limited. */
export function hiddenDelay(failures: number, rateLimited: boolean): number {
  const base = Math.min(MAX_HIDDEN_MS, HIDDEN_CHECK_MS * 2 ** failures);
  return rateLimited ? Math.max(base, RATE_LIMIT_FLOOR_MS) : base;
}

export interface WatcherEnv {
  now(): number;
  visible(): boolean;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
  onVisibility(fn: () => void): () => void;
  onMailArrived(fn: () => void): () => void;
  /** Null where there's no BroadcastChannel. */
  channel: { post(): void; listen(fn: () => void): () => void } | null;
  /** `fn(true)` once this tab holds the role (maybe much later, when the holder closes). Null without Web Locks: then whichever tab is visible notifies. */
  lead: ((fn: (leading: boolean) => void) => () => void) | null;
  list(q: string, pageSize: number): Promise<ThreadSummary[]>;
  spam(ids: string[]): Promise<void>;
  notify(t: ThreadSummary): Promise<void>;
  paused(): boolean;
  /** For package tracking. */
  sawInbox?(threads: ThreadSummary[]): void;
}

export interface WatcherOptions {
  notifications: boolean;
  blocked: string[];
}

export function startMailWatcher(env: WatcherEnv, opts: WatcherOptions): { stop(): void } {
  let stopped = false;
  let leading = false;
  let seen: Set<string> | null = null;
  let failures = 0;
  let rateLimited = false;
  let heardAt = 0;
  let lastCheck = -Infinity;
  let checking: Promise<void> | undefined;
  let timer: unknown;
  const blocked = opts.blocked.map((b) => b.toLowerCase());

  const sweep = async () => {
    if (!blocked.length || !env.visible()) return;
    try {
      const ids = (await env.list(`in:inbox from:(${blocked.join(' OR ')})`, 50)).map((t) => t.id);
      if (ids.length) await env.spam(ids);
    } catch {
      // The next arrival tries again.
    }
  };

  const notifier = () => opts.notifications && (env.lead ? leading : env.visible());

  const check = (): Promise<void> => {
    if (checking || stopped || !notifier()) return checking ?? Promise.resolve();
    if (env.now() - lastCheck < MIN_CHECK_GAP_MS) return Promise.resolve();
    lastCheck = env.now();
    checking = (async () => {
      try {
        const page = await env.list('in:inbox is:unread newer_than:1d', 20);
        env.sawInbox?.(page);
        failures = 0;
        rateLimited = false;
        if (seen) {
          // A paused inbox stays quiet, a blocked sender is never announced, and a burst stops at three.
          const fresh = page.filter((t) => !seen!.has(t.id) && !blocked.includes((t.participants.at(-1)?.email ?? '').toLowerCase()));
          if (!env.paused()) for (const t of fresh.slice(0, 3)) await env.notify(t);
        }
        seen = new Set([...(seen ?? []), ...page.map((t) => t.id)]);
      } catch (err) {
        failures++;
        rateLimited = err instanceof BackendError && err.code === 'rate-limited';
      } finally {
        checking = undefined;
      }
    })();
    return checking;
  };

  const scheduleHidden = () => {
    env.clearTimer(timer);
    if (stopped || env.visible() || !leading || !opts.notifications) return;
    timer = env.setTimer(async () => {
      // A visible tab's broadcasts drive the checks.
      if (env.now() - heardAt >= QUIET_MS) await check();
      scheduleHidden();
    }, hiddenDelay(failures, rateLimited));
  };

  const offArrived = env.onMailArrived(() => {
    env.channel?.post();
    void sweep();
    void check();
  });
  const offChannel =
    env.channel?.listen(() => {
      heardAt = env.now();
      void check();
    }) ?? (() => undefined);
  const offVisibility = env.onVisibility(scheduleHidden);
  const release =
    env.lead?.((now) => {
      leading = now;
      // The first check only learns what's there, so a new leader doesn't announce old mail.
      if (leading) void check().then(scheduleHidden);
    }) ?? (() => undefined);

  // On start: one sweep for mail that came while no tab was open.
  const startTimer = env.setTimer(() => {
    void sweep();
    if (!env.lead) void check();
  }, 2_000);

  return {
    stop() {
      stopped = true;
      env.clearTimer(timer);
      env.clearTimer(startTimer);
      offArrived();
      offChannel();
      offVisibility();
      release();
    },
  };
}

type Locks = { request(name: string, cb: () => Promise<void>): Promise<void> };

/** Web Locks for the leader, a BroadcastChannel between tabs. */
export function browserWatcherEnv(): Pick<WatcherEnv, 'now' | 'visible' | 'setTimer' | 'clearTimer' | 'onVisibility' | 'channel' | 'lead'> {
  const locks = (navigator as Navigator & { locks?: Locks }).locks;
  const Channel = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  return {
    now: () => Date.now(),
    visible: () => document.visibilityState === 'visible',
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (t) => window.clearTimeout(t as number),
    onVisibility(fn) {
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    },
    channel: Channel
      ? (() => {
          const ch = new Channel('bg-mail-arrived');
          return {
            post: () => ch.postMessage(1),
            listen(fn: () => void) {
              ch.onmessage = () => fn();
              return () => ch.close();
            },
          };
        })()
      : null,
    lead: locks
      ? (fn) => {
          let release: (() => void) | undefined;
          let done = false;
          void locks
            .request('bg-mail-notifier', () => {
              if (done) return Promise.resolve();
              fn(true);
              return new Promise<void>((resolve) => (release = resolve));
            })
            .catch(() => undefined);
          return () => {
            done = true;
            release?.();
          };
        }
      : null,
  };
}
