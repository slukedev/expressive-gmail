import { BackendError } from '../app/data/backend';
import { parseGmailJson, readHistoryId } from './json';
import type { ClientClock } from './requests';
import type { ReadySession, TokenSource } from './session';

export type Endpoint = 'bv' | 'fd' | 's';

export interface ClientOptions {
  tokens: TokenSource;
  fetch: typeof fetch;
  origin?: string;
  now?: () => number;
  sessionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const REFRESH_TIMEOUT_MS = 4_000;
/** A request stalled across sleep or a network change can hang for minutes; the next poll should get its turn. */
export const REQUEST_TIMEOUT_MS = 45_000;

/** Races rather than passing an AbortSignal: Firefox's page-context `content.fetch` can refuse a signal from the content script's world. */
export async function fetchWithin(fetchImpl: typeof fetch, ms: number, url: string, init: RequestInit): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException('Gmail took too long to answer.', 'AbortError')), ms);
  });
  try {
    return await Promise.race([fetchImpl(url, init), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Same-origin POSTs to /sync/u/N/i/*, signed with the headers Gmail's own client uses. */
export class SyncClient {
  readonly origin: string;
  private readonly now: () => number;
  private readonly sessionStart: number;
  private counter = 0;
  private opId = 0;
  historyId: number | undefined;

  constructor(private readonly options: ClientOptions) {
    this.origin = options.origin ?? 'https://mail.google.com';
    this.now = options.now ?? Date.now;
    this.sessionStart = this.now();
  }

  clock(): ClientClock {
    return { sessionStart: this.sessionStart, now: this.now(), counter: ++this.counter };
  }

  nextOpIds(count: number): number {
    const first = this.opId + 1;
    this.opId += count;
    return first;
  }

  session(): Promise<ReadySession> {
    return this.options.tokens.waitUntilReady(this.options.sessionTimeoutMs ?? 15_000);
  }

  async call(endpoint: Endpoint, body: unknown): Promise<unknown> {
    const session = await this.session();
    const first = await this.send(session, endpoint, body);
    if (first.status !== 403) return this.read(first);
    // A stale XSRF token answers 403; Gmail's own next request carries a fresh one.
    const fresh = await this.options.tokens.waitUntilReady(REFRESH_TIMEOUT_MS, session.capturedAt).catch(() => undefined);
    if (!fresh) {
      throw new BackendError('Gmail rejected the session. Reload the Gmail tab to refresh it.', 'session-unavailable', true);
    }
    return this.read(await this.send(fresh, endpoint, body));
  }

  private async send(session: ReadySession, endpoint: Endpoint, body: unknown): Promise<Response> {
    const params = new URLSearchParams({ hl: session.hl ?? 'en', c: String(this.counter++), rt: 'r', pt: 'ji' });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Framework-Xsrf-Token': session.xsrf,
      'X-Gmail-BTAI': session.btai,
      'X-Google-BTD': session.btd ?? '1',
    };
    if (session.storageRequest) headers['X-Gmail-Storage-Request'] = session.storageRequest;
    try {
      return await fetchWithin(this.options.fetch, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, `${this.origin}${session.syncPath}/i/${endpoint}?${params}`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw new BackendError('Gmail took too long to answer.', 'network', true);
      throw new BackendError("Couldn't reach Gmail. Check your connection.", 'network', true);
    }
  }

  private async read(response: Response): Promise<unknown> {
    assertOk(response);
    const text = await response.text();
    let json: unknown;
    try {
      json = parseGmailJson(text);
    } catch {
      if (/^\s*</.test(text)) throw signedOut();
      throw new BackendError('Gmail sent a response this version of Expressive Gmail does not understand.', 'unknown');
    }
    const history = readHistoryId(json);
    if (history !== undefined && (this.historyId === undefined || history > this.historyId)) this.historyId = history;
    return json;
  }
}

function signedOut() {
  return new BackendError('You are signed out of Gmail. Sign in again to continue.', 'unauthenticated');
}

export function assertOk(response: Response): void {
  if (response.redirected && /accounts\.google\.com/.test(response.url)) throw signedOut();
  if (response.ok) return;
  const { status } = response;
  if (status === 401) throw signedOut();
  if (status === 403) {
    throw new BackendError('Gmail rejected the session. Reload the Gmail tab to refresh it.', 'session-unavailable', true);
  }
  if (status === 404) throw new BackendError('Gmail no longer answers at this address. Expressive Gmail needs an update.', 'unsupported');
  if (status === 429) throw new BackendError('Gmail is rate limiting requests. Try again in a moment.', 'rate-limited', true);
  if (status >= 500) throw new BackendError(`Gmail had a server error (${status}). Try again.`, 'network', true);
  throw new BackendError(`Gmail answered with HTTP ${status}.`, 'unknown');
}
