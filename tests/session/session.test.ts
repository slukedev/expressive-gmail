import { BackendError } from '../../src/app/data/backend';
import { MAIN_SOURCE, PROTOCOL_VERSION, type SessionTokens } from '../../src/session/protocol';
import { SessionStore } from '../../src/session/session';
import { rejection } from './helpers';

const READY: SessionTokens = { syncPath: '/sync/u/0', xsrf: 'AKx:1', btai: '[1]', capturedAt: 100 };

function deliver(tokens: unknown, init: Partial<MessageEventInit> = {}) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { source: MAIN_SOURCE, version: PROTOCOL_VERSION, type: 'session-tokens', tokens },
      source: window,
      origin: window.location.origin,
      ...init,
    }),
  );
}

describe('SessionStore', () => {
  let store: SessionStore;
  let posted: unknown[];

  beforeEach(() => {
    posted = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message);
    });
    store = new SessionStore(window);
  });

  afterEach(() => {
    store.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('asks the main world for tokens as soon as it starts', () => {
    expect(posted).toEqual([{ source: 'better-gmail/isolated', version: 1, type: 'request-tokens' }]);
  });

  it('resolves a waiting call once complete tokens arrive', async () => {
    const waiting = store.waitUntilReady(1000);
    deliver({ syncPath: '/sync/u/0', capturedAt: 50 });
    deliver(READY);
    await expect(waiting).resolves.toMatchObject({ xsrf: 'AKx:1', syncPath: '/sync/u/0' });
  });

  it('merges partial updates, so GLOBALS and headers can arrive separately', () => {
    deliver({ ik: 'ik1', email: 'ada@example.com', capturedAt: 10 });
    deliver(READY);
    expect(store.current()).toMatchObject({ ik: 'ik1', email: 'ada@example.com', xsrf: 'AKx:1' });
  });

  it.each([
    ['another window', { source: null }],
    ['another origin', { origin: 'https://evil.example' }],
  ])('ignores messages from %s', (_label, init) => {
    deliver(READY, init as Partial<MessageEventInit>);
    expect(store.current()).toBeUndefined();
  });

  it.each([
    ['a wrong version', { ...READY }, { version: 2 }],
    ['a non-string token', { ...READY, xsrf: 42 }, {}],
    ['no timestamp', { syncPath: '/sync/u/0' }, {}],
  ])('ignores a message with %s', (_label, tokens, extra) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: MAIN_SOURCE, version: PROTOCOL_VERSION, type: 'session-tokens', tokens, ...extra },
        source: window,
        origin: window.location.origin,
      }),
    );
    expect(store.current()).toBeUndefined();
  });

  it('does not let an older snapshot overwrite a newer one', () => {
    deliver({ ...READY, xsrf: 'new', capturedAt: 200 });
    deliver({ ...READY, xsrf: 'old', capturedAt: 150 });
    expect(store.current()?.xsrf).toBe('new');
  });

  it('times out with session-unavailable when Gmail never makes a sync call', async () => {
    vi.useFakeTimers();
    const waiting = rejection(store.waitUntilReady(5000));
    await vi.advanceTimersByTimeAsync(5000);
    const err = await waiting;
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe('session-unavailable');
    expect(err.retryable).toBe(true);
  });

  it('waits for tokens newer than a rejected set and re-asks the main world', async () => {
    deliver(READY);
    const waiting = store.waitUntilReady(1000, READY.capturedAt);
    expect(posted).toHaveLength(2);
    deliver({ ...READY, xsrf: 'AKy:2', capturedAt: 101 });
    await expect(waiting).resolves.toMatchObject({ xsrf: 'AKy:2' });
  });
});
