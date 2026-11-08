import DOMPurify from 'dompurify';

const purify = DOMPurify(window);

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
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

const REMOTE_IMPORT = /@import\s+(?:url\()?\s*['"]?\s*(?:https?:)?\/\/[^;]*;?/gi;
const REMOTE_URL = /url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi;

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
    doc.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('data-href', a.getAttribute('href') ?? '');
      a.removeAttribute('href');
      a.setAttribute('role', 'link');
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('title', 'Links are turned off for messages in Spam');
    });
  }
  if (opts.blockRemoteImages) {
    // Background images in inline styles are the other tracking vector.
    doc.querySelectorAll<HTMLElement>('[style*="url("], [background]').forEach((el) => {
      el.style.backgroundImage = '';
      el.removeAttribute('background');
    });
    // So are srcset, video posters and media, and remote urls in style sheets.
    doc.querySelectorAll('img[srcset], picture source[srcset]').forEach((el) => el.removeAttribute('srcset'));
    doc.querySelectorAll('video, audio, source').forEach((el) => {
      if (/^https?:|^\/\//i.test(el.getAttribute('src') ?? '')) el.removeAttribute('src');
      el.removeAttribute('poster');
    });
    doc.querySelectorAll('style').forEach((el) => {
      el.textContent = (el.textContent ?? '').replace(REMOTE_IMPORT, '').replace(REMOTE_URL, 'none');
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
