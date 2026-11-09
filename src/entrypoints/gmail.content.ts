import { createSessionBackend } from '../session';
import { GmailPage } from '../session/gmail-page';
import { GmailGemini } from '../session/gemini-page';
import { accountIndexFromPath, readGlobalsFromDocument } from '../session/account';
import { discoverAccounts, readProfiles, slotsToRemember, unreadCounts } from '../session/accounts';
import { getDefaultStore } from '../session/session';
import { SESSIONS_KEY, storedTokenSource, withSession, type StoredSessions } from '../session/stored';
import { serveAccounts, type SignedInAccount } from '../shared/accounts-rpc';
import { startSafariTokens } from '../shared/safari-main';
import { exposeBackend } from '../shared/rpc';
import { FRAME_STYLE } from '../shared/frame';
import { ACCOUNT_PROFILES_KEY, BOOT_CACHE_KEY } from '../app/data/cacheKeys';
import { FRAME_BG_KEY, pickFrameBg } from '../shared/boot-theme';
import { switchRequest } from '../shared/switch-link';
import { mountReturnButton } from '../shared/return-button';
import { mergeProbe, PROBE_KEY, probeDom, type ProbeRecord } from '../session/photoProbe';
import { desktopGmailUrl } from '../shared/mobile';
import { fitsDelegated, takesOver } from '../shared/takeover';
import { discoverDelegated } from '../session/delegated';
import type { DelegatedMailbox } from '../shared/accounts-rpc';
import { applyFrameScale, readHostUiScale, serveFrameScale } from '../shared/uiScale';

// Gmail keeps running hidden underneath so its session stays alive; the app runs in an
// extension frame on top and reaches mail through a MessagePort this script hands it.
const CLASSIC_KEY = 'better-gmail:classic';
const RETURN_HIDDEN_KEY = 'better-gmail:return-hidden';
const RETURN_HIDDEN_STORE = 'bg.returnHidden';
// When this tab last tried desktop Gmail, so a server that sends it straight back isn't asked again.
const DESKTOP_TRIED_KEY = 'better-gmail:desktop-tried';
const APP_SOURCE = 'better-gmail/app';

export default defineContentScript({
  matches: ['https://mail.google.com/mail/*'],
  runAt: 'document_start',
  allFrames: false,
  main(ctx) {
    const here = new URL(location.href);
    if (!takesOver(here, window.top === window)) {
      // Phones are served desktop Gmail here too, which has no viewport of its own.
      if (fitsDelegated(here, window.top === window, navigator.userAgent)) fitViewport(ctx.signal);
      return;
    }
    // Opened by the Mac app's switch: remember the choice, then carry on as a plain inbox.
    const wanted = switchRequest(location.hash, document.referrer);
    let applied: Promise<unknown> = Promise.resolve();
    if (wanted !== null) {
      history.replaceState(history.state, '', '#inbox');
      sessionStorage.removeItem(CLASSIC_KEY);
      applied = browser.storage.local
        .set({ 'bg.enabled': wanted })
        .then(() => browser.runtime.sendMessage({ type: 'reload-gmail-tabs' }))
        .catch(() => undefined);
    }
    const classic = sessionStorage.getItem(CLASSIC_KEY) === '1';
    // Mobile Gmail has nothing to run on.
    const desktop = desktopGmailUrl(new URL(location.href));
    if (desktop) {
      if (!classic) leaveMobileGmail(desktop, applied);
      return;
    }
    startPhotoProbe(classic, ctx.signal);
    if (classic) {
      showReturnButton('tab');
      return;
    }

    if (import.meta.env.BROWSER === 'safari') startSafariTokens(diag);

    const hide = document.createElement('style');
    hide.id = 'better-gmail-hide';
    const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const { background: bg, dark } = frameBackground(systemDark);
    // Gmail's body paints its own (white) background over html's; clear it too.
    // html doesn't scroll either, or a phone pans Gmail's wide page behind the app.
    hide.textContent = `html{background:${bg}!important;color-scheme:${dark ? 'dark' : 'light'}!important;overflow:hidden!important;overscroll-behavior:none!important}body{background:none!important}body>*{visibility:hidden!important}body{overflow:hidden!important}`;
    // Hidden isn't enough: Gmail keeps laying out and animating under the app, and Safari runs
    // that on the app frame's thread. Skip rendering it; GmailPage wakes it while it steers Gmail.
    const rest = document.createElement('style');
    rest.id = 'better-gmail-rest';
    rest.textContent = 'body>*{content-visibility:hidden!important}';
    document.documentElement.append(hide, rest);
    const viewport = fitViewport(ctx.signal);
    // Updated or removed under an open tab, the app frame goes blank: give the tab back to Gmail.
    // WXT's interval is what notices the loss and aborts the context.
    ctx.onInvalidated(() => {
      hide.remove();
      rest.remove();
      document.getElementById('better-gmail-root')?.remove();
    });
    ctx.setInterval(() => undefined, 3_000);

    void applied.then(() => browser.storage.local.get('bg.enabled')).then(({ ['bg.enabled']: enabled }) => {
      if (enabled === false) {
        hide.remove();
        rest.remove();
        viewport.remove();
        // Turned off: don't keep a copy of the inbox or any saved session around.
        void browser.storage.local.remove([BOOT_CACHE_KEY, SESSIONS_KEY]);
        showReturnButton('off');
        return;
      }
      // So the way back shows the next time it's turned off.
      void browser.storage.local.remove(RETURN_HIDDEN_STORE);
      mount(bg, systemDark, hide, rest, viewport, ctx.signal);
    });
  },
});

