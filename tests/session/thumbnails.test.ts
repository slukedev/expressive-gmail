import { SessionBackend, type SessionBackendOptions } from '../../src/session/backend';
import { fromDataUrl, isThumbnailUrl, thumbnailUrls } from '../../src/session/thumbnails';
import { FakeTokens, SESSION, fakeFetch, fixture, json, rejection } from './helpers';

const TRIP = 'thread-f:1846500000000000007';
const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2]);

function backend(fetchImpl: typeof fetch, options: SessionBackendOptions = {}) {
  return new SessionBackend({ tokens: new FakeTokens(), fetch: fetchImpl, sleep: async () => {}, ...options });
}

const image = () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
const html = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });

describe('thumbnailUrls', () => {
  it('swaps the download disposition for the fimg rendition, then the older disp=thd form', () => {
    const urls = thumbnailUrls('https://mail.google.com/mail/u/1/?ui=2&ik=abc&attid=0.2&permmsgid=msg-f:7&th=99&view=att&zw&disp=safe');
    expect(urls).toEqual([
      'https://mail.google.com/mail/u/1/?ui=2&ik=abc&attid=0.2&permmsgid=msg-f:7&th=99&zw&view=fimg&sz=w400-h400&disp=thd',
      'https://mail.google.com/mail/u/1/?ui=2&ik=abc&attid=0.2&permmsgid=msg-f:7&th=99&zw&view=att&disp=thd',
    ]);
  });

  it('drops an existing size and fragment', () => {
    const [first] = thumbnailUrls('https://mail.google.com/mail/u/0/?ui=2&attid=0.1&sz=s0-l75&disp=emb#x');
    expect(first).toBe('https://mail.google.com/mail/u/0/?ui=2&attid=0.1&view=fimg&sz=w400-h400&disp=thd');
  });

  it('has nothing to offer for a URL without a query', () => {
    expect(thumbnailUrls('https://mail.google.com/mail/u/0/')).toEqual([]);
  });
});

describe('isThumbnailUrl', () => {
  it('accepts only Gmail thumbnail URLs for the background to read', () => {
    expect(isThumbnailUrl(thumbnailUrls('https://mail.google.com/mail/u/2/?ui=2&ik=a&attid=0.1&view=att')[0]!)).toBe(true);
    expect(isThumbnailUrl('https://mail.google.com/mail/u/2/?ui=2&ik=a&attid=0.1&view=att&disp=safe')).toBe(false);
    expect(isThumbnailUrl('https://example.com/mail/u/2/?attid=0.1&disp=thd')).toBe(false);
    expect(isThumbnailUrl('https://mail.google.com/mail/u/2/?disp=thd')).toBe(false);
  });
});

describe('fromDataUrl', () => {
  it('splits an image data URL and refuses anything else', () => {
    expect(fromDataUrl('data:image/jpeg;base64,AAAA')).toEqual({ mimeType: 'image/jpeg', data: 'AAAA' });
    expect(fromDataUrl('data:text/html;base64,AAAA')).toBeUndefined();
    expect(fromDataUrl(undefined)).toBeUndefined();
  });
});

describe('SessionBackend.getThumbnail', () => {
  it("reads Gmail's small rendition with the page's sign-in", async () => {
    const { fetch, calls } = fakeFetch(json(fixture('fd-current.json')), image);
    const b = backend(fetch);
    await b.getThread(TRIP);
    const thumb = await b.getThumbnail('msg-f:1846500000000000007', '0.2');
    expect(thumb).toEqual({ data: btoa(String.fromCharCode(...jpeg)), mimeType: 'image/jpeg' });
    expect(calls[1]!.url).toContain('&view=fimg&sz=w400-h400&disp=thd');
    expect(calls[1]!.url).toContain('/mail/u/1/');
    expect(calls[1]!.init.credentials).toBe('include');
  });

  it('falls back to disp=thd, and answers undefined when neither is an image', async () => {
    const { fetch, calls } = fakeFetch(html, html);
    expect(await backend(fetch).getThumbnail('msg-f:42', '0.1')).toBeUndefined();
    expect(calls.map((c) => /view=(\w+)/.exec(c.url)?.[1])).toEqual(['fimg', 'att']);
  });

  it('refuses a rendition that is really the full original', async () => {
    const big = () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': String(6_500_000) } });
    const { fetch } = fakeFetch(big, big);
    expect(await backend(fetch).getThumbnail('msg-f:42', '0.1')).toBeUndefined();
  });

  it('asks the extension when the page fetch is blocked, and keeps asking it after', async () => {
    const blocked = () => Promise.reject(new TypeError('Failed to fetch'));
    const { fetch, calls } = fakeFetch(blocked);
    const asked: string[] = [];
    const b = backend(fetch, {
      fetchPhoto: async (url) => {
        asked.push(url);
        return 'data:image/webp;base64,UklG';
      },
    });
    expect(await b.getThumbnail('msg-f:42', '0.1')).toEqual({ data: 'UklG', mimeType: 'image/webp' });
    expect(await b.getThumbnail('msg-f:42', '0.2')).toEqual({ data: 'UklG', mimeType: 'image/webp' });
    expect(calls).toHaveLength(1);
    expect(asked).toHaveLength(2);
  });

  it('cannot build a URL before Gmail exposes ik', async () => {
    const { fetch, calls } = fakeFetch();
    const tokens = new FakeTokens({ ...SESSION, ik: undefined });
    expect((await rejection(backend(fetch, { tokens }).getThumbnail('msg-f:42', '0.1'))).code).toBe('session-unavailable');
    expect(calls).toHaveLength(0);
  });
});
