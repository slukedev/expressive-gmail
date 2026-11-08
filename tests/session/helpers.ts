import { readFileSync } from 'node:fs';
import { BackendError } from '../../src/app/data/backend';
import type { ReadySession, TokenSource } from '../../src/session/session';

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(`${__dirname}/fixtures/${name}`, 'utf8')) as T;
}

export const SESSION: ReadySession = {
  syncPath: '/sync/u/1',
  hl: 'en',
  xsrf: 'AKxsrf-token-one:1760000000000',
  btai: '[null,null,[1,2,3]]',
  btd: '1',
  ik: 'abc123',
  email: 'ada@example.com',
  capturedAt: 1,
};

/** A TokenSource whose next "fresh" session can be scripted, for 403 refresh tests. */
export class FakeTokens implements TokenSource {
  refreshes = 0;
  constructor(
    public session: ReadySession | null = SESSION,
    public fresh?: ReadySession,
  ) {}
  current() {
    return this.session ?? undefined;
  }
  refresh() {
    this.refreshes++;
  }
  async waitUntilReady(_timeoutMs: number, newerThan = 0): Promise<ReadySession> {
    if (newerThan && this.fresh && this.fresh.capturedAt > newerThan) {
      this.session = this.fresh;
      return this.fresh;
    }
    if (!newerThan && this.session) return this.session;
    throw new BackendError('no session', 'session-unavailable', true);
  }
}

export interface Call {
  url: string;
  init: RequestInit;
  body: unknown;
  endpoint?: string;
}

type Responder = (call: Call) => Response | Promise<Response>;

/** Records requests and answers them from a queue of responders, in order. */
export function fakeFetch(...responders: Responder[]) {
  const calls: Call[] = [];
  const queue = [...responders];
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    let body: unknown = init.body;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Call = { url, init, body, endpoint: /\/i\/(\w+)\?/.exec(url)?.[1] };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request ${url}`);
    return next(call);
  };
  return { fetch: impl as typeof fetch, calls };
}

export function json(data: unknown, init: ResponseInit = {}): Responder {
  return () => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

export function status(code: number, body = ''): Responder {
  return () => new Response(body, { status: code });
}

export async function rejection(promise: Promise<unknown>): Promise<BackendError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof BackendError) return err;
    throw err;
  }
  throw new Error('expected the promise to reject');
}