function mount(bg: string, systemDark: boolean, hide: HTMLStyleElement, rest: HTMLStyleElement, viewport: { remove(): void }, signal: AbortSignal) {
  const extOrigin = new URL(browser.runtime.getURL('/')).origin;
  const host = document.createElement('div');
  host.id = 'better-gmail-root';
  // The safe area (a phone's notch and home indicator) is padded here: inside the frame env() reads zero.
  host.style.cssText = `position:fixed;inset:0;z-index:2147483646;background:${bg};visibility:visible;box-sizing:border-box;overflow:clip;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);`;
  const frame = document.createElement('iframe');
  // The frame can't always see the system scheme at first paint; tell it.
  frame.src = `${browser.runtime.getURL('/app.html')}?dark=${systemDark ? 1 : 0}${mapHash(location.hash)}`;
  frame.title = 'Gmail';
  frame.allow = 'clipboard-read; clipboard-write; fullscreen';
  frame.style.cssText = FRAME_STYLE;
  applyFrameScale(frame, readHostUiScale());
  host.append(frame);
  document.documentElement.append(host);
  followKeyboard(host, signal);

  // One backend for the page's lifetime, so a reloaded app frame keeps its caches. Gmail's hidden
  // page does what the sync endpoints can't (delete forever, schedule send, Gemini).
  const page = new GmailPage({
    wake: () => {
      rest.media = 'not all';
      return () => {
        rest.media = '';
      };
    },
  });
  const backend = createSessionBackend({
    page,
    gemini: new GmailGemini({ page, diagnostic: diag }),
    diagnostic: diag,
    fetchPhoto: async (url) => ((await browser.runtime.sendMessage({ type: 'photo', url })) as { data?: string } | undefined)?.data,
  });
  let stopServing: (() => void) | undefined;
  let stopAccounts: (() => void) | undefined;
  const accounts = accountsService(backend);
  shareSession();
  let wantedTitle = '';
  const titleObserver = new MutationObserver(() => {
    if (wantedTitle && document.title !== wantedTitle) document.title = wantedTitle;
  });

  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== extOrigin) return;
    const data = event.data as { source?: string; type?: string; [k: string]: unknown };
    if (data?.source !== APP_SOURCE) return;
    switch (data.type) {
      case 'ready': {
        // A reloaded frame says "ready" again; only its new port is served.
        diag('app connected');
        const channel = new MessageChannel();
        const accountsChannel = new MessageChannel();
        stopServing?.();
        stopAccounts?.();
        // The frame that opened other accounts is gone.
        accounts.closeAll();
        stopServing = exposeBackend(channel.port1, backend);
        stopAccounts = serveAccounts(accountsChannel.port1, accounts);
        frame.contentWindow!.postMessage({ source: 'better-gmail/content', type: 'port' }, extOrigin, [channel.port2, accountsChannel.port2]);
        postScheme();
        frame.focus();
        break;
      }
      case 'route':
        if (typeof data.hash === 'string') history.replaceState(history.state, '', data.hash);
        break;
      case 'diag':
        if (typeof data.line === 'string') diag(`app: ${data.line.slice(0, 300)}`);
        break;
      case 'title':
        if (typeof data.title === 'string') {
          wantedTitle = data.title;
          document.title = wantedTitle;
          const el = document.querySelector('title');
          if (el) titleObserver.observe(el, { childList: true, characterData: true, subtree: true });
        }
        break;
      case 'favicon':
        setFavicon(Number(data.unread) || 0);
        break;
      case 'scale':
        serveFrameScale(frame, data.scale);
        break;
      case 'theme':
        if (typeof data.background === 'string') {
          host.style.background = data.background;
          localStorage.setItem(
            FRAME_BG_KEY,
            JSON.stringify({ background: data.background, light: data.light, dark: data.dark, system: data.system, isDark: data.isDark }),
          );
        }
        break;
      case 'open-account':
        if (Number.isInteger(data.index) && (data.index as number) >= 0) {
          const hash = typeof data.hash === 'string' && data.hash.startsWith('#') ? data.hash : '#inbox';
          location.assign(`/mail/u/${data.index}/${hash}`);
        }
        break;
      case 'classic':
        sessionStorage.setItem(CLASSIC_KEY, '1');
        sessionStorage.removeItem(RETURN_HIDDEN_KEY);
        void browser.storage.local.remove(BOOT_CACHE_KEY);
        host.remove();
        hide.remove();
        rest.remove();
        viewport.remove();
        titleObserver.disconnect();
        if (typeof data.hash === 'string' && /^#[\w/-]+$/.test(data.hash)) {
          // The app's routes reach this URL by replaceState, which Gmail never sees; clear it so Gmail gets a real hashchange.
          history.replaceState(history.state, '', '#');
          location.hash = data.hash;
        }
        showReturnButton('tab');
        break;
    }
  };
  window.addEventListener('message', onMessage);
  // Some engines don't pass the system scheme into extension frames; relay the top document's.
  const schemeQuery = matchMedia('(prefers-color-scheme: dark)');
  const postScheme = () =>
    frame.contentWindow?.postMessage({ source: 'better-gmail/content', type: 'scheme', dark: schemeQuery.matches }, extOrigin);
  schemeQuery.addEventListener('change', postScheme);
  // Not every backend asks for the session port, so also say it once the frame loads.
  frame.addEventListener('load', postScheme);
  signal.addEventListener('abort', () => {
    window.removeEventListener('message', onMessage);
    schemeQuery.removeEventListener('change', postScheme);
  });

  const onRuntimeMessage = (message: { type?: string; threadId?: string }) => {
    if (message?.type === 'open-thread' && message.threadId) {
      frame.contentWindow?.postMessage({ source: 'better-gmail/content', type: 'open-thread', threadId: message.threadId }, extOrigin);
    }
  };
  browser.runtime.onMessage.addListener(onRuntimeMessage);
  signal.addEventListener('abort', () => {
    browser.runtime.onMessage.removeListener(onRuntimeMessage);
    accounts.closeAll();
  });
}

