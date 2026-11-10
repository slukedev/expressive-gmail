import { appManifest, badgeFor, launchInPlace, manifestDataUrl, readLaunch, sharedText, withoutLaunch } from '../../src/shared/pwa';

const ORIGIN = 'https://mail.google.com';
const icon = { src: 'data:image/png;base64,AAAA', sizes: '192x192', type: 'image/png' };
const url = (path: string) => new URL(path, ORIGIN);

describe('the installed app manifest', () => {
  const manifest = appManifest({ origin: ORIGIN, index: 2, name: 'Expressive Gmail', shortName: 'Expressive Gmail', background: '#f0f4f9', icons: [icon] });

  it('uses only absolute URLs on mail.google.com, inside its scope, since a data: manifest has no base', () => {
    const urls = [
      manifest.start_url,
      manifest.share_target.action,
      manifest.protocol_handlers[0].url,
      manifest.file_handlers[0].action,
      ...manifest.shortcuts.map((s) => s.url),
    ];
    for (const u of urls) {
      expect(new URL(u).origin).toBe(ORIGIN);
      expect(u.startsWith(manifest.scope)).toBe(true);
    }
    expect(manifest.start_url).toBe(`${ORIGIN}/mail/u/2/#inbox`);
  });

  it('keeps one id across accounts and themes, so the browser never sees a second app', () => {
    const other = appManifest({ origin: ORIGIN, index: 0, name: 'Renamed', shortName: 'R', background: '#1f1f1f', icons: [] });
    expect(other.id).toBe(manifest.id);
    expect(new URL(manifest.id).origin).toBe(ORIGIN);
  });

  it('launches back into what readLaunch understands', () => {
    const mailto = manifest.protocol_handlers[0].url.replace('%s', encodeURIComponent('mailto:ana@example.com?subject=Hi'));
    expect(readLaunch(url(mailto))).toEqual({ kind: 'mailto', href: 'mailto:ana@example.com?subject=Hi' });
    expect(readLaunch(url(manifest.shortcuts[0].url))).toEqual({ kind: 'compose' });
    expect(readLaunch(url(manifest.file_handlers[0].action))).toEqual({ kind: 'files' });
    // GET share targets replace the action's query with the shared fields.
    const share = new URL(manifest.share_target.action);
    share.search = new URLSearchParams({ title: 'Trail map', text: 'For Saturday', url: 'https://example.com/t' }).toString();
    expect(readLaunch(share)).toEqual({ kind: 'share', title: 'Trail map', text: 'For Saturday', url: 'https://example.com/t' });
    expect(manifest.share_target).toMatchObject({ method: 'GET', enctype: 'application/x-www-form-urlencoded' });
  });

  it('survives the trip through a data: URL', () => {
    const href = manifestDataUrl(manifest);
    expect(href.startsWith('data:application/manifest+json,')).toBe(true);
    expect(JSON.parse(decodeURIComponent(href.slice(href.indexOf(',') + 1)))).toEqual(manifest);
  });
});

describe('launch URLs', () => {
  it('reads Gmail’s own mailto handler too, and never treats another scheme as an address', () => {
    expect(readLaunch(url('/mail/?extsrc=mailto&url=mailto%3Abo%40example.com'))).toEqual({ kind: 'mailto', href: 'mailto:bo@example.com' });
    expect(readLaunch(url('/mail/u/0/?expressive=mailto&url=javascript%3Aalert(1)'))).toEqual({ kind: 'compose' });
    expect(readLaunch(url('/mail/u/0/?expressive=mailto'))).toEqual({ kind: 'compose' });
  });

  it('leaves Gmail’s own URLs alone: popups, print views, delegated mailboxes and plain views', () => {
    for (const path of [
      '/mail/u/0/#inbox',
      '/mail/u/0/?view=cm&fs=1&to=a@example.com&title=x',
      '/mail/u/0/?ui=2&view=pt&search=all&th=abc&url=x',
      '/mail/u/0/d/AEIkF1abcdefgh/?title=x',
      '/mail/u/1/?authuser=1',
    ])
      expect(readLaunch(url(path))).toBeNull();
  });

  it('ignores a share with nothing in it, and caps what one can carry', () => {
    expect(readLaunch(url('/mail/u/0/?title=&text=%20&url='))).toBeNull();
    const long = readLaunch(url(`/mail/u/0/?text=${'a'.repeat(20_000)}`));
    expect(long?.kind === 'share' && long.text.length).toBe(10_000);
  });

  it('cleans the address bar of what it read and nothing else', () => {
    expect(withoutLaunch(url('/mail/u/0/?expressive=mailto&url=mailto%3Abo%40example.com'))).toBe('/mail/u/0/#inbox');
    expect(withoutLaunch(url('/mail/u/0/?authuser=0&title=Hi#starred'))).toBe('/mail/u/0/?authuser=0#starred');
    expect(withoutLaunch(url('/mail/u/0/?view=cm#inbox'))).toBe(`${ORIGIN}/mail/u/0/?view=cm#inbox`);
  });
});

describe('launching into the open window', () => {
  const here = url('/mail/u/0/#inbox/FMfcgz');

  it('turns a shortcut to another view into a route, and another account into a page load', () => {
    expect(launchInPlace(url('/mail/u/0/#starred'), here)).toEqual({ kind: 'route', hash: '#starred' });
    expect(launchInPlace(url('/mail/u/0/#label/Trips+2026'), here)).toEqual({ kind: 'route', hash: '#label/Trips+2026' });
    expect(launchInPlace(url('/mail/u/3/#inbox'), here)).toBe('navigate');
    expect(launchInPlace(url('/mail/u/0/?expressive=compose'), here)).toEqual({ kind: 'compose' });
  });

  it('does nothing for a bare start, a hash that isn’t a view, or another site', () => {
    expect(launchInPlace(url('/mail/u/0/'), here)).toBeNull();
    expect(launchInPlace(url('/mail/u/0/#"><img src=x>'), here)).toBeNull();
    expect(launchInPlace(new URL('https://example.com/mail/u/0/#inbox'), here)).toBeNull();
  });
});

describe('what a share and the badge show', () => {
  it('adds the link after the text unless the text already has it', () => {
    expect(sharedText({ text: 'For Saturday', url: 'https://example.com/t' })).toBe('For Saturday\n\nhttps://example.com/t');
    expect(sharedText({ text: 'See https://example.com/t', url: 'https://example.com/t' })).toBe('See https://example.com/t');
    expect(sharedText({ text: '', url: 'https://example.com/t' })).toBe('https://example.com/t');
  });

  it('clears the badge with nothing unread or when it’s off', () => {
    expect([badgeFor(12, 'count'), badgeFor(12, 'dot'), badgeFor(12, 'off'), badgeFor(0, 'count'), badgeFor(0, 'dot')]).toEqual([12, 'dot', null, null, null]);
  });
});
