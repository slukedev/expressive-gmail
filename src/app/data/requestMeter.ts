import type { MailBackend } from './backend';

/** Counts calls to the backend, so the request budget can be measured: `window.__bgRequests` in development, and a line in Connection details. */
export interface RequestMeter {
  total: number;
  byMethod: Record<string, number>;
  /** Newest last, capped. */
  recent: number[];
  reset(): void;
  since(ms: number): number;
}

const RECENT_CAP = 500;

function createMeter(now: () => number = Date.now): RequestMeter {
  const meter: RequestMeter = {
    total: 0,
    byMethod: {},
    recent: [],
    reset() {
      meter.total = 0;
      meter.byMethod = {};
      meter.recent = [];
    },
    since(ms) {
      const from = now() - ms;
      return meter.recent.filter((t) => t >= from).length;
    },
  };
  return meter;
}

export const requestMeter = createMeter();

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __bgRequests: RequestMeter }).__bgRequests = requestMeter;
}

/** Static fields and local bookkeeping, not requests to Google (geminiStatus reads the page Gmail already loaded). */
const UNCOUNTED = new Set(['kind', 'capabilities', 'subscribe', 'accountHint', 'geminiStatus', 'then']);

export function metered<B extends MailBackend>(backend: B, meter: RequestMeter = requestMeter, now: () => number = Date.now): B {
  const wrapped = new Map<PropertyKey, unknown>();
  return new Proxy(backend, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string' || UNCOUNTED.has(prop)) return value;
      let fn = wrapped.get(prop);
      if (!fn) {
        fn = (...args: unknown[]) => {
          meter.total++;
          meter.byMethod[prop] = (meter.byMethod[prop] ?? 0) + 1;
          meter.recent.push(now());
          if (meter.recent.length > RECENT_CAP) meter.recent.splice(0, meter.recent.length - RECENT_CAP);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
        wrapped.set(prop, fn);
      }
      return fn;
    },
  });
}
