/** Authenticated JSON client for Google APIs with error mapping, backoff and batches. */
import { BackendError } from '../backend';
import { buildBatchBody, parseBatchResponse, type BatchItem, type BatchResult } from './batch';
import type { GmailErrorBody } from './gmail-types';

export const GMAIL_BASE = 'https://gmail.googleapis.com';
export const GMAIL_API = `${GMAIL_BASE}/gmail/v1/users/me`;
export const PEOPLE_API = 'https://people.googleapis.com/v1';
const BATCH_URL = `${GMAIL_BASE}/batch/gmail/v1`;
const MAX_BATCH = 50;
export const MAX_TRIES = 3;

/** `forceRefresh` asks for a new token after a 401. */
export type TokenProvider = (options?: { forceRefresh?: boolean }) => Promise<string>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  backoffBaseMs?: number;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Send this string as-is instead of JSON. */
  rawBody?: string;
  contentType?: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

export function errorFromResponse(status: number, body: unknown, fallbackText = ''): BackendError {
  const err = (body as GmailErrorBody | undefined)?.error;
  const message = err?.message || fallbackText || `HTTP ${status}`;
  const reasons = [
    ...(err?.errors ?? []).map((e) => e.reason ?? ''),
    ...(err?.details ?? []).map((d) => d.reason ?? ''),
  ];
  if (status === 401) return new BackendError(message, 'unauthenticated');
  if (status === 429) return new BackendError(message, 'rate-limited', true);
  if (status === 403) {
    if (reasons.some((r) => RATE_REASONS.has(r))) return new BackendError(message, 'rate-limited', true);
    if (reasons.some((r) => SCOPE_REASONS.has(r)) || /insufficient.*scope/i.test(message)) {
      return new BackendError(`Missing permission: ${message}`, 'unsupported');
    }
    return new BackendError(message, 'unknown');
  }
  if (status === 404) return new BackendError(message, 'not-found');
  if (status >= 500) return new BackendError(message, 'unknown', true);
  return new BackendError(message, 'unknown');
}

function buildUrl(url: string, query?: RequestOptions['query']): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly base: number;

  constructor(
    private readonly getToken: TokenProvider,
    options: HttpOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.base = options.backoffBaseMs ?? 500;
  }

  /** Exponential backoff with full jitter on top of a fixed floor. */
  backoffDelay(attempt: number, retryAfter?: string | null): number {
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
    const exp = this.base * 2 ** attempt;
    return exp / 2 + this.random() * (exp / 2);
  }

  /** With auth, a token refresh on 401, and retries. */
  async raw(url: string, init: RequestInit): Promise<Response> {
    // A send or new draft that dropped or hit a 5xx may still have gone through; only a refusal (429, 401) is safe to send again.
    const once = isNotIdempotent(url, init.method);
    let refreshed = false;
    let forceNext = false;
    let lastError: BackendError | undefined;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const token = await this.getToken(forceNext ? { forceRefresh: true } : undefined);
      forceNext = false;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
          // A request stalled across sleep or a network change would otherwise wait for minutes.
          signal: init.signal ?? timeoutSignal(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        lastError = new BackendError(`Network error: ${(err as Error)?.message ?? err}`, 'network', true);
        if (once) throw lastError;
        if (attempt < MAX_TRIES - 1) await this.sleep(this.backoffDelay(attempt));
        continue;
      }
      if (response.ok) return response;
      const text = await response.text().catch(() => '');
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      const error = errorFromResponse(response.status, body, text.slice(0, 200));
      if (error.code === 'unauthenticated' && !refreshed) {
        // One retry with a fresh token; not a backoff attempt.
        refreshed = true;
        forceNext = true;
        attempt--;
        lastError = error;
        continue;
      }
      if (!error.retryable || (once && error.code !== 'rate-limited')) throw error;
      lastError = error;
      if (attempt < MAX_TRIES - 1) await this.sleep(this.backoffDelay(attempt, response.headers.get('retry-after')));
    }
    throw lastError ?? new BackendError('Request failed', 'unknown');
  }

  async request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? (options.body !== undefined || options.rawBody !== undefined ? 'POST' : 'GET');
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
      headers['Content-Type'] = options.contentType ?? 'text/plain';
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json; charset=UTF-8';
    }
    const response = await this.raw(buildUrl(url, options.query), { method, headers, body });
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  /** Up to MAX_BATCH sub-requests in one call; parts failing with a retryable status are re-sent in a smaller batch after a backoff. Never throws for per-part errors: check `status`. */
  async batch(items: BatchItem[]): Promise<BatchResult[]> {
    const results: BatchResult[] = new Array(items.length);
    for (let offset = 0; offset < items.length; offset += MAX_BATCH) {
      const slice = items.slice(offset, offset + MAX_BATCH);
      let pending = slice.map((_, i) => i);
      for (let attempt = 0; attempt < MAX_TRIES && pending.length; attempt++) {
        if (attempt > 0) await this.sleep(this.backoffDelay(attempt - 1));
        const boundaryValue = `batch_bg_${Math.floor(this.random() * 1e12).toString(36)}`;
        const response = await this.raw(BATCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/mixed; boundary=${boundaryValue}` },
          body: buildBatchBody(
            pending.map((i) => slice[i]),
            boundaryValue,
          ),
        });
        const parsed = parseBatchResponse(response.headers.get('content-type'), await response.text(), pending.length);
        const retry: number[] = [];
        parsed.forEach((result, j) => {
          const index = pending[j];
          results[offset + index] = result;
          const retryable =
            result.status === 0 || (result.status >= 400 && errorFromResponse(result.status, result.body).retryable);
          if (retryable) retry.push(index);
        });
        pending = retry;
      }
    }
    return results;
  }
}

/** Sending mail and creating drafts make something new each time they land. */
function isNotIdempotent(url: string, method = 'GET'): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const path = url.split('?')[0]!;
  return /\/(messages\/send|drafts\/send|drafts|messages|messages\/import)$/.test(path);
}

/** Throws the first failed part as a BackendError. */
export function unwrapBatch<T>(results: BatchResult[], { ignoreNotFound = false } = {}): (T | undefined)[] {
  return results.map((r) => {
    if (r.status >= 200 && r.status < 300) return r.body as T;
    if (ignoreNotFound && r.status === 404) return undefined;
    throw r.status === 0
      ? new BackendError('Batch part missing from response', 'unknown', true)
      : errorFromResponse(r.status, r.body, r.text);
  });
}

/** Long enough for a 25 MB attachment on a slow connection. */
const REQUEST_TIMEOUT_MS = 3 * 60_000;

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}
