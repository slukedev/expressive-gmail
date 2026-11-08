import { readKey, writeKey } from '../../state/storage';

/** In this browser only: how often and lately each command ran, and the last command with what was typed for it. */

export interface Use {
  /** Decayed count as of `at`. */
  n: number;
  at: number;
}

export interface LastRun {
  id: string;
  title: string;
  /** "snooze" + "fri 9am". */
  page?: string;
  query?: string;
}

export interface UsageData {
  uses: Record<string, Use>;
  last?: LastRun;
}

const KEY = 'bg.palette.v1';
const HALF_LIFE = 14 * 86_400_000;
const LIMIT = 300;

const decay = (ms: number) => Math.pow(0.5, Math.max(0, ms) / HALF_LIFE);

/** Often and lately beats once long ago. */
export function frecency(use: Use | undefined, now: number): number {
  return use ? use.n * decay(now - use.at) : 0;
}

/** Keeps the most used few hundred. */
export function recordUse(data: UsageData, id: string, now: number, last?: LastRun): UsageData {
  const uses = { ...data.uses, [id]: { n: frecency(data.uses[id], now) + 1, at: now } };
  const ids = Object.keys(uses);
  if (ids.length > LIMIT) {
    ids.sort((a, b) => frecency(uses[b], now) - frecency(uses[a], now));
    for (const drop of ids.slice(LIMIT)) delete uses[drop];
  }
  return { uses, last: last ?? data.last };
}

/** Up to about a word prefix's worth, so use breaks ties without burying better text matches. */
export function usageBoost(use: Use | undefined, now: number): number {
  const f = frecency(use, now);
  return f > 0 ? Math.min(24, Math.log2(1 + f) * 8) : 0;
}

let data: UsageData = { uses: {} };
let loaded = false;

export function usage(): UsageData {
  if (!loaded) {
    loaded = true;
    void readKey<UsageData>(KEY).then((stored) => {
      if (stored && typeof stored === 'object' && stored.uses && typeof stored.uses === 'object') data = { uses: { ...stored.uses, ...data.uses }, last: data.last ?? stored.last };
    });
  }
  return data;
}

export function remember(id: string, last?: LastRun) {
  data = recordUse(usage(), id, Date.now(), last);
  void writeKey(KEY, data).catch(() => undefined);
}

/** Without counting it for ranking (a typed time, a search result). */
export function rememberLast(last: LastRun) {
  data = { ...usage(), last };
  void writeKey(KEY, data).catch(() => undefined);
}
