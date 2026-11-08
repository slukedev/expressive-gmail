import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { setBackend } from '../../src/app/data/client';
import { createDemoBackend } from '../../src/app/data/demo';
import { PHOTO_LIMITS, PhotoCache, photos, usePersonPhoto } from '../../src/app/data/photos';
import { faviconUrl } from '../../src/app/data/brands';
import { photoLog } from '../../src/app/data/photoLog';

const NOW = new Date(2026, 9, 8, 9, 0).getTime();
const tick = () => new Promise((r) => setTimeout(r, 5));

function setup(found: Record<string, string> = {}, stored: Record<string, unknown> = {}, logos: Record<string, number> = {}) {
  let now = NOW;
  let saved = stored;
  const imageWidth = vi.fn(async (url: string) => logos[new URL(new URL(url).searchParams.get('url')!).hostname] ?? 16);
  const lookup = vi.fn(async (emails: string[]) => Object.fromEntries(emails.filter((e) => found[e]).map((e) => [e, found[e]!])));
  const cache = new PhotoCache({
    lookup: () => lookup,
    read: async () => saved,
    write: async (s) => void (saved = s),
    imageWidth,
    now: () => now,
    batchDelayMs: 0,
    saveDelayMs: 0,
  });
  return { cache, lookup, imageWidth, saved: () => saved, advance: (ms: number) => (now += ms) };
}

