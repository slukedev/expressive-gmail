import DOMPurify from 'dompurify';

const purify = DOMPurify(window);

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' || node.tagName === 'AREA') {
    const href = node.getAttribute('href') ?? '';
    if (!href.startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
  // Remote resources only through src/srcset on images; no CSS @import tricks.
  if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
});

export interface SanitizeOptions {
  /** Tracking pixels stay out until the reader allows images. */
  blockRemoteImages: boolean;
  /** cid: references to blob URLs for inline attachments. */
  cidMap?: Map<string, string>;
  /** Spam: links stay visible but can't be followed. */
  disableLinks?: boolean;
  /** Even when images load. */
  blockTrackers?: boolean;
  onTrackers?: (count: number) => void;
}

// Open-tracking endpoints of big sending services. Generic paths like /pixel/ are left out: real images live there too.
const TRACKER_URL =
  /\/wf\/open\b|\/track\/open\b|\/open\.(?:gif|php|aspx)\b|mailtrack\.io|list-manage\.com\/track|mandrillapp\.com\/track\/open|sendgrid\.net\/(?:wf|mpss)\/o|ct\.sendgrid\.net|hubspotemail\.net|hs-analytics\.net|google-analytics\.com\/collect|mixpanel\.com\/track|email\.mailgun\.org\/o\/|t\.yesware\.com|getnotify\.com|bananatag\.com|mailstat\.us|streak\.com\/[^\s"']*\/(?:o|t)\//i;

/** E.g. "1px" for width. */
function declared(style: string, prop: string) {
  return new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1]?.trim() ?? null;
}

function px(value: string | null) {
  if (value === null || value === '') return null;
  const m = /^([\d.]+)(?:px)?$/i.exec(value.trim());
  return m ? parseFloat(m[1]) : null;
}

/** A known tracking endpoint, or a remote image of 2px or less. Hidden images don't count: "mobile only" layouts hide real images that way. */
export function isTrackingPixel(img: HTMLImageElement): boolean {
  const src = img.getAttribute('src') ?? img.getAttribute('data-blocked-src') ?? '';
  if (!/^https?:/i.test(src)) return false;
  if (TRACKER_URL.test(src)) return true;
  const style = img.getAttribute('style') ?? '';
  const w = px(img.getAttribute('width')) ?? px(declared(style, 'width'));
  const h = px(img.getAttribute('height')) ?? px(declared(style, 'height'));
  return w !== null && h !== null && w <= 2 && h <= 2;
}

// "https:host/x" counts too: against a base with another scheme, the URL parser reads it as https://host/x.
const REMOTE = String.raw`\s*['"]?\s*(?:https?:|\/\/)`;
const REMOTE_IMPORT = new RegExp(String.raw`^@import\s+(?:url\()?${REMOTE}`, 'i');
// url(), and image-set() or src() with a bare string.
const REMOTE_FUNCTION = new RegExp(String.raw`^[\w-]+\((?:[^)]*[(,\s])?${REMOTE}`, 'i');
const REMOTE_STRING = new RegExp(String.raw`^${REMOTE}`, 'i');
const ESCAPED = String.raw`\\(?:[0-9a-f]{1,6}[ \t\n\r\f]?|[^0-9a-f\n\r\f])`;
const STRING = String.raw`"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'`;
// The pieces of a sheet that can fetch: a string, a function call, an at-rule's prelude. Selectors and other text are never touched.
const FETCHING = new RegExp(String.raw`${STRING}|(?:[\w-]|${ESCAPED})+\((?:${STRING}|[^)"'])*\)?|@(?:[\w-]|${ESCAPED})+[^;{}]*;?`, 'gi');
const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([^0-9a-f\n\r\f]))/gi;
const CSS_CONTINUATION = /\\(?:\r\n|[\n\r\f])/g;

/** Decodes escapes of the characters a URL or at-rule is spelled with, so `\75 rl(` reads as `url(`; any other escape stays as written. Only for looking: decoded selectors like `.sm\:w-full` would stop matching. */
function plainCss(css: string) {
  return css.replace(CSS_CONTINUATION, '').replace(CSS_ESCAPE, (all, hex: string | undefined, ch: string | undefined) => {
    const code = hex ? parseInt(hex, 16) : ch!.codePointAt(0)!;
    const c = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    return /^[a-z0-9@:/.-]$/i.test(c) ? c : all;
  });
}

