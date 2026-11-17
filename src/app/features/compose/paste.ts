import DOMPurify from 'dompurify';
import { withoutRemoteUrls } from '../../lib/sanitize';

const TAGS = ['a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'p', 'br', 'div', 'span', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'pre', 'code', 'img', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'font'];

/** Formatting, links and pictures by address. */
export const INSERT_CONFIG = {
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'colspan', 'rowspan', 'color', 'size', 'class', 'data-smartmail'],
};

const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;

// Quoted mail lands in the app's own document, so nothing in it may lift itself out of the editor.
const POSITIONING = ['position', 'z-index', 'inset', 'inset-block', 'inset-inline', 'top', 'right', 'bottom', 'left', 'translate', 'transform'];
const BLOCKABLE = ['src', 'srcset', 'poster', 'background', 'style'];
const BLOCKED = (name: string) => `data-blocked-${name}`;
const REMOTE = /^\s*(?:https?:|\/\/)/i;

export interface EditorSanitizeOptions {
  /** Until it's sent, quoted mail fetches nothing from its sender unless images are allowed. */
  quoteImages?: 'load' | 'block';
  /** Everything is a quote, not only what's inside .gmail_quote and blockquote. */
  allQuoted?: boolean;
}

/** Any safe markup, but nothing that runs, submits, styles or covers the app around it. */
export function sanitizeForEditor(html: string, { quoteImages = 'load', allQuoted = false }: EditorSanitizeOptions = {}): string {
  const t = document.createElement('template');
  t.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['id', 'name', 'tabindex', 'contenteditable', 'autofocus', ...BLOCKABLE.map(BLOCKED)],
  });
  for (const a of t.content.querySelectorAll('[href]')) if (!SAFE_HREF.test(a.getAttribute('href') ?? '')) a.removeAttribute('href');
  // The app's own class names would restyle it; Gmail's mark the quote and signature.
  for (const el of t.content.querySelectorAll('[class]')) {
    const kept = [...el.classList].filter((c) => c.startsWith('gmail_'));
    if (kept.length) el.className = kept.join(' ');
    else el.removeAttribute('class');
  }
  for (const el of t.content.querySelectorAll<HTMLElement>('[style]')) {
    for (const prop of POSITIONING) el.style.removeProperty(prop);
    if (!el.style.length) el.removeAttribute('style');
  }
  // A cid: picture shows from the draft's inline parts (ComposeForm fills it); the address goes back on the way out.
  for (const img of t.content.querySelectorAll('img[src^="cid:" i]')) {
    img.setAttribute('data-cid', img.getAttribute('src')!.slice(4).replace(/^<|>$/g, ''));
    img.removeAttribute('src');
  }
  if (quoteImages === 'block') {
    const quoted = allQuoted ? [t.content] : [...t.content.querySelectorAll(':is(.gmail_quote, blockquote):not(:is(.gmail_quote, blockquote) *)')];
    for (const root of quoted) {
      for (const el of root.querySelectorAll(BLOCKABLE.map((name) => `[${name}]`).join(', '))) blockRemote(el);
    }
  }
  return t.innerHTML;
}

function blockRemote(el: Element) {
  for (const name of BLOCKABLE) {
    const value = el.getAttribute(name);
    if (value === null) continue;
    const kept = name === 'style' ? withoutRemoteUrls(value) : name === 'srcset' || REMOTE.test(value) ? null : value;
    if (kept === value) continue;
    el.setAttribute(BLOCKED(name), value);
    if (kept === null) el.removeAttribute(name);
    else el.setAttribute(name, kept);
  }
}

/** What the editor holds, as it goes out: pictures held back from quoted mail go back in, and inline pictures by their cid: again. */
export function outgoingHtml(html: string): string {
  if (!html.includes('data-blocked-') && !html.includes('data-cid')) return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  for (const img of t.content.querySelectorAll('img[data-cid]')) {
    img.setAttribute('src', `cid:${img.getAttribute('data-cid')}`);
    img.removeAttribute('data-cid');
  }
  for (const name of BLOCKABLE) {
    for (const el of t.content.querySelectorAll(`[${BLOCKED(name)}]`)) {
      el.setAttribute(name, el.getAttribute(BLOCKED(name))!);
      el.removeAttribute(BLOCKED(name));
    }
  }
  return t.innerHTML;
}

/** Web, email and phone only. */
export function isSafeLink(href: string) {
  return /^(https?:|mailto:|tel:)/i.test(href.trim());
}

/** Keeps meaning, loses looks: bold, italic, underline, strikethrough, links, lists, quotes and headings survive; fonts, colors and Docs and Word wrappers don't. */
export function cleanPaste(html: string): string {
  const safe = DOMPurify.sanitize(html, { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'colspan', 'rowspan'], RETURN_DOM_FRAGMENT: true });
  const root = document.createElement('div');
  root.append(safe);

  // Google Docs wraps the whole paste in <b style="font-weight:normal" id="docs-internal-guid-...">.
  for (const el of [...root.querySelectorAll<HTMLElement>('b, strong')]) {
    if (/font-weight\s*:\s*(normal|[1-5]00)\b/i.test(el.getAttribute('style') ?? '')) el.replaceWith(...el.childNodes);
  }

  for (const el of [...root.querySelectorAll<HTMLElement>('[style]')]) {
    const style = el.getAttribute('style') ?? '';
    el.removeAttribute('style');
    if (/^(B|STRONG|I|EM|U|S|STRIKE)$/.test(el.tagName)) continue;
    const wraps: string[] = [];
    if (/font-weight\s*:\s*(bold|[6-9]00)\b/i.test(style)) wraps.push('b');
    if (/font-style\s*:\s*italic/i.test(style)) wraps.push('i');
    if (/text-decoration[^;]*underline/i.test(style)) wraps.push('u');
    if (/text-decoration[^;]*line-through/i.test(style)) wraps.push('s');
    if (!wraps.length) continue;
    let inner: Node[] = [...el.childNodes];
    for (const tag of wraps) {
      const w = document.createElement(tag);
      w.append(...inner);
      inner = [w];
    }
    el.append(...inner);
  }

  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (!SAFE_HREF.test(href)) a.removeAttribute('href');
  }
  // Pictures that only exist on the copier's machine or clipboard would arrive broken.
  for (const img of [...root.querySelectorAll('img')]) {
    if (!/^https?:/i.test(img.getAttribute('src') ?? '')) img.remove();
  }
  // Bare spans and fonts are only wrappers once their style is gone.
  for (const el of [...root.querySelectorAll('span, font')]) el.replaceWith(...el.childNodes);
  return root.innerHTML.trim();
}

/** Pasted over selected text to make it a link. */
export function pastedUrl(text: string): string | null {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) && !/\s/.test(t) ? t : null;
}

/** As an address a mail client can open. */
export function normalizeUrl(input: string): string | null {
  const url = input.trim();
  if (!url || /\s/.test(url)) return null;
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  // Any other scheme (javascript:, data:, file:) is refused; a host with a port is not a scheme.
  if (/^[a-z][\w+.-]*:(?!\d)/i.test(url)) return null;
  if (/^[^@/]+@[^@/]+\.[^@/]+$/.test(url)) return `mailto:${url}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(url) || /^localhost(:\d+)?(\/.*)?$/.test(url)) return `https://${url}`;
  return null;
}
