import DOMPurify from 'dompurify';

const TAGS = ['a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'p', 'br', 'div', 'span', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'pre', 'code', 'img', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'font'];

/** Formatting, links and pictures by address. */
export const INSERT_CONFIG = {
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'colspan', 'rowspan', 'color', 'size', 'class', 'data-smartmail'],
};

const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;

/** Any safe markup, but nothing that runs, submits, or styles the app around it. */
export function sanitizeForEditor(html: string): string {
  const out = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['id', 'name', 'tabindex', 'contenteditable', 'autofocus'],
  });
  if (!out.includes('href')) return out;
  const t = document.createElement('template');
  t.innerHTML = out;
  for (const a of t.content.querySelectorAll('[href]')) if (!SAFE_HREF.test(a.getAttribute('href') ?? '')) a.removeAttribute('href');
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
