import { BackendError } from '../app/data/backend';
import {
  ISOLATED_SOURCE,
  PROTOCOL_VERSION,
  isSessionTokensMessage,
  type RequestTokensMessage,
  type SessionTokens,
} from './protocol';

/** Tokens complete enough to call /sync/. */
export type ReadySession = SessionTokens & Required<Pick<SessionTokens, 'syncPath' | 'xsrf' | 'btai'>>;

export function isReady(tokens: SessionTokens | undefined): tokens is ReadySession {
  return !!tokens?.syncPath && !!tokens.xsrf && !!tokens.btai;
}

export interface TokenSource {
  current(): SessionTokens | undefined;
  /** Resolves once tokens are ready and newer than `newerThan` (epoch ms), else rejects. */
  waitUntilReady(timeoutMs: number, newerThan?: number): Promise<ReadySession>;
  refresh(): void;
}

export class SessionStore implements TokenSource {
  private tokens: SessionTokens | undefined;
  private listeners = new Set<() => void>();

  constructor(private readonly win: Window = window) {
    win.addEventListener('message', this.onMessage);
    this.refresh();
  }

  dispose() {
    this.win.removeEventListener('message', this.onMessage);
  }

  current() {
    return this.tokens;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refresh() {
    const message: RequestTokensMessage = { source: ISOLATED_SOURCE, version: PROTOCOL_VERSION, type: 'request-tokens' };
    this.win.postMessage(message, this.win.location.origin);
  }

  waitUntilReady(timeoutMs: number, newerThan = 0): Promise<ReadySession> {
    const ok = (t: SessionTokens | undefined): t is ReadySession => isReady(t) && t.capturedAt > newerThan;
    if (ok(this.tokens)) return Promise.resolve(this.tokens);
    return new Promise((resolve, reject) => {
      const done = () => {
        if (!ok(this.tokens)) return;
        cleanup();
        resolve(this.tokens);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new BackendError(
            newerThan
              ? 'Gmail did not refresh its session in time. Reload Gmail and try again.'
              : 'Waiting for Gmail to finish loading. If this keeps happening, reload the Gmail tab.',
            'session-unavailable',
            true,
          ),
        );
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(done);
      };
      this.listeners.add(done);
      if (newerThan) this.refresh();
    });
  }

  private onMessage = (event: MessageEvent) => {
    if (event.source !== this.win || event.origin !== this.win.location.origin) return;
    if (!isSessionTokensMessage(event.data)) return;
    const incoming = event.data.tokens;
    if (this.tokens && incoming.capturedAt < this.tokens.capturedAt) return;
    this.tokens = { ...this.tokens, ...incoming };
    for (const listener of [...this.listeners]) listener();
  };
}

let defaultStore: SessionStore | undefined;

export function getDefaultStore(): SessionStore {
  defaultStore ??= new SessionStore();
  return defaultStore;
}