/** Saves this account's session whenever Gmail refreshes it, so pages of other accounts can read this one. */
function shareSession() {
  const store = getDefaultStore();
  let saving = Promise.resolve();
  let said = false;
  const save = () => {
    const tokens = { ...store.current()!, email: store.current()?.email ?? readGlobalsFromDocument(document).email };
    saving = saving.then(async () => {
      const { [SESSIONS_KEY]: sessions } = await browser.storage.local.get(SESSIONS_KEY);
      const next = withSession(sessions as StoredSessions | undefined, tokens);
      if (!next) return;
      await browser.storage.local.set({ [SESSIONS_KEY]: next });
      // Gmail renews its tokens every few seconds; log once.
      if (!said) diag(`saved this account's session for All inboxes and circles (${tokens.email})`);
      said = true;
    }).catch(() => undefined);
  };
  store.onChange(save);
  if (store.current()) save();
}

/** How long a saved session counts as an account still signed in here, when Google's account list can't say. */
const SAVED_ACCOUNT_MS = 14 * 24 * 60 * 60 * 1000;

async function savedAccounts(): Promise<number> {
  const stored: Record<string, unknown> = await browser.storage.local.get(SESSIONS_KEY).catch(() => ({}));
  const sessions = (stored[SESSIONS_KEY] ?? {}) as StoredSessions;
  return Object.values(sessions).filter((t) => Date.now() - (t.capturedAt ?? 0) < SAVED_ACCOUNT_MS).length;
}

