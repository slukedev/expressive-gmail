import { describe, expect, it } from 'vitest';
import {
  buildAuthUrl,
  createTokenProvider,
  parseAuthResponse,
  redirectUriFor,
  type OAuthMessage,
} from '../../src/app/data/api/auth';
import { createOAuthHandler, type OAuthDeps } from '../../src/background/oauth';
import { fakeFetch, json } from './fake-fetch';

function store(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    async get(k: string) {
      return data[k];
    },
    async set(k: string, v: unknown) {
      data[k] = v;
    },
    async remove(k: string) {
      delete data[k];
    },
  };
}

describe('auth URL and redirect parsing', () => {
  it('builds an implicit-flow URL; silent renewal uses prompt=none with login_hint', () => {
    const url = new URL(
      buildAuthUrl({ clientId: 'cid.apps.googleusercontent.com', redirectUri: 'https://abc.chromiumapp.org/', state: 's1', silent: true, loginHint: 'sam@example.org' }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('login_hint')).toBe('sam@example.org');
    expect(url.searchParams.get('scope')!.split(' ')).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(url.searchParams.get('scope')!.split(' ')).toContain('https://www.googleapis.com/auth/contacts.other.readonly');
  });

  it('reads the token from the fragment and computes the expiry', () => {
    const res = parseAuthResponse(
      'https://abc.chromiumapp.org/#state=s1&access_token=ya29.a0Af&token_type=Bearer&expires_in=3599&scope=email%20https://www.googleapis.com/auth/gmail.modify',
      's1',
      1_000,
    );
    expect(res).toEqual({ token: 'ya29.a0Af', expiresAt: 1_000 + 3_599_000, scopes: ['email', 'https://www.googleapis.com/auth/gmail.modify'] });
  });

  it('rejects a mismatched state and maps Google error codes', () => {
    expect(parseAuthResponse('https://abc.chromiumapp.org/#state=evil&access_token=t', 's1', 0)).toMatchObject({ error: 'state-mismatch' });
    expect(parseAuthResponse('https://abc.chromiumapp.org/#error=interaction_required&state=s1', 's1', 0)).toMatchObject({ error: 'interaction-required' });
    expect(parseAuthResponse('https://abc.chromiumapp.org/?error=access_denied&state=s1', 's1', 0)).toMatchObject({ error: 'access-denied' });
  });

  it('uses the Firefox loopback redirect and leaves Chrome redirects alone', () => {
    expect(redirectUriFor('https://2c127fa4f0e7f1a1d5ab8b2b3f1e2a6c55d8e4ab.extensions.allizom.org/')).toBe(
      'http://127.0.0.1/mozoauth2/2c127fa4f0e7f1a1d5ab8b2b3f1e2a6c55d8e4ab',
    );
    expect(redirectUriFor('https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/')).toBe('https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/');
  });
});

function deps(overrides: Partial<OAuthDeps> & { launches?: { url: string; interactive: boolean }[]; respond?: (url: URL, interactive: boolean) => string } = {}) {
  const launches = overrides.launches ?? [];
  const net = fakeFetch();
  net.on('GET', /\/users\/me\/profile$/, () => json({ emailAddress: 'sam@example.org', historyId: '1' }));
  net.on('POST', /oauth2\.googleapis\.com\/revoke/, () => new Response(null, { status: 200 }));
  let n = 0;
  const d: OAuthDeps = {
    identity: {
      async launchWebAuthFlow(details) {
        launches.push(details);
        const url = new URL(details.url);
        const redirect = overrides.respond?.(url, details.interactive) ??
          `https://abc.chromiumapp.org/#access_token=tok${launches.length}&expires_in=3600&state=${url.searchParams.get('state')}`;
        return redirect;
      },
      getRedirectURL: () => 'https://abc.chromiumapp.org/',
    },
    session: store(),
    local: store({ 'bg.oauthClientId': 'cid.apps.googleusercontent.com' }),
    fetchImpl: net.fetchImpl,
    now: () => 10_000,
    randomState: () => `state${++n}`,
    ...overrides,
  };
  return { d, launches, net };
}

describe('background OAuth handler', () => {
  it('reports Safari (no identity API) as unsupported', async () => {
    const { d } = deps({ identity: undefined });
    expect(await createOAuthHandler(d).handle({ type: 'oauth:getToken', interactive: true })).toMatchObject({ error: 'safari-unsupported' });
  });

  it('asks for a client id when none is configured', async () => {
    const { d } = deps({ local: store() });
    expect(await createOAuthHandler(d).handle({ type: 'oauth:getToken', interactive: true })).toMatchObject({ error: 'no-client-id' });
  });

  it('falls back to the env client id', async () => {
    const { d, launches } = deps({ local: store(), envClientId: 'env-id' });
    await createOAuthHandler(d).handle({ type: 'oauth:getToken', interactive: false });
    expect(new URL(launches[0].url).searchParams.get('client_id')).toBe('env-id');
  });

  it('tries silently first, opens the window only when interactive, then caches the token and email', async () => {
    const { d, launches } = deps({
      respond: (url, interactive) =>
        interactive
          ? `https://abc.chromiumapp.org/#access_token=interactive-tok&expires_in=3600&state=${url.searchParams.get('state')}`
          : `https://abc.chromiumapp.org/#error=interaction_required&state=${url.searchParams.get('state')}`,
    });
    const handler = createOAuthHandler(d);

    expect(await handler.handle({ type: 'oauth:getToken', interactive: false })).toMatchObject({ error: 'interaction-required' });
    expect(launches).toHaveLength(1);

    const res = await handler.handle({ type: 'oauth:getToken', interactive: true });
    expect(res).toEqual({ token: 'interactive-tok', expiresAt: 10_000 + 3_600_000, email: 'sam@example.org' });
    expect(launches.map((l) => [l.interactive, new URL(l.url).searchParams.get('prompt')])).toEqual([
      [false, 'none'],
      [false, 'none'],
      [true, 'select_account'],
    ]);
    expect(await d.local.get('bg.oauthEmail')).toBe('sam@example.org');

    // Cached: no new window.
    await handler.handle({ type: 'oauth:getToken', interactive: true });
    expect(launches).toHaveLength(3);
  });

  it('passes the stored email as login_hint on renewal and ignores the cache on forceRefresh', async () => {
    const { d, launches } = deps({ local: store({ 'bg.oauthClientId': 'cid', 'bg.oauthEmail': 'sam@example.org' }) });
    const handler = createOAuthHandler(d);
    await handler.handle({ type: 'oauth:getToken', interactive: false });
    await handler.handle({ type: 'oauth:getToken', interactive: false, forceRefresh: true });
    expect(launches).toHaveLength(2);
    expect(new URL(launches[1].url).searchParams.get('login_hint')).toBe('sam@example.org');
  });

  it('shares one flow between concurrent requests', async () => {
    const { d, launches } = deps();
    const handler = createOAuthHandler(d);
    const [a, b] = await Promise.all([
      handler.handle({ type: 'oauth:getToken', interactive: false }),
      handler.handle({ type: 'oauth:getToken', interactive: false }),
    ]);
    expect(a).toEqual(b);
    expect(launches).toHaveLength(1);
  });

  it('signs out by clearing the cache and revoking the token', async () => {
    const { d, net } = deps();
    const handler = createOAuthHandler(d);
    await handler.handle({ type: 'oauth:getToken', interactive: false });
    expect(await handler.handle({ type: 'oauth:signOut' })).toEqual({ ok: true });
    expect(await d.session.get('bg.oauthToken')).toBeUndefined();
    expect(await d.local.get('bg.oauthEmail')).toBeUndefined();
    expect(net.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke?token=tok1'))).toBe(true);
  });

  it('turns a user-closed window into cancelled', async () => {
    const { d } = deps({
      identity: {
        async launchWebAuthFlow(details) {
          if (!details.interactive) throw new Error('User interaction required.');
          throw new Error('The user did not approve access.');
        },
        getRedirectURL: () => 'https://abc.chromiumapp.org/',
      },
    });
    expect(await createOAuthHandler(d).handle({ type: 'oauth:getToken', interactive: true })).toMatchObject({ error: 'cancelled' });
  });
});

describe('UI token provider', () => {
  it('caches until a minute before expiry, dedupes concurrent calls, and forwards forceRefresh', async () => {
    const sent: OAuthMessage[] = [];
    let now = 0;
    const provider = createTokenProvider(async (m) => {
      sent.push(m);
      return { token: `t${sent.length}`, expiresAt: 120_000, email: 'sam@example.org' };
    }, () => now);
    expect(await Promise.all([provider(), provider()])).toEqual(['t1', 't1']);
    now = 59_000;
    expect(await provider()).toBe('t1');
    now = 61_000;
    expect(await provider()).toBe('t2');
    expect(await provider({ forceRefresh: true })).toBe('t3');
    expect(sent[1]).toMatchObject({ type: 'oauth:getToken', interactive: false, loginHint: 'sam@example.org' });
    expect(sent[2]).toMatchObject({ forceRefresh: true });
  });

  it('throws an unauthenticated BackendError when silent renewal fails', async () => {
    const provider = createTokenProvider(async () => ({ error: 'interaction-required', message: 'Sign in again' }));
    await expect(provider()).rejects.toMatchObject({ name: 'BackendError', code: 'unauthenticated' });
  });
});
