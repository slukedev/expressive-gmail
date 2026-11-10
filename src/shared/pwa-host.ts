import {
  appManifest,
  LAUNCH_PARAM,
  launchInPlace,
  manifestDataUrl,
  readLaunch,
  withoutLaunch,
  type AppHostState,
  type BadgeValue,
  type Launch,
  type ManifestIcon,
} from './pwa';

/**
 * The installed-app side of the content script. The app runs in an extension frame, but every
 * app API (install, the manifest, the badge, email links, the launch queue) belongs to the top
 * page on mail.google.com, so this script owns them and relays them to the frame.
 */

interface BeforeInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface LaunchParams {
  targetURL?: string;
  files?: readonly { kind: string; getFile?: () => Promise<File> }[];
}

type LaunchQueue = { setConsumer(fn: (params: LaunchParams) => void): void };

type Send = (message: Record<string, unknown>) => void;

export interface AppHost {
  /** Where to relay; nothing goes until the app frame says hello. */
  attach(send: Send): void;
  /** A message from the app frame; true when it was one of these. */
  handle(data: { type?: string; [k: string]: unknown }): boolean;
  /** The surface color the app paints with, for the manifest and the window's title bar. */
  setColor(background: string): void;
  /** Turned off: Gmail gets its launch URL back and the page its own manifest. */
  release(): void;
}

/**
 * Call at document start, before Gmail's scripts: a launch URL is read and cleared before
 * Gmail's page can act on it, and the browser's install offer can come early.
 */