/** Remote url(), image-set() and src() strings and @import, the ways CSS fetches from the sender; everything else stays exactly as written. */
export function withoutRemoteUrls(css: string) {
  return css.replace(FETCHING, (piece) => {
    const plain = plainCss(piece);
    if (plain.startsWith('@')) return REMOTE_IMPORT.test(plain) ? '' : piece;
    if (/^["']/.test(plain)) return REMOTE_STRING.test(plain) ? '""' : piece;
    return REMOTE_FUNCTION.test(plain) ? 'none' : piece;
  });
}

/** A CSP for a document that shows sanitized mail: the regexes in sanitizeEmail are a first pass, this is what the browser enforces. With `remote` off, only `images` (exact addresses) load from the network. */
export function contentPolicy({ remote, images = [] }: { remote: boolean; images?: readonly string[] }): string {
  const exact = images.flatMap((src) => {
    if (!URL.canParse(src)) return [];
    const url = new URL(src);
    const at = /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}` : '';
    return at && !/[\s;,']/.test(at) ? [at] : [];
  });
  const media = ['data:', 'blob:', ...(remote ? ['https:', 'http:'] : exact)].join(' ');
  return [
    "default-src 'none'",
    `img-src ${media}`,
    `media-src ${media}`,
    `font-src 'self' data:${remote ? ' https:' : ''}`,
    `style-src 'unsafe-inline'${remote ? ' https:' : ''}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function sanitizeEmail(html: string, opts: SanitizeOptions): string {
  const clean = purify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'base', 'meta', 'link', 'svg', 'math'],
    FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target', 'bgcolor', 'background', 'align', 'valign', 'cellpadding', 'cellspacing', 'border', 'width', 'height'],
    ADD_TAGS: ['style', 'center', 'font'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|data:image\/(?:png|gif|jpe?g|webp)|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  }) as string;

  const doc = new DOMParser().parseFromString(clean, 'text/html');
  if (opts.blockTrackers) {
    let trackers = 0;
    doc.querySelectorAll('img').forEach((img) => {
      if (!isTrackingPixel(img)) return;
      img.remove();
      trackers++;
    });
    opts.onTrackers?.(trackers);
  }
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith('cid:')) {
      const url = opts.cidMap?.get(src.slice(4).replace(/^<|>$/g, ''));
      if (url) img.setAttribute('src', url);
      else {
        // Filled in place once the attachment arrives, so the frame doesn't reload.
        img.setAttribute('data-cid', src.slice(4).replace(/^<|>$/g, ''));
        img.removeAttribute('src');
      }
    } else if (opts.blockRemoteImages && /^https?:/i.test(src)) {
      img.setAttribute('data-blocked-src', src);
      img.removeAttribute('src');
      img.removeAttribute('srcset');
    }
  });
  if (opts.disableLinks) {
    doc.querySelectorAll('a[href], area[href]').forEach((a) => {
      a.setAttribute('data-href', a.getAttribute('href') ?? '');
      a.removeAttribute('href');
      a.setAttribute('role', 'link');
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('title', 'Links are turned off for messages in Spam');
    });
  }
  if (opts.blockRemoteImages) {
    // Any CSS image (background, list-style-image, border-image, mask, cursor, content) is the other tracking vector.
    doc.querySelectorAll('[style]').forEach((el) => el.setAttribute('style', withoutRemoteUrls(el.getAttribute('style') ?? '')));
    doc.querySelectorAll('[background]').forEach((el) => el.removeAttribute('background'));
    doc.querySelectorAll('img[srcset], picture source[srcset]').forEach((el) => el.removeAttribute('srcset'));
    doc.querySelectorAll('video, audio, source, track').forEach((el) => {
      if (/^https?:|^\/\//i.test(el.getAttribute('src') ?? '')) el.removeAttribute('src');
      el.removeAttribute('poster');
    });
    doc.querySelectorAll('style').forEach((el) => {
      el.textContent = withoutRemoteUrls(el.textContent ?? '');
    });
  }
  return doc.documentElement.outerHTML;
}

const FORWARD = /^\s*(-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:)|^\s*From:[\s\S]*\bSubject:\s*(FW|Fwd):/i;

function hasContent(node: Node): boolean {
  return !!node.textContent?.trim() || !!(node as ParentNode).querySelector?.('img');
}

/** Like Gmail, only history at the end folds: a forwarded message stays visible, and so does text after a quote (inline replies). */
export function splitQuoted(html: string): { main: string; quoted: string | null } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const last = doc.body.lastChild;
  if (!last) return { main: html, quoted: null };
  let container: Element | null = null;
  for (const quote of doc.querySelectorAll('.gmail_quote, blockquote[type="cite"], #appendonsend, #divRplyFwdMsg, .moz-cite-prefix')) {
    if (FORWARD.test(quote.textContent ?? '')) continue;
    const start = quote.closest('.gmail_extra') ?? quote;
    // Outlook's header starts the history outright; the rest must be the quote's own tail.
    if (start.id === 'appendonsend' || start.id === 'divRplyFwdMsg') {
      container = start;
      break;
    }
    const cite = start.classList.contains('moz-cite-prefix') && start.nextElementSibling?.matches('blockquote') ? start.nextElementSibling : start;
    const after = doc.createRange();
    after.setStartAfter(cite);
    after.setEndAfter(last);
    if (hasContent(after.cloneContents())) continue;
    container = start;
    break;
  }
  if (!container) return { main: html, quoted: null };
  const range = doc.createRange();
  range.setStartBefore(container);
  range.setEndAfter(last);
  const frag = range.extractContents();
  const holder = doc.createElement('div');
  holder.appendChild(frag);
  if (!hasContent(doc.body)) return { main: html, quoted: null };
  return { main: doc.documentElement.outerHTML, quoted: holder.innerHTML };
}

/** Escape, link URLs, fold "> " quote blocks. */
export function textToHtml(text: string): { main: string; quoted: string | null } {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const linkify = (s: string) =>
    s.replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const quoteStart = lines.findIndex((l, i) => /^On .+wrote:\s*$/.test(l) || (l.startsWith('>') && lines.slice(i).every((x) => x.startsWith('>') || !x.trim())));
  const body = (ls: string[]) => `<div dir="auto" style="white-space:pre-wrap">${linkify(esc(ls.join('\n')))}</div>`;
  if (quoteStart <= 0) return { main: body(lines), quoted: null };
  return { main: body(lines.slice(0, quoteStart)), quoted: body(lines.slice(quoteStart)) };
}
