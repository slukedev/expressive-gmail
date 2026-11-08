import { fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { setBackend } from '../../src/app/data/client';
import { createDemoBackend } from '../../src/app/data/demo';
import { photos } from '../../src/app/data/photos';
import { Avatar } from '../../src/app/ui/Avatar';

// jsdom has no matchMedia; the theme reads the system colour scheme as it loads.
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});

const NOW = new Date(2026, 9, 8, 9, 0).getTime();
// Each test its own photo: what was read stays cached for the session, as in the app.
const SIGNED_IN = 'https://lh3.google.com/u/0/ogw/AF2bZy=s128-c-mo';
const OTHER_SIGNED_IN = 'https://lh3.google.com/u/0/ogw/BX7kQ=s128-c-mo';
const OTHER_PUBLIC = 'https://lh3.googleusercontent.com/ogw/BX7kQ=s128-c-mo';
const LOOKED_UP = 'https://lh3.googleusercontent.com/a/looked-up=s128';

/** The extension frame in a browser that won't send Google's cookies: every <img> errors, and fetch answers per URL. */
function setup(photoUrl: string, readable: Record<string, boolean>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!readable[url]) throw new TypeError('Failed to fetch');
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } });
    }),
  );
  const demo = createDemoBackend({ now: () => NOW, liveMail: false });
  const lookupPhotos = vi.fn(async (emails: string[]) => Object.fromEntries(emails.map((e) => [e, LOOKED_UP])));
  setBackend(Object.assign(Object.create(demo), { lookupPhotos }));
  photos.setScope('session:me@example.com');
  const view = render(createElement(Avatar, { own: true, name: 'Me', email: 'me@example.com', photoUrl, size: 32 }));
  const img = () => view.container.querySelector('img');
  return { view, img, lookupPhotos };
}

afterEach(() => {
  photos.setScope(undefined);
  vi.unstubAllGlobals();
});

describe('Avatar when its photo will not load', () => {
  it('shows the copy the extension could read instead', async () => {
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:copy-${++n}` }));
    const { img } = setup(SIGNED_IN, { [SIGNED_IN]: true });
    await waitFor(() => expect(img()?.getAttribute('src')).toBe(SIGNED_IN));
    fireEvent.error(img()!);
    await waitFor(() => expect(img()?.getAttribute('src')).toBe('blob:copy-1'));
  });

  it('tries the public copy of a signed-in address, then a fresh lookup, then the initial', async () => {
    const { img, view, lookupPhotos } = setup(OTHER_SIGNED_IN, {});
    await waitFor(() => expect(img()?.getAttribute('src')).toBe(OTHER_SIGNED_IN));
    fireEvent.error(img()!);
    await waitFor(() => expect(img()?.getAttribute('src')).toBe(OTHER_PUBLIC));
    fireEvent.error(img()!);
    await waitFor(() => expect(img()?.getAttribute('src')).toBe(LOOKED_UP));
    expect(lookupPhotos).toHaveBeenCalledWith(['me@example.com']);
    fireEvent.error(img()!);
    await waitFor(() => expect(img()).toBeNull());
    expect(view.container.textContent).toBe('M');
  });
});

describe('Avatar without a photo yet', () => {
  it('shows the initial, then the photo once a slow lookup answers, without being rendered again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } })));
    let answer!: (found: Record<string, string>) => void;
    const demo = createDemoBackend({ now: () => NOW, liveMail: false });
    setBackend(Object.assign(Object.create(demo), { lookupPhotos: () => new Promise((r) => (answer = r)) }));
    photos.setScope('session:me@example.com');
    const view = render(createElement(Avatar, { name: 'Dee Moss', email: 'dee@example.org', size: 32 }));
    await waitFor(() => expect(answer).toBeDefined());
    expect(view.container.textContent).toBe('D');
    answer({ 'dee@example.org': 'https://lh3.googleusercontent.com/a/dee-late' });
    await waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://lh3.googleusercontent.com/a/dee-late'));
  });
});

describe('Avatar when reading its photo hangs', () => {
  it("puts a person's photo up without reading it first, so a read that hangs can't hold it back", async () => {
    const HANGING = 'https://lh3.googleusercontent.com/a/hangs=s128';
    // Safari can hold a request to a host it hasn't been allowed on: the read never answers.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const demo = createDemoBackend({ now: () => NOW, liveMail: false });
    setBackend(demo);
    photos.setScope('session:me@example.com');
    const view = render(createElement(Avatar, { name: 'Real Person', email: 'real@example.com', photoUrl: HANGING, size: 32 }));
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(HANGING);
  });
});

describe('Avatar while its photo downloads', () => {
  it('keeps the initial until the image has decoded, then shows it at once wherever it appears again', async () => {
    const SLOW = 'https://lh3.googleusercontent.com/a/slow=s128';
    let finish = () => undefined as void;
    const decode = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    vi.stubGlobal('Image', class extends window.Image {
      override decode = decode;
    });
    setBackend(createDemoBackend({ now: () => NOW, liveMail: false }));
    photos.setScope('session:me@example.com');
    const first = render(createElement(Avatar, { name: 'Sam Slow', email: 'sam@example.com', photoUrl: SLOW, size: 32 }));
    const avatar = first.container.querySelector('.m3-avatar')!;
    await waitFor(() => expect(decode).toHaveBeenCalled());
    expect(avatar.textContent).toBe('S');
    expect(avatar.hasAttribute('data-ready')).toBe(false);
    finish();
    await waitFor(() => expect(avatar.hasAttribute('data-ready')).toBe(true));
    expect(avatar.textContent).toBe('');
    // Shown again (a row re-rendered, a list came back): no initial, no fade, no second decode.
    const again = render(createElement(Avatar, { name: 'Sam Slow', email: 'sam@example.com', photoUrl: SLOW, size: 32 }));
    const second = again.container.querySelector('.m3-avatar')!;
    expect(second.hasAttribute('data-ready') && second.hasAttribute('data-instant')).toBe(true);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