describe('PhotoCache', () => {
  it('looks up every avatar requested in the same tick with one call', async () => {
    const { cache, lookup } = setup({ 'ana@example.com': 'https://lh3.googleusercontent.com/a/ana' });
    cache.setScope('session:me@example.com');
    for (const email of ['Ana@example.com', 'bo@example.com', 'ana@example.com', 'cy@example.com']) cache.request(email);
    await tick();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]![0].sort()).toEqual(['ana@example.com', 'bo@example.com', 'cy@example.com']);
    expect(cache.peek('ANA@example.com')).toEqual({ url: 'https://lh3.googleusercontent.com/a/ana', kind: 'person' });
  });

  it('remembers misses for a day and hits for a week, then asks again', async () => {
    const { cache, lookup, advance } = setup({ 'ana@example.com': 'https://lh3.googleusercontent.com/a/ana' });
    cache.setScope('session:me@example.com');
    cache.request('ana@example.com');
    cache.request('bo@example.com');
    await tick();
    cache.request('ana@example.com');
    cache.request('bo@example.com');
    await tick();
    expect(lookup).toHaveBeenCalledTimes(1);

    advance(PHOTO_LIMITS.missTtlMs);
    cache.request('ana@example.com');
    cache.request('bo@example.com');
    await tick();
    expect(lookup).toHaveBeenLastCalledWith(['bo@example.com']);

    advance(PHOTO_LIMITS.hitTtlMs);
    cache.request('ana@example.com');
    await tick();
    expect(lookup).toHaveBeenLastCalledWith(['ana@example.com']);
    // A photo being re-checked stays on screen meanwhile.
    expect(cache.peek('ana@example.com')?.url).toBe('https://lh3.googleusercontent.com/a/ana');
  });

  it('a failed lookup is retried after minutes, not after a day', async () => {
    const { cache, lookup, advance } = setup();
    lookup.mockRejectedValueOnce(new Error('offline'));
    cache.setScope('session:me@example.com');
    cache.request('ana@example.com');
    await tick();
    cache.request('ana@example.com');
    await tick();
    expect(lookup).toHaveBeenCalledTimes(1);
    advance(PHOTO_LIMITS.errorTtlMs);
    cache.request('ana@example.com');
    await tick();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("drops a photo that didn't load, looks the person up again, and never offers that address again", async () => {
    const signedIn = 'https://lh3.google.com/u/0/ogw/me=s128';
    const { cache, lookup } = setup({ 'me@example.com': signedIn });
    cache.setScope('session:me@example.com');
    cache.remember('me@example.com', signedIn);
    cache.request('me@example.com');
    await tick();
    expect(lookup).not.toHaveBeenCalled();

    cache.broken('me@example.com', signedIn);
    expect(cache.peek('me@example.com')).toBeUndefined();
    cache.request('me@example.com');
    await tick();
    expect(lookup).toHaveBeenCalledTimes(1);
    // The lookup answered with the same broken address: that counts as no photo.
    expect(cache.peek('me@example.com')).toBeUndefined();
    cache.remember('me@example.com', signedIn);
    expect(cache.peek('me@example.com')).toBeUndefined();
    cache.remember('me@example.com', 'https://lh3.googleusercontent.com/a/me');
    expect(cache.peek('me@example.com')).toEqual({ url: 'https://lh3.googleusercontent.com/a/me', kind: 'person' });
  });

  it('runs one lookup at a time; addresses asked for meanwhile wait for the next', async () => {
    let release!: () => void;
    let running = 0;
    let peak = 0;
    const batches: string[][] = [];
    const cache = new PhotoCache({
      lookup: () => async (emails) => {
        batches.push(emails);
        running++;
        peak = Math.max(peak, running);
        if (batches.length === 1) await new Promise<void>((r) => (release = r));
        running--;
        return {};
      },
      read: async () => ({}),
      write: async () => undefined,
      now: () => NOW,
      batchDelayMs: 0,
      saveDelayMs: 0,
    });
    cache.setScope('session:me@example.com');
    cache.request('a@example.com');
    await tick();
    cache.request('b@example.com');
    cache.request('c@example.com');
    await tick();
    expect(batches).toEqual([['a@example.com']]);
    release();
    await tick();
    expect(batches).toEqual([['a@example.com'], ['b@example.com', 'c@example.com']]);
    expect(peak).toBe(1);
  });

  it("keeps each account's answers apart, in memory and in storage", async () => {
    const { cache, lookup, saved } = setup({ 'ana@example.com': 'https://lh3.googleusercontent.com/a/ana' });
    cache.setScope('session:me@example.com');
    cache.request('ana@example.com');
    await tick();
    await tick();
    expect(Object.keys(saved())).toEqual(['session:me@example.com']);

    cache.setScope('session:other@example.com');
    expect(cache.peek('ana@example.com')).toBeUndefined();
    cache.request('ana@example.com');
    await tick();
    expect(lookup).toHaveBeenCalledTimes(2);

    // Back on the first account, the stored answer is used without asking.
    const fresh = setup({}, saved() as Record<string, unknown>);
    fresh.cache.setScope('session:me@example.com');
    fresh.cache.request('ana@example.com');
    await tick();
    expect(fresh.cache.peek('ana@example.com')?.url).toBe('https://lh3.googleusercontent.com/a/ana');
    expect(fresh.lookup).not.toHaveBeenCalled();
  });

  it('waits for an account before looking anything up', async () => {
    const { cache, lookup } = setup();
    cache.request('ana@example.com');
    await tick();
    expect(lookup).not.toHaveBeenCalled();
    cache.setScope('session:me@example.com');
    await tick();
    expect(lookup).toHaveBeenCalledWith(['ana@example.com']);
  });
});