// Slots the last account walk found. Kept in Gmail's site storage, which an extension update or
// reinstall never clears (Safari can drop the extension's storage then).
const KNOWN_SLOTS_KEY = 'better-gmail:signed-in-slots';

function knownSlots(): number {
  try {
    const n = Number(localStorage.getItem(KNOWN_SLOTS_KEY));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function accountsService(backend: { accountHint?(): Promise<string | undefined> }) {
  const homeIndex = accountIndexFromPath(location.pathname);
  let listed: { at: number; accounts: Promise<SignedInAccount[]> } | undefined;
  // The first empty slot. Its feed answers 401 with a Basic challenge, which Safari turns into a
  // blocking "Sign in to mail.google.com" prompt, so it's never asked again this page.
  // Gmail reloads when an account is added, which starts the count over.
  let emptyFrom = Infinity;
  const homeEmail = async () => (await backend.accountHint?.().catch(() => undefined)) ?? readGlobalsFromDocument(document).email;
  // Google's own account list says how many slots are signed in, so the walk never reaches an empty one.
  // Without that list, only this tab's own slot is read: a missing account beats a password prompt.
  const signedIn = async (): Promise<{ count: number; definite: boolean }> => {
    const res = (await browser.runtime.sendMessage({ type: 'list-accounts' }).catch(() => undefined)) as
      | { ok: true; accounts: Record<string, unknown>; slots?: number }
      | { ok: false }
      | undefined;
    if (res?.ok) return { count: res.slots ?? Object.keys(res.accounts).length, definite: true };
    // Safari often can't read that list. Recently saved sessions and the last walk are likely still signed in.
    const saved = await savedAccounts().catch(() => 0);
    const count = Math.max(saved, knownSlots());
    diag(`account list unavailable: reading ${count > 1 ? `the ${count} accounts found here lately` : 'only this tab’s account'}`);
    return { count, definite: false };
  };
  // Slots the last walk found an account in; unread counts only ever read these.
  let confirmed = new Set<number>([homeIndex]);
  let delegated: { at: number; list: Promise<DelegatedMailbox[]>; empty: boolean } | undefined;
  // By slot, so a reloaded app doesn't leave them running.
  const served = new Map<number, () => void>();
  const list = () => {
    // The listing reads one small feed per account; reuse it briefly.
    if (!listed || Date.now() - listed.at > 20_000) {
      const accounts = Promise.all([homeEmail(), signedIn()]).then(async ([email, { count, definite }]) => {
        const limit = Math.min(emptyFrom, Math.max(count, homeIndex + 1));
        let failed = false;
        const found = await discoverAccounts(fetch.bind(window), location.origin, { index: homeIndex, email }, limit, () => (failed = true));
        confirmed = new Set(found.map((a) => a.index));
        // Fewer than allowed means the walk stopped at an empty slot. A slot that failed to read
        // proves nothing, so neither the stop nor the count is kept from that walk.
        const next = Math.max(-1, ...found.map((a) => a.index)) + 1;
        if (failed) diag('an account feed failed to load; it is listed again on the next update');
        else if (next < limit && navigator.onLine) emptyFrom = next;
        if (navigator.onLine && !failed) {
          try {
            localStorage.setItem(KNOWN_SLOTS_KEY, String(slotsToRemember(next, limit, knownSlots(), definite)));
          } catch {
            // Site storage blocked: the next update lists only what the extension's own storage remembers.
          }
        }
        return found;
      });
      listed = { at: Date.now(), accounts };
      accounts.catch(() => (listed = undefined));
    }
    return listed.accounts;
  };
  return {
    list,
    async unread(indices: number[]) {
      // A slot saved earlier may have been signed out since; its feed would prompt for a password.
      await list().catch(() => undefined);
      return unreadCounts(fetch.bind(window), location.origin, indices.filter((i) => confirmed.has(i)));
    },
    async profiles(accounts: { index: number; email: string }[]) {
      const found: Record<number, { name?: string; photoUrl?: string }> = {};
      // Google's account list first (one request for all), then each account's own page.
      const listed = (await browser.runtime.sendMessage({ type: 'list-accounts' }).catch((err: unknown) => ({ ok: false, error: String((err as Error)?.message ?? err) }))) as
        | { ok: true; accounts: Record<string, { name?: string; photoUrl?: string }> }
        | { ok: false; error?: string }
        | undefined;
      if (listed?.ok) {
        for (const a of accounts) {
          const p = listed.accounts[a.email.toLowerCase()];
          if (p) found[a.index] = p;
        }
        diag(`account list: ${Object.keys(listed.accounts).length} accounts, ${accounts.filter((a) => found[a.index]?.photoUrl).length} of ${accounts.length} photos`);
      } else diag(`account list unavailable: ${listed?.error ?? 'no answer'}`);
      const rest = accounts.filter((a) => !found[a.index]?.photoUrl);
      if (rest.length) Object.assign(found, await readProfiles(fetch.bind(window), location.origin, rest));
      for (const a of rest) diag(`profile for /u/${a.index}: ${found[a.index]?.photoUrl ? 'photo found' : 'no photo'}`);
      return found;
    },
    async open(index: number, email: string) {
      if (index === homeIndex) throw new Error('This tab already has that account open');
      const read = async () => (await browser.storage.local.get(SESSIONS_KEY))[SESSIONS_KEY] as StoredSessions | undefined;
      const saved = (await read())?.[email.trim().toLowerCase()];
      if (!saved) {
        diag(`/u/${index}: no saved session yet; open that account once`);
        throw new Error(`Open ${email} once in this browser so Expressive Gmail can read it from here.`);
      }
      const profiles = ((await browser.storage.local.get(ACCOUNT_PROFILES_KEY))[ACCOUNT_PROFILES_KEY] ?? {}) as Record<string, { name?: string; photoUrl?: string }>;
      const remote = createSessionBackend({
        tokens: storedTokenSource(email, index, read, saved),
        elsewhere: profiles[email.trim().toLowerCase()] ?? {},
        diagnostic: (line) => diag(`/u/${index}: ${line}`),
      });
      const channel = new MessageChannel();
      served.get(index)?.();
      served.set(index, exposeBackend(channel.port1, remote));
      diag(`/u/${index}: reading with its saved session`);
      return channel.port2;
    },
    delegated() {
      // Read once Gmail is idle; a page that listed none may just not have drawn its switcher yet.
      if (!delegated || (delegated.empty && Date.now() - delegated.at > 60_000)) {
        const me = Promise.all([homeEmail(), list().catch(() => [])]).then(([home, all]) => [home, ...all.map((a) => a.email)]);
        const found = whenIdle()
          .then(() => discoverDelegated(document, me))
          .catch(() => [] as DelegatedMailbox[]);
        const entry = { at: Date.now(), list: found, empty: false };
        void found.then((d) => {
          entry.empty = !d.length;
          diag(`delegated mailboxes: ${d.length}`);
        });
        delegated = entry;
      }
      return delegated.list;
    },
    closeAll() {
      for (const stop of served.values()) stop();
      served.clear();
    },
  };
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => resolve(), { timeout: 3_000 }) : setTimeout(resolve, 500));
    if (document.readyState === 'complete') done();
    else window.addEventListener('load', done, { once: true });
  });
}