export function startAppHost(outer: AbortSignal, options: { manifest: boolean }): AppHost {
  const stop = new AbortController();
  const signal = stop.signal;
  outer.addEventListener('abort', () => stop.abort());
  const startHref = location.href;
  const pending: (Launch & { files?: File[] })[] = [];
  const first = readLaunch(new URL(startHref));
  if (first) {
    // Files arrive through the launch queue; the URL only says they're coming.
    if (first.kind !== 'files') pending.push(first);
    history.replaceState(history.state, '', withoutLaunch(new URL(startHref)));
  }

  let send: Send | undefined;
  // Nothing goes to the frame before the app says hello: until then it's still loading.
  let heard = false;
  let prompt: BeforeInstallPrompt | undefined;
  const standaloneQuery = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)');
  const readState = (): AppHostState => ({
    installable: !!prompt,
    standalone: standaloneQuery.matches,
    badge: typeof navigator.setAppBadge === 'function',
    mailto: typeof navigator.registerProtocolHandler === 'function',
  });
  const publish = () => {
    if (heard) send?.({ type: 'app-state', state: readState() });
  };
  const flush = () => {
    if (!send || !heard) return;
    for (const launch of pending.splice(0)) send({ type: 'launch', launch });
  };
  const queue = (launch: Launch & { files?: File[] }) => {
    pending.push(launch);
    flush();
  };

  const onPrompt = (event: Event) => {
    // Kept for Settings' Install button. The address bar keeps offering it too.
    event.preventDefault();
    prompt = event as BeforeInstallPrompt;
    publish();
  };
  const onInstalled = () => {
    prompt = undefined;
    publish();
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  standaloneQuery.addEventListener('change', publish);
  signal.addEventListener('abort', () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
    standaloneQuery.removeEventListener('change', publish);
  });

  // Launches into this window: the first one is the URL it opened with, already read above.
  const launchQueue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  let firstLaunch = true;
  launchQueue?.setConsumer((params) => {
    if (signal.aborted) return;
    const opening = firstLaunch;
    firstLaunch = false;
    void readLaunchFiles(params).then((files) => {
      if (files.length) {
        queue({ kind: 'files', files });
        return;
      }
      if (!params.targetURL || (opening && params.targetURL === startHref)) return;
      const target = new URL(params.targetURL);
      const asked = launchInPlace(target, new URL(location.href));
      if (asked === 'navigate') location.assign(params.targetURL);
      else if (asked) queue(asked);
    });
  });

  const theme = document.createElement('meta');
  theme.name = 'theme-color';
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  let color = '';
  let icons: ManifestIcon[] | undefined;
  let iconsLoading: Promise<void> | undefined;
  let manifestTimer: ReturnType<typeof setTimeout> | undefined;
  // Gmail's own, put back when this stops.
  const displaced: HTMLLinkElement[] = [];
  const displace = (link: HTMLLinkElement) => {
    displaced.push(link);
    link.remove();
  };
  signal.addEventListener('abort', () => {
    clearTimeout(manifestTimer);
    theme.remove();
    manifest.remove();
    if (displaced.length) (document.head ?? document.documentElement).append(...displaced.splice(0));
  });

  const writeManifest = () => {
    manifestTimer = undefined;
    if (!icons || !color || signal.aborted) return;
    const ext = browser.runtime.getManifest();
    manifest.href = manifestDataUrl(
      appManifest({
        origin: location.origin,
        index: Number(/^\/mail\/u\/(\d{1,2})\//.exec(location.pathname)?.[1] ?? 0),
        name: ext.name,
        shortName: ext.short_name ?? ext.name,
        background: color,
        icons,
      }),
    );
    // Gmail's own manifest (if it has one) would make the installed app Gmail's.
    for (const other of document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]')) if (other !== manifest) displace(other);
    if (!manifest.isConnected) (document.head ?? document.documentElement).append(manifest);
  };
  const scheduleManifest = () => {
    if (!options.manifest) return;
    iconsLoading ??= loadIcons().then(
      (found) => {
        icons = found;
      },
      () => undefined,
    );
    clearTimeout(manifestTimer);
    // Theme changes come in bursts (a picked color, then its contrast); the manifest needn't follow each.
    void iconsLoading.then(() => {
      manifestTimer = setTimeout(writeManifest, manifest.href ? 1_000 : 0);
    });
  };

  // Gmail writes its head after this script starts; keep ours the ones that count.
  const keep = new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (n instanceof HTMLMetaElement && n.name === 'theme-color' && n !== theme && theme.isConnected) n.remove();
        if (options.manifest && n instanceof HTMLLinkElement && n.rel === 'manifest' && n !== manifest && manifest.isConnected) displace(n);
      }
  });
  keep.observe(document.documentElement, { childList: true, subtree: true });
  const stopKeeping = setTimeout(() => keep.disconnect(), 30_000);
  signal.addEventListener('abort', () => {
    keep.disconnect();
    clearTimeout(stopKeeping);
  });

  return {
    release() {
      // Off before the app ever ran: Gmail gets the URL it was opened with.
      if (first && !heard && location.href !== startHref) history.replaceState(history.state, '', startHref);
      pending.length = 0;
      send = undefined;
      stop.abort();
    },
    attach(next) {
      send = next;
    },
    setColor(background) {
      if (!/^#[0-9a-f]{3,8}$|^rgb/i.test(background) || background === color) return;
      color = background;
      // The window's title bar, in the app and in browsers that tint the tab strip.
      theme.content = background;
      for (const other of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) if (other !== theme) other.remove();
      if (!theme.isConnected) (document.head ?? document.documentElement).append(theme);
      scheduleManifest();
    },
    handle(data) {
      switch (data.type) {
        case 'app-hello':
          heard = true;
          publish();
          flush();
          return true;
        case 'app-install': {
          const asked = prompt;
          if (!asked) {
            send?.({ type: 'app-install-result', outcome: 'unavailable' });
            return true;
          }
          // The click in the frame counts as this page's too, so the browser lets it ask.
          void asked
            .prompt()
            .then(() => asked.userChoice)
            .then(
              ({ outcome }) => {
                if (outcome === 'accepted') prompt = undefined;
                send?.({ type: 'app-install-result', outcome });
                publish();
              },
              () => send?.({ type: 'app-install-result', outcome: 'unavailable' }),
            );
          return true;
        }
        case 'app-badge':
          setBadge(data.value as BadgeValue);
          return true;
        case 'app-mailto': {
          let ok = false;
          try {
            const index = /^\/mail\/u\/(\d{1,2})\//.exec(location.pathname)?.[1] ?? '0';
            navigator.registerProtocolHandler('mailto', `${location.origin}/mail/u/${index}/?${LAUNCH_PARAM}=mailto&url=%s`);
            ok = true;
          } catch {
            // Refused (no activation, or the browser has no handlers).
          }
          send?.({ type: 'app-mailto-result', ok });
          return true;
        }
      }
      return false;
    },
  };
}

function setBadge(value: BadgeValue) {
  if (typeof navigator.setAppBadge !== 'function') return;
  const done = value === null ? navigator.clearAppBadge?.() : value === 'dot' ? navigator.setAppBadge() : navigator.setAppBadge(Math.min(Math.max(0, Math.round(value)), 99_999));
  // Not an installed app's window: nothing to badge.
  void done?.catch(() => undefined);
}

async function readLaunchFiles(params: LaunchParams): Promise<File[]> {
  const handles = (params.files ?? []).filter((h) => h.kind === 'file' && typeof h.getFile === 'function');
  const files = await Promise.all(handles.map((h) => h.getFile!().catch(() => undefined)));
  return files.filter((f): f is File => !!f);
}

const ICONS: Omit<ManifestIcon, 'src'>[] = [
  { sizes: '192x192', type: 'image/png', purpose: 'any' },
  { sizes: '512x512', type: 'image/png', purpose: 'any' },
  { sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/**
 * As data: URLs. The browser fetches a manifest's icons as the page, which can't read the
 * extension's own files.
 */
async function loadIcons(): Promise<ManifestIcon[]> {
  const files = ['/icon/192.png', '/icon/512.png', '/icon/maskable-512.png'] as const;
  const urls = await Promise.all(
    files.map(async (file) => {
      const blob = await (await fetch(browser.runtime.getURL(file))).blob();
      return new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }),
  );
  return ICONS.map((icon, i) => ({ ...icon, src: urls[i] }));
}
