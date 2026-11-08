/** Talks to the content script hosting this frame on mail.google.com. */
const GMAIL = 'https://mail.google.com';
// The preview's stand-in host (preview/frame.html) frames the app from its own origin.
const HOST = import.meta.env.DEV && typeof location !== 'undefined' && location.protocol.startsWith('http') ? location.origin : GMAIL;

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

export function setHostFavicon(unread: number) {
  post('favicon', { unread });
}

/** Asks the host page to zoom this frame (`shared/uiScale.ts`). */
export function setHostScale(scale: number) {
  post('scale', { scale });
}

export function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Sent by the content script, shown on error screens. */
let diagLines: string[] = [];
const diagListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    const d = e.data as { source?: string; type?: string; lines?: string[] };
    if (e.source !== window.parent || d?.source !== 'better-gmail/content' || d.type !== 'diag' || !Array.isArray(d.lines)) return;
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