/**
 * Off to desktop Gmail, once: if its server sends this tab straight back here, the browser
 * couldn't ask for it (src/shared/mobile.ts), and mobile Gmail stays as it is.
 */
function leaveMobileGmail(desktop: string, applied: Promise<unknown>) {
  let tried: number;
  try {
    tried = Number(sessionStorage.getItem(DESKTOP_TRIED_KEY)) || 0;
  } catch {
    // Site storage blocked: no record, so no second try either.
    tried = Date.now();
  }
  if (Date.now() - tried < 60_000) {
    diag('Gmail sent its mobile version again; leaving it as it is');
    return;
  }
  void applied.then(() => browser.storage.local.get('bg.enabled')).then(({ ['bg.enabled']: enabled }) => {
    if (enabled === false) return;
    try {
      sessionStorage.setItem(DESKTOP_TRIED_KEY, String(Date.now()));
    } catch {
      return;
    }
    location.replace(desktop);
  }, () => undefined);
}

/**
 * Gmail's desktop page has no viewport of its own, so a phone lays it out as a wide, zoomed-out page,
 * and the app over it with it. Desktop browsers ignore this. iOS also zooms the page into any
 * small text field it focuses, which a maximum scale of 1 stops there (pinch zoom still works).
 */
function fitViewport(signal: AbortSignal): { remove(): void } {
  const meta = document.createElement('meta');
  meta.name = 'viewport';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  meta.content = `width=device-width, initial-scale=1, viewport-fit=cover${ios ? ', maximum-scale=1' : ''}`;
  // The last viewport tag wins; keep ours last if Gmail adds one.
  const place = () => {
    const all = document.querySelectorAll('meta[name="viewport"]');
    if (all[all.length - 1] !== meta) (document.head ?? document.documentElement).append(meta);
  };
  place();
  const observer = new MutationObserver((records) => {
    if (records.some((r) => [...r.addedNodes].some((n) => n instanceof HTMLMetaElement && n.name === 'viewport' && n !== meta))) place();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Gmail's head is written in the first moments; after that there's nothing to watch.
  const stop = setTimeout(() => observer.disconnect(), 30_000);
  const remove = () => {
    observer.disconnect();
    clearTimeout(stop);
    meta.remove();
  };
  signal.addEventListener('abort', remove);
  return { remove };
}

/**
 * Keeps the app above an on-screen keyboard. On iOS the keyboard covers the page instead of
 * resizing it, and the frame can't see that; the top page's visual viewport can. Left alone
 * while the page is pinch-zoomed, so zoom still magnifies instead of reflowing.
 */
function followKeyboard(host: HTMLElement, signal: AbortSignal) {
  const vv = window.visualViewport;
  if (!vv) return;
  let frame = 0;
  const fit = () => {
    frame = 0;
    const zoomed = Math.abs(vv.scale - 1) > 0.01;
    const covered = !zoomed && window.innerHeight - vv.height > 1;
    // Back to inset 0 when uncovered: clearing these would drop the edges the host is pinned to.
    host.style.top = covered ? `${vv.offsetTop}px` : '0';
    host.style.bottom = covered ? 'auto' : '0';
    host.style.height = covered ? `${vv.height}px` : '';
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(fit);
  };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  signal.addEventListener('abort', () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    cancelAnimationFrame(frame);
  });
}

function frameBackground(systemDark: boolean) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(FRAME_BG_KEY);
  } catch {
    // Site data blocked: fall back to the system scheme.
  }
  return pickFrameBg(raw, systemDark);
}

