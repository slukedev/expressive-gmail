/** The way back from classic Gmail, in Gmail's own style. A closed shadow root on <html> keeps Gmail's styles out, and it puts itself back if removed. */
export interface ReturnButtonOptions {
  onSwitch: () => void;
  onDismiss: () => void;
}

export const RETURN_HOST_ID = 'better-gmail-return';

// Material Icons "mail" and "close" (Apache 2.0).
const MAIL = 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z';
const CLOSE = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

// Built node by node: Gmail enforces Trusted Types, so no HTML strings.
function icon(doc: Document, d: string, size: number) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

// Gmail's Compose button colors (its primary container), light and dark.
const STYLE = `
:host { all: initial; }
.fab {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 999;
  display: flex;
  align-items: center;
  height: 48px;
  border-radius: 16px;
  background: #c2e7ff;
  color: #001d35;
  box-shadow: 0 1px 2px rgb(0 0 0 / .3), 0 1px 3px 1px rgb(0 0 0 / .15);
  font: 500 14px/20px "Google Sans", "Google Sans Text", Roboto, Arial, sans-serif;
  letter-spacing: .1px;
  animation: in 300ms cubic-bezier(.05, .7, .1, 1);
  transition: box-shadow 150ms;
}
.fab:hover { box-shadow: 0 1px 3px rgb(0 0 0 / .3), 0 4px 8px 3px rgb(0 0 0 / .15); }
.fab[data-dark] { background: #004a77; color: #c2e7ff; }
button {
  all: unset;
  position: relative;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: inherit;
}
button::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: currentColor;
  opacity: 0;
  transition: opacity 150ms;
}
button:hover::before { opacity: .08; }
button:active::before { opacity: .1; }
button:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.go { gap: 8px; height: 100%; padding: 0 12px 0 14px; border-radius: 16px 4px 4px 16px; }
.hide { width: 36px; height: 100%; justify-content: center; border-radius: 4px 16px 16px 4px; opacity: .8; }
.cut { width: 1px; height: 24px; background: currentColor; opacity: .16; }
@keyframes in { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .fab { animation-duration: 1ms; } }
@media print { .fab { display: none; } }
`;

/** A dark Gmail theme paints the body dark. */
export function gmailLooksDark(doc: Document = document): boolean {
  const bg = doc.body ? getComputedStyle(doc.body).backgroundColor : '';
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(bg);
  if (!m || m[4] === '0') return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 110;
}

let current: (() => void) | undefined;

/** Returns a function that removes it for good. */
export function mountReturnButton({ onSwitch, onDismiss }: ReturnButtonOptions, doc: Document = document): () => void {
  current?.();
  doc.getElementById(RETURN_HOST_ID)?.remove();
  const host = doc.createElement('div');
  host.id = RETURN_HOST_ID;
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const fab = doc.createElement('div');
  fab.className = 'fab';
  fab.setAttribute('role', 'group');
  fab.setAttribute('aria-label', 'Expressive Gmail');
  const go = doc.createElement('button');
  go.type = 'button';
  go.className = 'go';
  const label = doc.createElement('span');
  label.textContent = 'Switch to Expressive';
  go.append(icon(doc, MAIL, 20), label);
  const cut = doc.createElement('span');
  cut.className = 'cut';
  const hide = doc.createElement('button');
  hide.type = 'button';
  hide.className = 'hide';
  hide.setAttribute('aria-label', 'Hide this button');
  hide.title = 'Hide';
  hide.append(icon(doc, CLOSE, 18));
  fab.append(go, cut, hide);
  root.append(style, fab);

  const paint = () => fab.toggleAttribute('data-dark', gmailLooksDark(doc));
  let removed = false;
  // Gmail swaps its theme and rebuilds its page without reloading.
  const keep = new MutationObserver(() => {
    if (removed) return;
    if (!host.isConnected) doc.documentElement.append(host);
    paint();
  });
  const stop = () => {
    if (current === stop) current = undefined;
    removed = true;
    keep.disconnect();
    host.remove();
  };
  go.addEventListener('click', () => onSwitch());
  hide.addEventListener('click', () => {
    stop();
    onDismiss();
  });

  const attach = () => {
    if (removed) return;
    doc.documentElement.append(host);
    paint();
    keep.observe(doc.documentElement, { childList: true });
    if (doc.body) keep.observe(doc.body, { attributes: true, attributeFilter: ['class', 'style'] });
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
  current = stop;
  return stop;
}