describe('PhotoCache brand logos', () => {
  it("shows an organisation's logo from Google's favicon service, checking each domain once", async () => {
    const { cache, lookup, imageWidth } = setup({}, {}, { 'stripe.com': 128 });
    cache.setScope('session:me@example.com');
    cache.request('receipts@stripe.com');
    cache.request('no-reply@news.stripe.com');
    cache.request('x7f2@mail.stripe.com', 'Stripe Billing');
    await tick();
    expect(imageWidth).toHaveBeenCalledTimes(1);
    expect(imageWidth).toHaveBeenCalledWith(faviconUrl('stripe.com'));
    // Organisations are asked of the backend too, for the logo Gmail itself would show; this one has none.
    expect(lookup).toHaveBeenCalledTimes(1);
    const logo = { url: faviconUrl('stripe.com'), kind: 'brand' };
    expect(cache.peek('receipts@stripe.com')).toEqual(logo);
    expect(cache.peek('x7f2@mail.stripe.com')).toEqual(logo);
  });

  it("treats Google's 16px fallback globe as no logo, and remembers that for the domain", async () => {
    const { cache, imageWidth, advance } = setup({}, {}, { 'ledgerly.io': 16 });
    cache.setScope('session:me@example.com');
    cache.request('hello@ledgerly.io');
    await tick();
    expect(cache.peek('hello@ledgerly.io')).toBeUndefined();
    cache.request('news@ledgerly.io');
    advance(PHOTO_LIMITS.brandMissTtlMs - 1);
    cache.request('hello@ledgerly.io');
    await tick();
    expect(imageWidth).toHaveBeenCalledTimes(1);
  });

  it("prefers the logo Gmail itself has for an organisation over its favicon, and sits it like a logo", async () => {
    const inline = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA';
    const { cache } = setup({ 'extracare@e.pharmaco.io': inline }, {}, { 'pharmaco.io': 32 });
    cache.setScope('session:me@example.com');
    cache.request('ExtraCare@e.pharmaco.io', 'Pharmaco ExtraCare');
    await tick();
    expect(cache.peek('extracare@e.pharmaco.io')).toEqual({ url: inline, kind: 'brand' });
  });

  it('takes a 32px favicon as a logo, which many companies only have', async () => {
    const { cache } = setup({}, {}, { 'pharmaco.io': 32 });
    cache.setScope('session:me@example.com');
    cache.request('extracare@e.pharmaco.io', 'Pharmaco');
    await tick();
    expect(cache.peek('extracare@e.pharmaco.io')).toEqual({ url: faviconUrl('pharmaco.io'), kind: 'brand' });
  });

  it("shows an organisation's own Google picture when it has no usable logo", async () => {
    const { cache, lookup } = setup({ 'hello@ledgerly.io': 'https://lh3.googleusercontent.com/a/ledgerly' }, {}, { 'ledgerly.io': 16 });
    cache.setScope('session:me@example.com');
    cache.request('hello@ledgerly.io', 'Ledgerly');
    await tick();
    await tick();
    expect(lookup).toHaveBeenCalledWith(['hello@ledgerly.io']);
    expect(cache.peek('hello@ledgerly.io')).toEqual({ url: 'https://lh3.googleusercontent.com/a/ledgerly', kind: 'brand' });
  });

  it("forgets everything an earlier build saved, photos too, since one may be a placeholder it took for a photo", async () => {
    const stored = {
      'session:me@example.com': {
        savedAt: NOW,
        photos: { 'bo@example.com': [null, NOW], 'ana@example.com': ['https://lh3.googleusercontent.com/a/ana', NOW] },
        brands: { 'pharmaco.io': [null, NOW] },
      },
    };
    const { cache, lookup, imageWidth } = setup({}, stored, { 'pharmaco.io': 32 });
    cache.setScope('session:me@example.com');
    for (const email of ['bo@example.com', 'ana@example.com', 'orders@pharmaco.io']) cache.request(email);
    await tick();
    expect(lookup).toHaveBeenCalledWith(['bo@example.com', 'ana@example.com', 'orders@pharmaco.io']);
    expect(imageWidth).toHaveBeenCalledTimes(1);
  });

  it("takes Google's generic silhouette for no photo, so a sender's brand logo can show instead", async () => {
    let saved: Record<string, unknown> = {};
    const blank = 'https://lh3.googleusercontent.com/a-/ALV-blank=s128';
    const lookup = vi.fn(async () => ({ 'news@example.com': blank, 'ana@example.com': 'https://lh3.googleusercontent.com/a/ana' }));
    const placeholder = vi.fn(async (url: string) => url === blank);
    const cache = new PhotoCache({ lookup: () => lookup, placeholder, read: async () => saved, write: async (s) => void (saved = s), now: () => NOW, batchDelayMs: 0, saveDelayMs: 0 });
    cache.setScope('session:me@example.com');
    cache.request('news@example.com');
    cache.request('ana@example.com');
    await tick();
    expect(cache.peek('news@example.com')).toBeUndefined();
    expect(cache.peek('ana@example.com')).toEqual({ url: 'https://lh3.googleusercontent.com/a/ana', kind: 'person' });
    expect(photoLog.text()).toMatch(/generic silhouette: no photo/);
  });

  it('has the saved answers at once when they were read ahead, so a reload paints photos, not initials first', async () => {
    const stored = { 'session:me@example.com': { v: 5, savedAt: NOW, photos: { 'ana@example.com': ['https://lh3.googleusercontent.com/a/ana', NOW] } } };
    const { cache, lookup } = setup({}, stored);
    await cache.preload();
    cache.setScope('session:me@example.com');
    expect(cache.peek('ana@example.com')).toEqual({ url: 'https://lh3.googleusercontent.com/a/ana', kind: 'person' });
    cache.request('ana@example.com');
    await tick();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('logs an answer it already had, so a pasted log explains photos that never went out to Google, and Look up again asks afresh', async () => {
    const { cache, lookup } = setup({ 'ana@example.com': 'https://lh3.googleusercontent.com/a/ana' });
    cache.setScope('session:me@example.com');
    const off = cache.subscribe('ana@example.com', () => undefined);
    cache.request('ana@example.com');
    await tick();
    cache.request('ana@example.com');
    expect(photoLog.text()).toMatch(/saved answer from \d\d:\d\d: photo/);
    expect(photoLog.text()).not.toContain('ana@');
    cache.reset();
    await tick();
    expect(lookup).toHaveBeenCalledTimes(2);
    off();
  });

  it("uses the source's own logo for a domain when it has one, even on a test domain", async () => {
    const logo = 'data:image/svg+xml,juniper';
    const imageWidth = vi.fn(async () => 128);
    const cache = new PhotoCache({
      lookup: () => async () => ({}),
      read: async () => ({}),
      write: async () => undefined,
      imageWidth,
      logo: (domain) => (domain === 'junipersavings.example' ? logo : undefined),
      now: () => NOW,
      batchDelayMs: 0,
      saveDelayMs: 0,
    });
    cache.setScope('demo:me@example.com');
    cache.request('alerts@junipersavings.example', 'Juniper Savings');
    cache.request('orders@oaklinehome.example', 'Oakline Home');
    await tick();
    expect(imageWidth).toHaveBeenCalledWith(logo);
    expect(cache.peek('alerts@junipersavings.example')).toEqual({ url: logo, kind: 'brand' });
    expect(cache.peek('orders@oaklinehome.example')).toBeUndefined();
  });

  it("tries the sender's own subdomain, then the domain it belongs to, and caches the logo per domain", async () => {
    const widths: Record<string, number> = { 'e.pharmaco.io': 16, 'pharmaco.io': 32 };
    const imageWidth = vi.fn(async (url: string) => widths[new URL(new URL(url).searchParams.get('url')!).hostname] ?? 0);
    const cache = new PhotoCache({ lookup: () => async () => ({}), read: async () => ({}), write: async () => undefined, imageWidth, now: () => NOW, batchDelayMs: 0, saveDelayMs: 0 });
    cache.setScope('session:me@example.com');
    photoLog.clear();
    cache.request('ExtraCare@e.pharmaco.io', 'Pharmaco ExtraCare');
    await tick();
    cache.request('pharmacy@rx.pharmaco.io', 'Pharmaco Pharmacy');
    await tick();
    expect(imageWidth.mock.calls.map(([u]) => new URL(new URL(u).searchParams.get('url')!).hostname)).toEqual(['e.pharmaco.io', 'pharmaco.io']);
    expect(cache.peek('pharmacy@rx.pharmaco.io')).toEqual({ url: faviconUrl('pharmaco.io'), kind: 'brand' });
    expect(photoLog.text()).toContain('brand pharmaco.io hit: favicon e.pharmaco.io: 16px, generic; favicon pharmaco.io: 32px');
  });

  it('logs how each person was looked up with domains only, never an address', async () => {
    const how = JSON.stringify({ steps: { 'sam.quill@gmail.com': ['Lookup HTTP 200: not in the answer', 'autocomplete: not found'] }, template: 'Lookup [134, [1,2]] seen' });
    const cache = new PhotoCache({ lookup: () => async () => ({ '#how': how }), read: async () => ({}), write: async () => undefined, now: () => NOW, batchDelayMs: 0, saveDelayMs: 0 });
    cache.setScope('session:me@example.com');
    photoLog.clear();
    cache.request('sam.quill@gmail.com', 'Sam Quill');
    await tick();
    const text = photoLog.text();
    expect(text).toContain('Gmail request template: Lookup [134, [1,2]] seen');
    expect(text).toContain('person *@gmail.com miss: Lookup HTTP 200: not in the answer; autocomplete: not found');
    expect(text).not.toMatch(/sam\.quill|Sam Quill/);
  });

  it('a person at a company is looked up as a person, never shown with the company logo', async () => {
    const { cache, lookup, imageWidth } = setup({}, {}, { 'stripe.com': 128 });
    cache.setScope('session:me@example.com');
    cache.request('ana.lopez@stripe.com', 'Ana Lopez');
    await tick();
    expect(lookup).toHaveBeenCalledWith(['ana.lopez@stripe.com']);
    expect(imageWidth).not.toHaveBeenCalled();
    expect(cache.peek('ana.lopez@stripe.com')).toBeUndefined();
  });
});

describe('usePersonPhoto', () => {
  it('renders every avatar on screen from one backend lookup', async () => {
    const demo = createDemoBackend({ now: () => NOW, liveMail: false });
    const lookupPhotos = vi.fn(async (emails: string[]) => Object.fromEntries(emails.map((e) => [e, `https://lh3.googleusercontent.com/a/${e}`])));
    setBackend(Object.assign(Object.create(demo), { lookupPhotos }));
    photos.setScope('demo:me@example.com');
    const Face = ({ email }: { email: string }) => createElement('span', { 'data-testid': email }, usePersonPhoto(email)?.url ?? 'none');
    const people = ['ana@example.com', 'bo@example.com', 'ana@example.com'];
    const view = render(createElement('div', null, ...people.map((email, i) => createElement(Face, { key: i, email }))));
    await waitFor(() => expect(screen.getAllByTestId('ana@example.com')[0]!.textContent).toBe('https://lh3.googleusercontent.com/a/ana@example.com'));
    expect(lookupPhotos).toHaveBeenCalledTimes(1);
    view.rerender(createElement('div', null, ...people.map((email, i) => createElement(Face, { key: i, email }))));
    await tick();
    expect(lookupPhotos).toHaveBeenCalledTimes(1);
    photos.setScope(undefined);
  });
});

describe('verified (BIMI) logos', () => {
  it('reads the logo from a BIMI record, and only an https SVG', async () => {
    const { bimiLogo, orgDomain } = await import('../../src/app/data/brands');
    expect(bimiLogo('v=BIMI1; l=https://vmc.digicert.com/abc.svg; a=https://vmc.digicert.com/abc.pem')).toBe('https://vmc.digicert.com/abc.svg');
    expect(bimiLogo('v=BIMI1;l=http://x.example/a.svg')).toBeUndefined();
    expect(bimiLogo('v=spf1 include:_spf.google.com')).toBeUndefined();
    expect(orgDomain('nytdirect@nytimes.com', 'me@gmail.com')).toBe('nytimes.com');
    expect(orgDomain('friend@gmail.com', 'me@gmail.com')).toBeUndefined();
    expect(orgDomain('boss@acme.co.uk', 'me@acme.co.uk')).toBeUndefined();
  });

  it("shows a domain's verified logo ahead of its profile photo, trying the sender's own host before the organisation's", async () => {
    const asked: string[] = [];
    const cache = new PhotoCache({
      lookup: () => async (emails) => Object.fromEntries(emails.map((e) => [e, 'https://lh3.googleusercontent.com/a/silhouette'])),
      read: async () => ({}),
      write: async () => undefined,
      imageWidth: async () => 0,
      bimi: async (host) => {
        asked.push(host);
        return host === 'newyorktimes.org' ? ['v=BIMI1; l=https://vmc.logos.org/nyt.svg'] : [];
      },
      now: () => NOW,
      batchDelayMs: 0,
      saveDelayMs: 0,
    });
    cache.setScope('session:me@gmail.com');
    cache.request('nytimes@email.newyorktimes.org', 'The New York Times');
    await tick();
    await tick();
    expect(asked).toEqual(['email.newyorktimes.org', 'newyorktimes.org']);
    expect(cache.peek('nytimes@email.newyorktimes.org')).toEqual({ url: 'https://vmc.logos.org/nyt.svg', kind: 'brand', verified: true });
  });
});

describe('BIMI selectors', () => {
  it("finds a logo published under the selector a sender's mail names, and keeps it for the domain", async () => {
    const { bimiSelectorOf } = await import('../../src/app/data/brands');
    expect(bimiSelectorOf('v=BIMI1; s=nyt;')).toBe('nyt');
    expect(bimiSelectorOf('v=BIMI1; s=default')).toBeUndefined();
    expect(bimiSelectorOf(undefined)).toBeUndefined();

    const asked: string[] = [];
    const cache = new PhotoCache({
      lookup: () => async () => ({}),
      read: async () => ({}),
      write: async () => undefined,
      imageWidth: async () => 0,
      bimi: async (host, selector) => {
        asked.push(`${selector ?? 'default'}._bimi.${host}`);
        return selector === 'nyt' && host === 'paper.org' ? ['v=BIMI1; l=https://vmc.logos.org/paper.svg'] : [];
      },
      now: () => NOW,
      batchDelayMs: 0,
      saveDelayMs: 0,
    });
    cache.setScope('session:me@gmail.com');
    cache.request('news@paper.org', 'The Paper');
    await tick();
    await tick();
    expect(cache.peek('news@paper.org')?.verified).toBeUndefined();
    cache.bimiSelector('news@paper.org', 'v=BIMI1; s=nyt');
    await tick();
    await tick();
    expect(asked).toEqual(['default._bimi.paper.org', 'nyt._bimi.paper.org']);
    // Another address at the same domain gets the logo without asking again.
    cache.request('deals@paper.org');
    expect(cache.peek('deals@paper.org')).toEqual({ url: 'https://vmc.logos.org/paper.svg', kind: 'brand', verified: true });
  });
});

describe('verified logos for avatars that came with a photo', () => {
  it("finds a verified logo without asking for anyone's profile photo", async () => {
    const lookup = vi.fn(async () => ({}));
    const cache = new PhotoCache({
      lookup: () => lookup,
      read: async () => ({}),
      write: async () => undefined,
      imageWidth: async () => 0,
      bimi: async (host) => (host === 'paper.org' ? ['v=BIMI1; l=https://vmc.logos.org/paper.svg'] : []),
      now: () => NOW,
      batchDelayMs: 0,
      saveDelayMs: 0,
    });
    cache.setScope('session:me@gmail.com');
    cache.requestVerified('news@paper.org');
    await tick();
    await tick();
    expect(cache.peekVerified('news@paper.org')).toEqual({ url: 'https://vmc.logos.org/paper.svg', kind: 'brand', verified: true });
    expect(cache.peekVerified('friend@gmail.com')).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
