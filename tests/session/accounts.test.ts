import { describe, expect, it } from 'vitest';
import { discoverAccounts, listAccounts, feedUrl, parseAtomFeed, parseListAccounts, profileFromPage, readProfiles, signedInSlots, slotsToRemember, unreadCounts } from '../../src/session/accounts';

const ORIGIN = 'https://mail.google.com';

/** Gmail's atom feed, trimmed to what the reader uses. The title is localized. */
function feed(email: string, unread: number, title = `Gmail - Inbox for ${email}`) {
  return `<?xml version="1.0" encoding="UTF-8"?><feed version="0.3" xmlns="http://purl.org/atom/ns#"><title>${title}</title><tagline>New messages in your Gmail Inbox</tagline><fullcount>${unread}</fullcount><entry><title>Hi</title><author><name>Someone</name><email>someone@example.org</email></author></entry></feed>`;
}

/** A fake fetch serving /mail/u/N/feed/atom from a table; missing slots act like Google's sign-in redirect. */
function feeds(slots: Record<number, string | 'throw' | 503>) {
  const asked: number[] = [];
  const fetchFn = (async (url: string) => {
    const index = Number(/\/u\/(\d+)\//.exec(url)![1]);
    asked.push(index);
    const body = slots[index];
    if (body === 'throw') throw new TypeError('Failed to fetch');
    if (body === 503) return { ok: false, status: 503, url, text: async () => '' };
    if (body === undefined) return { ok: true, url: 'https://accounts.google.com/ServiceLogin?continue=x', text: async () => '<html></html>' };
    return { ok: true, url, text: async () => body };
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}

describe('signed-in accounts from the atom feed', () => {
  it('reads the address from a localized title and the unread count', () => {
    expect(parseAtomFeed(feed('ada@example.com', 12, 'Gmail - Posteingang für ada@example.com'))).toEqual({ email: 'ada@example.com', unread: 12 });
    expect(parseAtomFeed('<html><title>Sign in - Google Accounts</title></html>')).toEqual({});
    expect(feedUrl(ORIGIN, 2)).toBe('https://mail.google.com/mail/u/2/feed/atom');
  });

  it('walks the slots until one is empty, marking the tab’s own account', async () => {
    const { fetchFn, asked } = feeds({ 0: feed('ada@example.com', 3), 1: feed('ada@studio.example.net', 0), 2: feed('ada.makes@example.org', 41) });
    const accounts = await discoverAccounts(fetchFn, ORIGIN, { index: 1, email: 'ada@studio.example.net' });
    expect(accounts).toEqual([
      { email: 'ada@example.com', index: 0, unread: 3 },
      { email: 'ada@studio.example.net', index: 1, unread: 0, home: true },
      { email: 'ada.makes@example.org', index: 2, unread: 41 },
    ]);
    // Slot 3 sent the sign-in page, so the walk stopped there.
    expect(asked).toEqual([0, 1, 2, 3]);
  });

  it('walks past a slot that failed to load instead of taking it for empty, and says so', async () => {
    const { fetchFn, asked } = feeds({ 0: feed('ada@example.com', 1), 1: 503, 2: feed('ada.makes@example.org', 4) });
    const failed: number[] = [];
    const accounts = await discoverAccounts(fetchFn, ORIGIN, { index: 0, email: 'ada@example.com' }, 10, (i) => failed.push(i));
    expect(accounts.map((a) => a.email)).toEqual(['ada@example.com', 'ada.makes@example.org']);
    expect(failed).toEqual([1]);
    expect(asked).toEqual([0, 1, 2, 3]);
  });

  it('stops when a slot repeats an address (Gmail serves /u/0 for slots nobody is in)', async () => {
    const { fetchFn } = feeds({ 0: feed('ada@example.com', 1), 1: feed('Ada@Example.com', 1) });
    expect((await discoverAccounts(fetchFn, ORIGIN, { index: 0, email: 'ada@example.com' })).map((a) => a.email)).toEqual(['ada@example.com']);
  });

  it('keeps the home account even when its own feed fails, and ignores failures after it', async () => {
    const { fetchFn } = feeds({ 0: 'throw' });
    expect(await discoverAccounts(fetchFn, ORIGIN, { index: 0, email: 'ada@example.com' })).toEqual([{ email: 'ada@example.com', index: 0, home: true }]);
    // A home account in a later slot than the walk reached still shows up.
    const later = feeds({ 0: feed('ada@example.com', 2) });
    expect(await discoverAccounts(later.fetchFn, ORIGIN, { index: 4, email: 'ada@work.example.com' })).toEqual([
      { email: 'ada@example.com', index: 0, unread: 2 },
      { email: 'ada@work.example.com', index: 4, home: true },
    ]);
  });

  it('reads unread counts for the asked slots, leaving out the ones that fail', async () => {
    const { fetchFn } = feeds({ 0: feed('ada@example.com', 7), 2: 'throw', 3: feed('ada@x.example', 0) });
    expect(await unreadCounts(fetchFn, ORIGIN, [0, 2, 3])).toEqual({ 0: 7, 3: 0 });
  });
});

describe('names and photos from a Gmail page', () => {
  // Google's bar as Gmail's HTML ships it: entity-escaped label, protocol-relative photo, a placeholder src with a real srcset.
  const page = (email: string, img: string) =>
    `<html><head><script>var x = "SignOutOptions is mentioned in code too";</script></head><body><header id="gb"><div><a class="gb_B gbii" aria-label="Google Account: Ada &quot;Ace&quot; Lovelace&#10;(${email})" href="https://accounts.google.com/SignOutOptions?hl=en&amp;continue=https://mail.google.com/mail/u/1/" role="button">${img}</a></div></header></body></html>`;

  it('reads the button labelled with the account, from src or srcset, at a sharper size', () => {
    expect(profileFromPage(page('ada@studio.example.net', '<img class="gb_P" src="//lh3.googleusercontent.com/ogw/ada=s32-c-mo" alt="">'), 'Ada@Studio.example.net')).toEqual({
      name: 'Ada "Ace" Lovelace',
      photoUrl: 'https://lh3.googleusercontent.com/ogw/ada=s128-c-mo',
    });
    expect(
      profileFromPage(page('ada@studio.example.net', `<img src="data:image/gif;base64,R0lGOD" srcset='https://lh3.googleusercontent.com/a/ada=s32-c 1x, https://lh3.googleusercontent.com/a/ada=s64-c 2x'>`), 'ada@studio.example.net').photoUrl,
    ).toBe('https://lh3.googleusercontent.com/a/ada=s128-c');
    // Another account's button, or a page without one, gives nothing.
    // Google's generic avatar on gstatic isn't this account's photo.
    expect(profileFromPage(page('ada@studio.example.net', '<img src="https://ssl.gstatic.com/accounts/ui/avatar_2x.png">'), 'ada@studio.example.net').photoUrl).toBeUndefined();
    expect(profileFromPage(page('someone@else.example', '<img src="https://lh3.googleusercontent.com/a/x=s32">'), 'ada@studio.example.net')).toEqual({});
    expect(profileFromPage('<html><body>Loading…</body></html>', 'ada@studio.example.net')).toEqual({});
  });

  it('fetches each slot with cookies and skips the ones that bounce to sign-in', async () => {
    const asked: { url: string; credentials?: string }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      asked.push({ url, credentials: init?.credentials });
      if (url.includes('/u/2/')) return { ok: true, url: 'https://accounts.google.com/ServiceLogin', text: async () => '' };
      return { ok: true, url, text: async () => page('ada@studio.example.net', '<img src="https://lh3.googleusercontent.com/a/ada=s32">') };
    }) as unknown as typeof fetch;
    const found = await readProfiles(fetchFn, ORIGIN, [
      { index: 1, email: 'ada@studio.example.net' },
      { index: 2, email: 'ada@gone.example' },
    ]);
    expect(found).toEqual({ 1: { name: 'Ada "Ace" Lovelace', photoUrl: 'https://lh3.googleusercontent.com/a/ada=s128' } });
    expect(asked).toEqual([
      { url: 'https://mail.google.com/mail/u/1/', credentials: 'include' },
      { url: 'https://mail.google.com/mail/u/2/', credentials: 'include' },
    ]);
  });
});

describe("Google's signed-in account list", () => {
  it('reads each account by shape, at a sharper photo size, keyed by address', () => {
    // The shape Google's ListAccounts sends, with a field reordered in the second entry and no photo in the third.
    const body = JSON.stringify([
      'gaia.l.a.r',
      [
        ['gaia.l.a', 1, 'Ada Lovelace', 'Ada@Example.com', 'https://lh3.googleusercontent.com/-abc/AAAA/photo.jpg', 1, 1, 0, null, 1, '1001'],
        ['gaia.l.a', 1, null, 'Ada Studio', 'ada@studio.example.net', '//lh3.googleusercontent.com/a/ACg8oc=s48-c', 1, 0, 0, null, 1, '1002'],
        ['gaia.l.a', 1, 'Ada', 'ada.makes@example.org', '', 1, 1, 0, null, 1, '1003'],
      ],
    ]);
    expect(parseListAccounts(body)).toEqual({
      'ada@example.com': { name: 'Ada Lovelace', photoUrl: 'https://lh3.googleusercontent.com/-abc/AAAA/photo.jpg' },
      'ada@studio.example.net': { name: 'Ada Studio', photoUrl: 'https://lh3.googleusercontent.com/a/ACg8oc=s128-c' },
      'ada.makes@example.org': { name: 'Ada' },
    });
    expect(parseListAccounts('<html>Sign in</html>')).toEqual({});
  });

  it("swaps a signed-in-only photo address for its public copy, which the app's frame can load", () => {
    const body = JSON.stringify(['gaia.l.a.r', [['gaia.l.a', 1, 'Ada', 'ada@example.com', 'https://lh3.google.com/u/0/ogw/AF2bZy=s32-c-mo', 1]]]);
    expect(parseListAccounts(body)).toEqual({ 'ada@example.com': { name: 'Ada', photoUrl: 'https://lh3.googleusercontent.com/ogw/AF2bZy=s128-c-mo' } });
  });
});


describe('asking Google for the account list', () => {
  const entry = ['gaia.l.a', 1, 'Ada', 'ada@example.com', 'https://lh3.googleusercontent.com/a/ada=s48-c', 1, 1, 0, null, 1, '1'];

  it("moves on when Google refuses one way, reads the bar's guarded answer, and says how every try went", async () => {
    const asked: string[] = [];
    const answers = [
      { ok: false, status: 400, text: async () => '' },
      { ok: true, status: 200, text: async () => `)]}'\n${JSON.stringify(['gaia.l.a.r', [entry]])}` },
    ];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      asked.push(init?.method ?? 'GET');
      return answers.shift()!;
    }) as unknown as typeof fetch;
    expect(await listAccounts(fetchFn)).toEqual({ 'ada@example.com': { name: 'Ada', photoUrl: 'https://lh3.googleusercontent.com/a/ada=s128-c' } });
    expect(asked).toEqual(['POST', 'GET']);

    const refusing = (async () => ({ ok: false, status: 400, text: async () => '' })) as unknown as typeof fetch;
    await expect(listAccounts(refusing)).rejects.toThrow('POST HTTP 400; GET HTTP 400; GET HTTP 400');
  });
});

