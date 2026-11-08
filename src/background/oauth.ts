/**
 * Background half of Google sign-in for the Gmail API backend; handles 'oauth:getToken' and 'oauth:signOut'.
 * Tokens live in storage.session and the email in storage.local, so silent renewal can pass login_hint after a restart.
 * Safari has no identity API: a consent tab is no workaround, since only launchWebAuthFlow can catch Google's redirect.
 */
import { browser } from 'wxt/browser';
import { BackendError } from '../app/data/backend';
import {
  buildAuthUrl,
  CLIENT_ID_STORAGE_KEY,
  GOOGLE_REVOKE_ENDPOINT,
  isOAuthError,
  isOAuthMessage,
  parseAuthResponse,
  redirectUriFor,
  type OAuthError,
  type OAuthGetTokenMessage,
  type OAuthResponse,
  type OAuthToken,
} from '../app/data/api/auth';

export { isOAuthMessage };

const TOKEN_KEY = 'bg.oauthToken';
const EMAIL_KEY = 'bg.oauthEmail';
/** Renew this long before expiry. */
const SKEW_MS = 60_000;

interface Store {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

interface Identity {
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
  getRedirectURL(path?: string): string;
}

export interface OAuthDeps {
  identity?: Identity;
  session: Store;
  local: Store;
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  randomState: () => string;
  envClientId?: string;
}

function areaStore(area: { get(k: string): Promise<Record<string, unknown>>; set(i: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> } | undefined): Store {
  if (!area) {
    const memory = new Map<string, unknown>();
    return {
      async get(k) {
        return memory.get(k);
      },
      async set(k, v) {
        memory.set(k, v);
      },
      async remove(k) {
        memory.delete(k);
      },
    };
  }
  return {
    async get(k) {
      return (await area.get(k))[k];
    },
    async set(k, v) {
      await area.set({ [k]: v });
    },
    async remove(k) {
      await area.remove(k);
    },
  };
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function envClientId(): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.WXT_GOOGLE_CLIENT_ID || undefined;
  } catch {
    return undefined;
  }
}

function defaultDeps(): OAuthDeps {
  const b = browser as unknown as {
    identity?: Identity;
    storage?: { session?: Parameters<typeof areaStore>[0]; local?: Parameters<typeof areaStore>[0] };
  };
  return {
    identity: b?.identity?.launchWebAuthFlow ? b.identity : undefined,
    session: areaStore(b?.storage?.session),
    local: areaStore(b?.storage?.local),
    fetchImpl: (input, init) => fetch(input, init),
    now: Date.now,
    randomState,
    envClientId: envClientId(),
  };
}

export function createOAuthHandler(deps: OAuthDeps) {
  // Keyed by interactivity so a silent renewal in flight cannot answer a sign-in click.
  const inflight: Record<string, Promise<OAuthToken | OAuthError> | undefined> = {};

  async function clientId(): Promise<string | undefined> {
    const stored = await deps.local.get(CLIENT_ID_STORAGE_KEY);
    return (typeof stored === 'string' && stored.trim()) || deps.envClientId;
  }

  async function launch(url: string, interactive: boolean): Promise<string | OAuthError> {
    try {
      const result = await deps.identity!.launchWebAuthFlow({ url, interactive });
      if (!result) return { error: 'cancelled', message: 'Google sign-in was closed.' };
      return result;
    } catch (err) {
      const text = String((err as Error)?.message ?? err);
      // Chrome: "User interaction required." / "The user did not approve access."
      // Firefox: "User cancelled or denied access."
      if (!interactive || /interaction required/i.test(text)) {
        return { error: 'interaction-required', message: 'Sign in with Google again to continue.' };
      }
      if (/did not approve|cancel|denied/i.test(text)) return { error: 'cancelled', message: 'Google sign-in was closed.' };
      return { error: 'unknown', message: text };
    }
  }

  async function lookupEmail(token: string): Promise<string | undefined> {
    try {
      const res = await deps.fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return undefined;
      return ((await res.json()) as { emailAddress?: string }).emailAddress;
    } catch {
      return undefined;
    }
  }

  async function authorize(clientIdValue: string, silent: boolean, loginHint: string | undefined): Promise<OAuthToken | OAuthError> {
    const state = deps.randomState();
    const redirectUri = redirectUriFor(deps.identity!.getRedirectURL());
    const url = buildAuthUrl({ clientId: clientIdValue, redirectUri, state, silent, loginHint });
    const responseUrl = await launch(url, !silent);
    if (typeof responseUrl !== 'string') return responseUrl;
    const parsed = parseAuthResponse(responseUrl, state, deps.now());
    if (isOAuthError(parsed)) return parsed;
    const email = (await lookupEmail(parsed.token)) ?? loginHint ?? '';
    const token: OAuthToken = { token: parsed.token, expiresAt: parsed.expiresAt, email };
    await deps.session.set(TOKEN_KEY, token);
    if (email) await deps.local.set(EMAIL_KEY, email);
    return token;
  }

  async function getToken(msg: Omit<OAuthGetTokenMessage, 'type'>): Promise<OAuthToken | OAuthError> {
    if (!deps.identity) {
      return {
        error: 'safari-unsupported',
        message: 'This browser has no extension sign-in API (Safari, Firefox for Android). Use your Gmail session instead.',
      };
    }
    if (!msg.forceRefresh) {
      const cached = (await deps.session.get(TOKEN_KEY)) as OAuthToken | undefined;
      if (cached?.token && cached.expiresAt - SKEW_MS > deps.now()) return cached;
    }
    const id = await clientId();
    if (!id) {
      return { error: 'no-client-id', message: 'Add your Google OAuth client ID in Settings to use the Gmail API backend.' };
    }
    const storedEmail = (await deps.local.get(EMAIL_KEY)) as string | undefined;
    const hint = msg.loginHint || storedEmail || undefined;

    // Silent first: works whenever the user has already consented in this browser.
    const silent = await authorize(id, true, hint);
    if (!isOAuthError(silent) || !msg.interactive) return silent;
    return authorize(id, false, hint);
  }

  async function signOut(): Promise<{ ok: true }> {
    const cached = (await deps.session.get(TOKEN_KEY)) as OAuthToken | undefined;
    await deps.session.remove(TOKEN_KEY);
    await deps.local.remove(EMAIL_KEY);
    if (cached?.token) {
      // Best effort: the token dies within the hour anyway.
      await deps
        .fetchImpl(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(cached.token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  return {
    getToken(msg: Omit<OAuthGetTokenMessage, 'type'>): Promise<OAuthToken | OAuthError> {
      // Concurrent callers share one flow, so two tabs do not open two sign-in windows. A forced refresh
      // never joins an ordinary one, which could hand back the cached token it was asked to replace.
      const key = `${msg.interactive ? 'interactive' : 'silent'}${msg.forceRefresh ? ':fresh' : ''}`;
      return (inflight[key] ??= getToken(msg).finally(() => {
        inflight[key] = undefined;
      }));
    },
    signOut,
    async handle(message: unknown): Promise<OAuthResponse> {
      if (!isOAuthMessage(message)) return { error: 'unknown', message: 'Not an OAuth message.' };
      try {
        if (message.type === 'oauth:signOut') return await signOut();
        return await this.getToken(message);
      } catch (err) {
        return { error: 'unknown', message: String((err as Error)?.message ?? err) };
      }
    },
  };
}

let handler: ReturnType<typeof createOAuthHandler> | undefined;
const getHandler = () => (handler ??= createOAuthHandler(defaultDeps()));

/** Always resolves; errors come back as { error, message }. */
export function handleOAuthMessage(message: unknown): Promise<OAuthResponse> {
  return getHandler().handle(message);
}

/** A silent token or an error, never a sign-in window. For background work like the snooze alarm. */
export async function getBackgroundToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const res = await getHandler().getToken({ interactive: false, forceRefresh: options?.forceRefresh });
  if (isOAuthError(res)) throw new BackendError(res.message, res.error === 'safari-unsupported' ? 'unsupported' : 'unauthenticated');
  return res.token;
}