/** Breadcrumbs for the "Couldn't connect" screen. */
const diagnostics: string[] = [];
let appOrigin: string | undefined;
function diag(line: string) {
  diagnostics.push(`${new Date().toLocaleTimeString()} ${line}`);
  if (diagnostics.length > 150) diagnostics.shift();
  try {
    appOrigin ??= new URL(browser.runtime.getURL('/')).origin;
  } catch {
    // The extension is gone (updated or removed); nobody is listening.
    return;
  }
  document.getElementById('better-gmail-root')?.querySelector('iframe')?.contentWindow?.postMessage(
    { source: 'better-gmail/content', type: 'diag', lines: diagnostics },
    appOrigin,
  );
}

// Gmail's #inbox/FMfcg... hashes pass straight through; ours use the same scheme.
function mapHash(hash: string) {
  return hash && hash !== '#' ? hash : '#inbox';
}

let faviconLink: HTMLLinkElement | null = null;
function setFavicon(unread: number) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = '#0b57d0';
  g.beginPath();
  g.roundRect(4, 4, 56, 56, 18);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.lineJoin = 'round';
  g.strokeRect(15, 20, 34, 24);
  g.beginPath();
  g.moveTo(16, 22);
  g.lineTo(32, 34);
  g.lineTo(48, 22);
  g.stroke();
  if (unread > 0) {
    const text = unread > 99 ? '99+' : String(unread);
    g.font = 'bold 26px system-ui, sans-serif';
    const w = Math.max(30, g.measureText(text).width + 14);
    g.fillStyle = '#b3261e';
    g.beginPath();
    g.roundRect(size - w, 0, w, 30, 15);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, size - w / 2, 16);
  }
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l !== faviconLink && l.remove());
  if (!faviconLink) {
    faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    document.head?.append(faviconLink);
  }
  faviconLink.href = canvas.toDataURL('image/png');
}

