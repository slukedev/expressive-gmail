/** Google OAuth for the Gmail API backend. The background runs launchWebAuthFlow with the implicit grant (response_type=token), so no client secret ships; tokens last about an hour and renew silently with prompt=none and login_hint. */
import { browser } from 'wxt/browser';
import { BackendError } from '../backend';
import type { TokenProvider } from './http';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
] as const;

/** The OAuth client id the user pasted in Settings. */
export const CLIENT_ID_STORAGE_KEY = 'bg.oauthClientId';

export interface OAuthGetTokenMessage {
  type: 'oauth:getToken';
  /** True may open Google's sign-in window; false only tries silent renewal. */
  interactive: boolean;
  loginHint?: string;
  /** Skip the cached token (after a 401). */
  forceRefresh?: boolean;
}

interface OAuthSignOutMessage {
  type: 'oauth:signOut';
}

export type OAuthMessage = OAuthGetTokenMessage | OAuthSignOutMessage;

export interface OAuthToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
  email: string;
}

type OAuthErrorCode =
  | 'safari-unsupported'
  | 'no-client-id'
  | 'interaction-required'
  | 'access-denied'
  | 'cancelled'
  | 'state-mismatch'
  | 'invalid-response'
  | 'unknown';

export interface OAuthError {
  error: OAuthErrorCode;
  message: string;
}

export type OAuthResponse = OAuthToken | OAuthError | { ok: true };

export function isOAuthMessage(message: unknown): message is OAuthMessage {
  const type = (message as { type?: unknown } | null)?.type;
  return type === 'oauth:getToken' || type === 'oauth:signOut';
}

export function isOAuthError(value: unknown): value is OAuthError {
  return typeof (value as OAuthError | null)?.error === 'string';
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  /** prompt=none. */
  silent: boolean;
  loginHint?: string;
}

export function buildAuthUrl(p: AuthUrlParams): string {
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'token',
    scope: (p.scopes ?? OAUTH_SCOPES).join(' '),
    state: p.state,
    include_granted_scopes: 'true',
  });
  if (p.loginHint) params.set('login_hint', p.loginHint);
  if (p.silent) params.set('prompt', 'none');
  else if (!p.loginHint) params.set('prompt', 'select_account');
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Chrome: https://<id>.chromiumapp.org/. Firefox's getRedirectURL() gives https://<hash>.extensions.allizom.org/, but it also accepts the loopback form http://127.0.0.1/mozoauth2/<hash>, which Google allows for web clients. */
export function redirectUriFor(extensionRedirect: string): string {
  let url: URL;
  try {
    url = new URL(extensionRedirect);
  } catch {
    return extensionRedirect;
  }
  if (url.hostname.endsWith('.extensions.allizom.org')) {
    const hash = url.hostname.split('.')[0];
    return `http://127.0.0.1/mozoauth2/${hash}`;
  }
  return extensionRedirect;
}

export interface ParsedAuthResponse {
  token: string;
  expiresAt: number;
  scopes: string[];
}

/** The token is in the fragment; errors can arrive in the fragment or the query. A state that doesn't match ours is a forged or stale redirect; a non-numeric expires_in counts as one hour. */
export function parseAuthResponse(responseUrl: string, expectedState: string, now: number): ParsedAuthResponse | OAuthError {
  let url: URL;
  try {
    url = new URL(responseUrl);
  } catch {
    return { error: 'invalid-response', message: 'Google returned an unreadable redirect.' };
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (key: string) => fragment.get(key) ?? url.searchParams.get(key);
  const error = get('error');
  if (error) {
    if (error === 'access_denied') return { error: 'access-denied', message: 'Google sign-in was declined.' };
    if (['interaction_required', 'login_required', 'consent_required', 'account_selection_required'].includes(error)) {
      return { error: 'interaction-required', message: 'Sign in with Google again to continue.' };
    }
    return { error: 'unknown', message: get('error_description') || error };
  }
  if (get('state') !== expectedState) {
    return { error: 'state-mismatch', message: 'The sign-in response did not match this request.' };
  }
  const token = get('access_token');
  if (!token) return { error: 'invalid-response', message: 'Google did not return an access token.' };
  const seconds = Number(get('expires_in'));
  return {
    token,
    expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
    scopes: (get('scope') ?? '').split(/\s+/).filter(Boolean),
  };
}

type SendMessage = (message: OAuthMessage) => Promise<unknown>;

const defaultSend: SendMessage = (message) => browser.runtime.sendMessage(message);

/** Must follow a user gesture. */
export async function signIn(loginHint?: string, send: SendMessage = defaultSend): Promise<OAuthToken> {
  const res = (await send({ type: 'oauth:getToken', interactive: true, loginHint })) as OAuthResponse;
  if (isOAuthError(res)) throw new BackendError(res.message, res.error === 'safari-unsupported' ? 'unsupported' : 'unauthenticated');
  return res as OAuthToken;
}

export async function setClientId(clientId: string): Promise<void> {
  await browser.storage.local.set({ [CLIENT_ID_STORAGE_KEY]: clientId.trim() });
}

/** Keeps the token in memory until a minute before expiry and renews silently through the background. A silent failure is BackendError('unauthenticated'), so the UI can offer "Sign in again". */
export function createTokenProvider(send: SendMessage = defaultSend, now: () => number = Date.now): TokenProvider {
  let cached: OAuthToken | undefined;
  let inflight: Promise<OAuthToken> | undefined;
  return async (options) => {
    if (!options?.forceRefresh && cached && cached.expiresAt - 60_000 > now()) return cached.token;
    inflight ??= (async () => {
      const res = (await send({
        type: 'oauth:getToken',
        interactive: false,
        loginHint: cached?.email,
        forceRefresh: options?.forceRefresh,
      })) as OAuthResponse | undefined;
      if (!res || isOAuthError(res)) {
        throw new BackendError(
          res?.message ?? 'Not signed in to Google.',
          res?.error === 'safari-unsupported' ? 'unsupported' : 'unauthenticated',
        );
      }
      return res as OAuthToken;
    })().finally(() => {
      inflight = undefined;
    });
    cached = await inflight;
    return cached.token;
  };
}