describe('discoverAccounts limit', () => {
  it('never asks for a slot past the limit, so Safari never sees an empty slot’s auth challenge', async () => {
    const asked: string[] = [];
    const feed = (email: string) => `<feed><title>Gmail - Inbox for ${email}</title><fullcount>2</fullcount></feed>`;
    const fetchFn = (async (url: string) => {
      asked.push(url);
      const i = Number(/\/u\/(\d+)\//.exec(url)![1]);
      if (i > 1) return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Gmail"' } });
      return new Response(feed(`user${i}@example.com`), { status: 200 });
    }) as unknown as typeof fetch;
    const found = await discoverAccounts(fetchFn, ORIGIN, { index: 0 }, 2);
    expect(found.map((a) => a.email)).toEqual(['user0@example.com', 'user1@example.com']);
    expect(asked).not.toContain(feedUrl(ORIGIN, 2));
  });
});

describe('signedInSlots', () => {
  it('counts only accounts that hold a slot: signed out and expired ones are left out', () => {
    const acct = (email: string, valid: number, signedOut: number) => ['gaia.l.a', 1, 'Name', email, '', 1, 1, 0, null, valid, 'id', null, null, null, signedOut];
    const body = `)]}'\n${JSON.stringify(['gaia.l.a.r', [acct('a@example.com', 1, 0), acct('b@example.com', 1, 0), acct('c@example.com', 1, 1), acct('d@example.com', 0, 0)]])}`;
    expect(signedInSlots(body)).toBe(2);
    expect(signedInSlots('<html>Sign in</html>')).toBeUndefined();
  });
});

describe('slotsToRemember', () => {
  it('takes the count a walk knows, and never lowers it from a walk that was cut short', () => {
    // Stopped at an empty slot: an account was signed out.
    expect(slotsToRemember(2, 3, 3, false)).toBe(2);
    // Read only as far as allowed (only this tab, after an update): keep what the last walk found.
    expect(slotsToRemember(1, 1, 3, false)).toBe(3);
    expect(slotsToRemember(4, 4, 3, false)).toBe(4);
    // Google's own list said how many.
    expect(slotsToRemember(2, 2, 3, true)).toBe(2);
  });
});