/** "tab": switched to classic for this tab. "off": turned off from the toolbar. Hiding lasts as long as that choice. */
function showReturnButton(mode: 'tab' | 'off') {
  const show = (hidden: boolean) => {
    if (hidden) return;
    mountReturnButton({
      onSwitch: () => {
        sessionStorage.removeItem(CLASSIC_KEY);
        sessionStorage.removeItem(RETURN_HIDDEN_KEY);
        if (mode === 'tab') return location.reload();
        void browser.storage.local
          .set({ 'bg.enabled': true })
          .then(() => browser.runtime.sendMessage({ type: 'reload-gmail-tabs' }))
          .catch(() => undefined)
          .finally(() => location.reload());
      },
      onDismiss: () => {
        if (mode === 'tab') sessionStorage.setItem(RETURN_HIDDEN_KEY, '1');
        else void browser.storage.local.set({ [RETURN_HIDDEN_STORE]: true });
      },
    });
  };
  if (mode === 'tab') show(sessionStorage.getItem(RETURN_HIDDEN_KEY) === '1');
  else void browser.storage.local.get(RETURN_HIDDEN_STORE).then((s) => show(s[RETURN_HIDDEN_STORE] === true), () => show(false));
}

/** Logs where Gmail's sender pictures come from, for the Photos log. Domains and image shapes only. */
function startPhotoProbe(classic: boolean, signal: AbortSignal) {
  let queue: ProbeRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    const found = queue;
    queue = [];
    void browser.storage.local
      .get(PROBE_KEY)
      .then((s) => {
        const saved = (s[PROBE_KEY] as ProbeRecord[] | undefined) ?? [];
        const next = mergeProbe(saved, found);
        if (next !== saved) return browser.storage.local.set({ [PROBE_KEY]: next });
      })
      .catch(() => undefined);
  };
  const add = (records: ProbeRecord[]) => {
    if (!records.length) return;
    queue.push(...records);
    timer ??= setTimeout(save, 2_000);
  };
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { source?: string; type?: string; records?: unknown };
    if (event.source !== window || data?.source !== 'better-gmail/main' || data.type !== 'photo-probe' || !Array.isArray(data.records)) return;
    add(data.records.filter((r): r is ProbeRecord => !!r && typeof r.who === 'string' && typeof r.image === 'string' && typeof r.where === 'string'));
  };
  window.addEventListener('message', onMessage);
  const stop = setTimeout(() => window.removeEventListener('message', onMessage), 20 * 60_000);
  signal.addEventListener('abort', () => {
    window.removeEventListener('message', onMessage);
    clearTimeout(stop);
  });
  if (!classic) return;
  // Safari has no main-world content script: classic Gmail needs the hook injected to see responses.
  if (import.meta.env.BROWSER === 'safari') void browser.runtime.sendMessage({ type: 'inject-main' }).catch(() => undefined);
  let scan: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    scan ??= setTimeout(() => {
      scan = undefined;
      add(probeDom(document));
    }, 1_500);
  });
  const start = () => observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  setTimeout(() => observer.disconnect(), 20 * 60_000);
  signal.addEventListener('abort', () => observer.disconnect());
}
