/** Talks to the content script hosting this frame on mail.google.com. */
import { HOST } from './appHost';
import { startTabIconHost, type TabIconHost } from '../../shared/tab-icon-host';

function post(type: string, payload: Record<string, unknown> = {}) {
  if (window.parent === window) return false;
  window.parent.postMessage({ source: 'better-gmail/app', type, ...payload }, HOST);
  return true;
}

export function classicGmail() {
  if (!post('classic')) window.open('https://mail.google.com/mail/u/0/', '_blank', 'noopener');
}

/** Such as `#trash`. */
export function classicGmailAt(hash: string) {
  if (!post('classic', { hash })) window.open(`https://mail.google.com/mail/u/0/${hash}`, '_blank', 'noopener');
}

/** The way Gmail itself switches accounts. */
export function openAccountInTab(index: number, hash = '#inbox') {
  if (!post('open-account', { index, hash })) window.location.assign(`https://mail.google.com/mail/u/${index}/${hash}`);
}

/** Adds a line to Settings > Connection > Connection details. */
export function hostDiag(line: string) {
  post('diag', { line });
}

export function setHostTitle(title: string) {
  document.title = title;
  post('title', { title });
}

let lastIcon: string | null | undefined;
// Run on its own (the preview), the app keeps its own tab's icon the same way the host page does.
let ownIcon: TabIconHost | undefined;

/** A PNG `data:` URL, or null for Gmail's own icon. */
export function setHostFavicon(href: string | null) {
  if (href === lastIcon) return;
  lastIcon = href;
  if (!post('favicon', { href })) (ownIcon ??= startTabIconHost()).set(href);
}

let gmailIconAsk: Promise<string | null> | undefined;

/** Gmail's own icon from the host page, as a `data:` URL; null when it can't be read. */
export function hostGmailIcon(): Promise<string | null> {
  if (window.parent === window) return Promise.resolve(null);
  gmailIconAsk ??= new Promise<string | null>((resolve) => {
    const done = (href: string | null) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      // A miss is asked again next time: the page may have been offline.
      if (href === null) gmailIconAsk = undefined;
      resolve(href);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string; href?: unknown };
      if (e.source !== window.parent || e.origin !== HOST || d?.source !== 'better-gmail/content' || d.type !== 'gmail-icon') return;
      done(typeof d.href === 'string' && /^data:image\//.test(d.href) ? d.href : null);
    };
    const timer = setTimeout(() => done(null), 10_000);
    window.addEventListener('message', onMessage);
    post('gmail-icon');
  });
  return gmailIconAsk;
}

/** Asks the host page to scale this frame (`shared/uiScale.ts`). */
export function setHostScale(scale: number) {
  post('scale', { scale });
}

const OPENABLE = new Set(['http:', 'https:', 'mailto:']);

/** Many links come from mail, so only web and mail addresses open. */
export function openUrl(url: string) {
  if (!URL.canParse(url) || !OPENABLE.has(new URL(url).protocol)) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Sent by the content script, shown on error screens. */
let diagLines: string[] = [];
const diagListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    const d = e.data as { source?: string; type?: string; lines?: string[] };
    if (e.source !== window.parent || e.origin !== HOST || d?.source !== 'better-gmail/content' || d.type !== 'diag' || !Array.isArray(d.lines)) return;
    diagLines = d.lines.map(String);
    diagListeners.forEach((fn) => fn());
  });
}
export function subscribeDiagnostics(fn: () => void) {
  diagListeners.add(fn);
  return () => diagListeners.delete(fn);
}
export function getDiagnostics() {
  return diagLines;
}
