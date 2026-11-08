import { describe, expect, it } from 'vitest';
import { SessionBackend } from '../../src/session/backend';
import { storedTokenSource, withSession, type StoredSessions } from '../../src/session/stored';

const studio = { syncPath: '/sync/u/1', xsrf: 'x1', btai: 'b1', ik: 'ik1', email: 'Ada@Studio.example.net', capturedAt: 100 };

describe('sessions saved by each account’s own page', () => {
  it('saves a complete session under its address, and only when something a call uses changed', () => {
    const saved = withSession(undefined, studio)!;
    expect(Object.keys(saved)).toEqual(['ada@studio.example.net']);
    expect(withSession(saved, { ...studio, capturedAt: 200 })).toBeUndefined();
    expect(withSession(saved, { ...studio, xsrf: 'x2', capturedAt: 200 })!['ada@studio.example.net']!.xsrf).toBe('x2');
    // Without an address or a usable token there's nothing to share.
    expect(withSession(saved, { ...studio, email: undefined })).toBeUndefined();
    expect(withSession(saved, { ...studio, btai: undefined })).toBeUndefined();
  });

  it('sends calls to the slot the account is in now, picks up a refreshed session, and names the fix when there is none', async () => {
    let stored: StoredSessions = { 'ada@studio.example.net': studio };
    const read = async () => stored;
    // The account moved from /u/1 to /u/3 after someone signed out of another one.
    const source = storedTokenSource('ada@studio.example.net', 3, read, studio);
    expect((await source.waitUntilReady(1_000)).syncPath).toBe('/sync/u/3');

    // Google refused the old session: a newer one saved since is used, an old one is not.
    await expect(source.waitUntilReady(1_000, 100)).rejects.toThrow('Open ada@studio.example.net once in this browser');
    stored = { 'ada@studio.example.net': { ...studio, xsrf: 'x2', capturedAt: 300 } };
    expect((await source.waitUntilReady(1_000, 100)).xsrf).toBe('x2');

    const never = storedTokenSource('new@example.org', 4, async () => ({}));
    await expect(never.waitUntilReady(1_000)).rejects.toThrow('Open new@example.org once');
  });

  it('reads another account with its own address, name and photo, never the page’s', async () => {
    const page = document.implementation.createHTMLDocument('Gmail');
    page.body.innerHTML =
      '<a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account: Home Person (home@example.com)"><img src="https://lh3.googleusercontent.com/a/home=s32"></a>';
    const asked: string[] = [];
    const backend = new SessionBackend({
      document: page,
      tokens: storedTokenSource('ada@studio.example.net', 3, async () => ({ 'ada@studio.example.net': studio }), studio),
      elsewhere: { name: 'Ada Studio', photoUrl: 'https://lh3.googleusercontent.com/a/ada=s128' },
      fetch: (async (url: string) => {
        asked.push(new URL(url).pathname);
        return new Response('[]');
      }) as unknown as typeof fetch,
    });
    expect(await backend.accountHint(0)).toBe('Ada@Studio.example.net');
    expect(await backend.getAccount()).toEqual({ email: 'Ada@Studio.example.net', name: 'Ada Studio', index: 3, photoUrl: 'https://lh3.googleusercontent.com/a/ada=s128' });
    await backend.listLabels().catch(() => undefined);
    expect(asked[0]).toMatch(/^\/sync\/u\/3\/i\//);
  });
});
