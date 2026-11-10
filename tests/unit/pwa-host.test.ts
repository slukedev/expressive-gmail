import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAppHost } from '../../src/shared/pwa-host';

// The content script's side of the installed app, on a stand-in for Gmail's page.

let stop: AbortController;
let consumer: ((params: { targetURL?: string; files?: unknown[] }) => void) | undefined;

beforeEach(() => {
  stop = new AbortController();
  consumer = undefined;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  (window as unknown as { launchQueue: unknown }).launchQueue = { setConsumer: (fn: typeof consumer) => (consumer = fn) };
  document.head.innerHTML = '';
});

afterEach(() => {
  stop.abort();
  history.replaceState(null, '', '/');
  delete (window as unknown as { launchQueue?: unknown }).launchQueue;
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function host(path: string, manifest = false) {
  history.replaceState(null, '', path);
  const sent: Record<string, unknown>[] = [];
  const app = startAppHost(stop.signal, { manifest });
  app.attach((m) => sent.push(m));
  return { app, sent };
}

describe('the app host', () => {
  it('takes a launch URL out of the address bar before Gmail reads it, and hands it over only once the app says hello', () => {
    const { app, sent } = host('/mail/u/0/?expressive=mailto&url=mailto%3Abo%40example.com#inbox');
    expect(location.pathname + location.search + location.hash).toBe('/mail/u/0/#inbox');
    expect(sent).toEqual([]);
    app.handle({ type: 'app-hello' });
    expect(sent).toContainEqual({ type: 'launch', launch: { kind: 'mailto', href: 'mailto:bo@example.com' } });
    expect(sent.find((m) => m.type === 'app-state')).toMatchObject({ state: { installable: false, standalone: false } });
  });

  it('gives Gmail its URL back when the extension turns out to be off', () => {
    const { app } = host('/mail/u/0/?extsrc=mailto&url=mailto%3Abo%40example.com');
    expect(location.search).toBe('');
    app.release();
    expect(location.search).toBe('?extsrc=mailto&url=mailto%3Abo%40example.com');
  });

  it('skips the launch queue’s copy of the URL it opened with, then routes later launches in place', async () => {
    const { app, sent } = host('/mail/u/0/?expressive=compose');
    app.handle({ type: 'app-hello' });
    consumer!({ targetURL: `${location.origin}/mail/u/0/?expressive=compose` });
    consumer!({ targetURL: `${location.origin}/mail/u/0/#starred` });
    await flush();
    expect(sent.filter((m) => m.type === 'launch').map((m) => m.launch)).toEqual([{ kind: 'compose' }, { kind: 'route', hash: '#starred' }]);
  });

  it('reads launched files and sends them as one launch', async () => {
    const { app, sent } = host('/mail/u/0/?expressive=files');
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    consumer!({ targetURL: `${location.origin}/mail/u/0/?expressive=files`, files: [{ kind: 'file', getFile: async () => file }, { kind: 'directory' }] });
    await flush();
    app.handle({ type: 'app-hello' });
    expect(sent.filter((m) => m.type === 'launch')).toEqual([{ type: 'launch', launch: { kind: 'files', files: [file] } }]);
  });

  it('keeps the browser’s install offer for the Install button and reports how it went', async () => {
    const { app, sent } = host('/mail/u/0/');
    app.handle({ type: 'app-hello' });
    app.handle({ type: 'app-install' });
    expect(sent.at(-1)).toEqual({ type: 'app-install-result', outcome: 'unavailable' });

    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    window.dispatchEvent(offer);
    expect(offer.defaultPrevented).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: 'app-state', state: { installable: true } });
    app.handle({ type: 'app-install' });
    await flush();
    expect(offer.prompt).toHaveBeenCalledOnce();
    expect(sent).toContainEqual({ type: 'app-install-result', outcome: 'accepted' });
    expect(sent.at(-1)).toMatchObject({ type: 'app-state', state: { installable: false } });
  });

  it('badges the icon, and registers email links for its own account', () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    const registerProtocolHandler = vi.fn();
    Object.assign(navigator, { setAppBadge, clearAppBadge, registerProtocolHandler });
    const { app, sent } = host('/mail/u/1/#inbox');
    app.handle({ type: 'app-badge', value: 7 });
    app.handle({ type: 'app-badge', value: 'dot' });
    app.handle({ type: 'app-badge', value: null });
    expect(setAppBadge.mock.calls).toEqual([[7], []]);
    expect(clearAppBadge).toHaveBeenCalledOnce();
    app.handle({ type: 'app-mailto' });
    expect(registerProtocolHandler).toHaveBeenCalledWith('mailto', `${location.origin}/mail/u/1/?expressive=mailto&url=%s`);
    expect(sent.at(-1)).toEqual({ type: 'app-mailto-result', ok: true });
    delete (navigator as unknown as Record<string, unknown>).setAppBadge;
    delete (navigator as unknown as Record<string, unknown>).clearAppBadge;
    delete (navigator as unknown as Record<string, unknown>).registerProtocolHandler;
  });

  it('colors the title bar and writes its manifest in place of Gmail’s', async () => {
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ name: 'Expressive Gmail', short_name: 'Expressive Gmail', version: '1', manifest_version: 3 });
    // jsdom's Blob, which its FileReader reads (Node's Response makes Node's).
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ blob: async () => new Blob(['png'], { type: 'image/png' }) }) as Response);
    const gmails = document.createElement('link');
    gmails.rel = 'manifest';
    gmails.href = '/mail/manifest.json';
    document.head.append(gmails);
    const { app } = host('/mail/u/0/', true);
    app.setColor('#f0f4f9');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#f0f4f9');
    await vi.waitFor(() => expect([...document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]')].map((l) => l.href.slice(0, 5))).toEqual(['data:']));
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href;
    const manifest = JSON.parse(decodeURIComponent(href.slice(href.indexOf(',') + 1)));
    expect(manifest).toMatchObject({ name: 'Expressive Gmail', theme_color: '#f0f4f9', start_url: `${location.origin}/mail/u/0/#inbox` });
    expect(manifest.icons.map((i: { src: string }) => i.src.slice(0, 15))).toEqual(['data:image/png;', 'data:image/png;', 'data:image/png;']);
    // Stopped (switched to classic Gmail): Gmail's own manifest is back, and the URL stays where the app left it.
    history.replaceState(null, '', '/mail/u/0/#starred');
    app.release();
    expect([...document.querySelectorAll('link[rel="manifest"], meta[name="theme-color"]')]).toEqual([gmails]);
    expect(location.hash).toBe('#starred');
  });
});
