/**
 * Keeps the tab's icon the one the app drew, on the top page. Gmail writes its own icon links
 * whenever it likes (at load, and as its unread count changes); each one is taken out and kept,
 * so handing the tab back puts Gmail's latest icon back exactly as Gmail left it.
 */

export interface TabIconHost {
  /** A PNG `data:` URL, or null for Gmail's own icon. */
  set(href: string | null): void;
  /** Gmail's current icon as a `data:` URL, for drawing a count on; null when there isn't one to read. */
  gmailIcon(): Promise<string | null>;
  /** Gmail's icon back, and no more watching. */
  release(): void;
}

const MAX_HREF = 256 * 1024;
const MAX_GMAIL_ICON_BYTES = 256 * 1024;
// Something rewriting the icon this often is fighting back; stop until the next change of ours.
const MAX_FIXES = 20;
const FIX_WINDOW_MS = 2_000;

export function isTabIconHref(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_HREF && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value);
}

export function startTabIconHost(doc: Document = document, fetchIcon: typeof fetch = fetch.bind(globalThis)): TabIconHost {
  let wanted: string | null = null;
  let ours: HTMLLinkElement | null = null;
  // Gmail's, latest last, one per size and type: a newer one for the same slot replaces the older.
  const gmail = new Map<string, HTMLLinkElement>();
  let fixes: number[] = [];
  let released = false;
  const gmailIcons = new Map<string, Promise<string | null>>();

  const slot = (l: HTMLLinkElement) => `${l.rel.toLowerCase()}|${l.getAttribute('sizes') ?? ''}|${l.type}`;
  const head = () => doc.head ?? doc.documentElement;

  const keep = (link: HTMLLinkElement) => {
    const key = slot(link);
    gmail.delete(key);
    gmail.set(key, link);
    link.remove();
  };

  const enforce = () => {
    if (wanted === null || released) return;
    let changed = false;
    for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon" i]')) {
      if (link === ours) continue;
      keep(link);
      changed = true;
    }
    if (!ours || !ours.isConnected || ours.getAttribute('href') !== wanted || ours.rel !== 'icon') {
      // A new element each time: Safari keeps showing an icon whose link only changed its href.
      const next = doc.createElement('link');
      next.rel = 'icon';
      next.type = 'image/png';
      next.href = wanted;
      ours?.remove();
      head().append(next);
      ours = next;
      changed = true;
    }
    if (!changed) return;
    const now = Date.now();
    fixes = fixes.filter((t) => now - t < FIX_WINDOW_MS);
    fixes.push(now);
    if (fixes.length > MAX_FIXES) observer.disconnect();
  };

  const observer = new MutationObserver((records) => {
    const touchesIcons = records.some((r) =>
      r.type === 'attributes' ? r.target instanceof HTMLLinkElement : [...r.addedNodes, ...r.removedNodes].some((n) => n instanceof HTMLLinkElement),
    );
    if (touchesIcons) enforce();
  });
  const watch = () => {
    observer.disconnect();
    observer.observe(head(), { childList: true, subtree: true, attributes: true, attributeFilter: ['rel', 'href'] });
  };

  const giveBack = () => {
    observer.disconnect();
    ours?.remove();
    ours = null;
    const links = [...gmail.values()];
    gmail.clear();
    for (const link of links) if (!link.isConnected) head().append(link);
  };

  return {
    set(href) {
      // Only a PNG data: URL drawn by the app, whatever the caller checked.
      if (released || href === wanted || (href !== null && !isTabIconHref(href))) return;
      wanted = href;
      if (href === null) {
        giveBack();
        return;
      }
      fixes = [];
      enforce();
      watch();
    },
    gmailIcon() {
      const candidates = [...gmail.values(), ...doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon" i]')].filter((l) => l !== ours && /^https?:/.test(l.href));
      // The largest PNG scales down best; Gmail's .ico holds several sizes.
      const size = (l: HTMLLinkElement) => Math.max(0, ...(l.getAttribute('sizes') ?? '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0));
      const best = candidates.sort((a, b) => Number(b.type === 'image/png') - Number(a.type === 'image/png') || size(b) - size(a))[0];
      if (!best) return Promise.resolve(null);
      const href = best.href;
      let loading = gmailIcons.get(href);
      if (!loading) {
        loading = fetchIcon(href, { credentials: 'omit' })
          .then(async (res) => {
            const blob = res.ok ? await res.blob() : null;
            if (!blob || !/^image\/[\w.+-]+$/.test(blob.type) || blob.size > MAX_GMAIL_ICON_BYTES) return null;
            return `data:${blob.type};base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`;
          })
          .catch(() => null);
        // Offline now needn't mean offline for good.
        void loading.then((url) => url === null && gmailIcons.delete(href));
        gmailIcons.set(href, loading);
      }
      return loading;
    },
    release() {
      if (released) return;
      giveBack();
      wanted = null;
      released = true;
    },
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
