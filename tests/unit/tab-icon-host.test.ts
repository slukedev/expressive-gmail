import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTabIconHref, startTabIconHost, type TabIconHost } from '../../src/shared/tab-icon-host';

// The top page's side of the tab icon, on a stand-in for Gmail's head.

const OURS = 'data:image/png;base64,iVBORw0KGgo=';
const OURS_TOO = 'data:image/png;base64,iVBORw0KGgoAAAA=';
const flush = () => new Promise((r) => setTimeout(r, 0));
const icons = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon" i]')].map((l) => l.getAttribute('href'));

function gmailIcon(href: string, attrs: Record<string, string> = {}) {
  const link = document.createElement('link');
  link.rel = 'shortcut icon';
  link.href = href;
  for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
  document.head.append(link);
  return link;
}

let host: TabIconHost | undefined;
beforeEach(() => {
  document.head.innerHTML = '';
});
afterEach(() => {
  host?.release();
  host = undefined;
});

describe('tab icon on the page', () => {
  it("replaces Gmail's icon and keeps it replaced when Gmail writes a new one", async () => {
    gmailIcon('https://ssl.gstatic.com/gmail.ico');
    host = startTabIconHost();
    host.set(OURS);
    expect(icons()).toEqual([OURS]);

    // Gmail swapping its icon for one with its own count.
    gmailIcon('https://ssl.gstatic.com/unread/3.png');
    await flush();
    expect(icons()).toEqual([OURS]);

    // Something rewriting ours.
    document.querySelector('link[rel="icon"]')!.setAttribute('href', 'https://example.com/x.png');
    await flush();
    expect(icons()).toEqual([OURS]);

    host.set(OURS_TOO);
    expect(icons()).toEqual([OURS_TOO]);
  });

  it("gives back Gmail's latest icon, once per slot, when switched to Gmail's or released", async () => {
    gmailIcon('https://ssl.gstatic.com/gmail.ico');
    gmailIcon('https://ssl.gstatic.com/gmail-192.png', { sizes: '192x192', type: 'image/png' });
    host = startTabIconHost();
    host.set(OURS);
    gmailIcon('https://ssl.gstatic.com/unread/3.ico');
    await flush();

    host.set(null);
    expect(icons()).toEqual(['https://ssl.gstatic.com/gmail-192.png', 'https://ssl.gstatic.com/unread/3.ico']);

    host.set(OURS);
    host.release();
    expect(icons()).toEqual(['https://ssl.gstatic.com/gmail-192.png', 'https://ssl.gstatic.com/unread/3.ico']);
    // Released for good: an app frame left over can't take the tab again.
    host.set(OURS_TOO);
    expect(icons()).not.toContain(OURS_TOO);
  });

  it('stops answering a script that fights back instead of looping with it', async () => {
    host = startTabIconHost();
    host.set(OURS);
    let added = 0;
    const rival = new MutationObserver(() => {
      if (added > 200 || document.querySelector('link[href^="https://rival"]')) return;
      added++;
      gmailIcon(`https://rival.example.com/${added}.png`);
    });
    rival.observe(document.head, { childList: true });
    gmailIcon('https://rival.example.com/0.png');
    for (let i = 0; i < 60; i++) await flush();
    rival.disconnect();
    expect(added).toBeLessThan(40);
  });

  it("reads Gmail's largest PNG icon to draw on, and says when it can't", async () => {
    gmailIcon('https://ssl.gstatic.com/gmail.ico');
    gmailIcon('https://ssl.gstatic.com/gmail-32.png', { sizes: '32x32', type: 'image/png' });
    gmailIcon('https://ssl.gstatic.com/gmail-192.png', { sizes: '192x192', type: 'image/png' });
    const fetchIcon = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));
    host = startTabIconHost(document, fetchIcon as unknown as typeof fetch);
    host.set(OURS);
    expect(await host.gmailIcon()).toBe('data:image/png;base64,iVBORw==');
    expect(fetchIcon).toHaveBeenCalledWith('https://ssl.gstatic.com/gmail-192.png', expect.anything());

    const offline = startTabIconHost(document, (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    expect(await offline.gmailIcon()).toBeNull();
    const notAnImage = startTabIconHost(document, (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch);
    expect(await notAnImage.gmailIcon()).toBeNull();
  });

  it('takes only a PNG data URL from the app frame', () => {
    expect(isTabIconHref(OURS)).toBe(true);
    expect(isTabIconHref('https://example.com/icon.png')).toBe(false);
    expect(isTabIconHref('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isTabIconHref(`data:image/png;base64,${'A'.repeat(300_000)}`)).toBe(false);
    expect(isTabIconHref({ href: OURS })).toBe(false);
  });
});
