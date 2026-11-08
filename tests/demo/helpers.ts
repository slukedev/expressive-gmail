import type { MailBackend } from '../../src/app/data/backend';
import { createDemoBackend, type DemoBackendOptions } from '../../src/app/data/demo';

/** Thursday, October 8 2026, 10:00 local. Every test pins the clock. */
export const NOW = new Date(2026, 9, 8, 10, 0, 0, 0).getTime();
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface Clock {
  now: () => number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function clock(start = NOW): Clock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

export function demo(opts: DemoBackendOptions = {}): MailBackend {
  return createDemoBackend({ now: () => NOW, liveMail: false, ...opts });
}

/** Every thread id matching a query, in order. */
export async function ids(b: MailBackend, q: string): Promise<string[]> {
  const page = await b.listThreads({ q, pageSize: 500 });
  expect(page.nextPageToken).toBeUndefined();
  expect(page.resultSizeEstimate).toBe(page.threads.length);
  return page.threads.map((t) => t.id);
}

export async function count(b: MailBackend, q: string): Promise<number> {
  return (await b.listThreads({ q, pageSize: 1 })).resultSizeEstimate ?? -1;
}

export function sorted(list: string[]): string[] {
  return [...list].sort();
}
