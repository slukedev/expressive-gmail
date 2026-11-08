import type { Account, Address, OutgoingMessage } from '../app/data/types';

/** "/sync/u/2" or "/mail/u/2/#inbox" → 2. */
export function accountIndexFromPath(path: string): number {
  const match = /\/u\/(\d+)(?:\/|$)/.exec(path);
  return match?.[1] ? Number(match[1]) : 0;
}

/** Gmail's account button label: "Google Account: Ada Lovelace  (ada@example.com)", localized before the colon. */
export function parseAccountLabel(label: string | null | undefined): { name?: string; email?: string } {
  if (!label) return {};
  const match = /:\s*([^\n]*?)\s*\(\s*([^()\s]+@[^()\s]+)\s*\)\s*$/.exec(label.replace(/\s+/g, ' '));
  if (!match) return {};
  const name = match[1]?.trim();
  return { email: match[2], ...(name ? { name } : {}) };
}

/** Anything else in the account button (gstatic's generic avatar, ring and badge art) isn't this account's photo. */
export function isProfilePhotoUrl(url: string): boolean {
  return /^https:\/\/lh\d\.(googleusercontent|google)\.com\//.test(url);
}

/** An img's src, else its srcset (Gmail sometimes paints a data: placeholder first), else a background image. */
function photoIn(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const docBase = el.ownerDocument?.baseURI;
  const base = docBase && /^https?:/.test(docBase) ? docBase : 'https://mail.google.com/';
  // Attributes can be protocol-relative ("//lh3...") or relative; resolve before checking.
  const absolute = (u: string | null | undefined) => {
    if (!u || /^data:/i.test(u)) return undefined;
    try {
      const url = new URL(u.trim(), base);
      return isProfilePhotoUrl(url.href) ? url.href : undefined;
    } catch {
      return undefined;
    }
  };
  for (const img of el.querySelectorAll('img')) {
    const src = absolute(img.getAttribute('src'));
    if (src) return src;
    const fromSet = img.getAttribute('srcset')?.split(',').map((c) => absolute(c.trim().split(/\s+/)[0])).find(Boolean);
    if (fromSet) return fromSet;
  }
  // Some Google headers draw the avatar as an SVG <image>.
  for (const image of el.querySelectorAll('image')) {
    const href = absolute(image.getAttribute('href') ?? image.getAttribute('xlink:href'));
    if (href) return href;
  }
  for (const node of [el, ...el.querySelectorAll('[style*="url("]')]) {
    const m = /url\(["']?((?:https:)?\/\/[^"')]+)["']?\)/.exec(node.getAttribute('style') ?? '');
    const found = absolute(m?.[1]);
    if (found) return found;
  }
  return undefined;
}

export function readAccountFromDocument(doc: Document, email: string, index: number): Account {
  const button = doc.querySelector<HTMLElement>('a[href^="https://accounts.google.com/SignOutOptions"]');
  const parsed = parseAccountLabel(button?.getAttribute('aria-label'));
  const sameAccount = parsed.email?.toLowerCase() === email.toLowerCase();
  // Google moves its header around; anything labelled with this address can hold the photo too.
  let photo = sameAccount ? photoIn(button) : undefined;
  if (!photo) {
    const wanted = email.toLowerCase();
    for (const el of doc.querySelectorAll('[aria-label]')) {
      if (!el.getAttribute('aria-label')!.toLowerCase().includes(wanted)) continue;
      photo = photoIn(el);
      if (photo) break;
    }
  }
  const account: Account = {
    email,
    name: (sameAccount && parsed.name) || email.split('@')[0] || email,
    index,
  };
  if (photo) account.photoUrl = sizedPhoto(photo);
  return account;
}

/** Photo URLs end in a size directive ("=s32-c-mo"); Gmail's header asks for 32px, too few for a 2x avatar. */
export function sizedPhoto(url: string, size = 128): string {
  if (!/^https:\/\/([^/]*\.googleusercontent\.com|lh\d\.google\.com)\//.test(url)) return url;
  return url.replace(/=s\d+((?:-[a-z]+)*)$/i, `=s${size}$1`);
}

/** GLOBALS is an inline array in Gmail's HTML: [9] is the "ik" key, [10] the signed-in address. */
export function readGlobalsFromDocument(doc: Pick<Document, 'querySelectorAll'>): { ik?: string; email?: string } {
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = /GLOBALS\s*=\s*(\[[\s\S]*?\]);/.exec(s.textContent ?? '');
    if (!m) continue;
    // Walk the top-level array without evaluating it.
    const items: string[] = [];
    let depth = 0;
    let cur = '';
    let quote: string | null = null;
    for (const ch of m[1]!.slice(1, -1)) {
      if (quote) {
        cur += ch;
        if (ch === quote && cur[cur.length - 2] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) {
        items.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    items.push(cur.trim());
    const str = (i: number) => {
      const v = items[i];
      return v && /^["']/.test(v) ? v.slice(1, -1) : undefined;
    };
    return { ik: str(9), email: str(10) };
  }
  return {};
}

/** Gmail's own compose window, for when `send` is unsupported. No attachments; the body becomes plain text. */
export function composeFallbackUrl(message: Pick<OutgoingMessage, 'to' | 'cc' | 'bcc' | 'subject' | 'html'>, accountIndex: number): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1' });
  const list = (addresses: Address[]) => addresses.map((a) => a.email).join(',');
  if (message.to.length) params.set('to', list(message.to));
  if (message.cc.length) params.set('cc', list(message.cc));
  if (message.bcc.length) params.set('bcc', list(message.bcc));
  if (message.subject) params.set('su', message.subject);
  const body = htmlToPlainText(message.html);
  if (body) params.set('body', body);
  return `https://mail.google.com/mail/u/${accountIndex}/?${params}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** String based on purpose: Gmail's page enforces Trusted Types, so DOMParser/innerHTML are off limits. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** lh3.google.com/u/2/ogw/X=s32 → lh3.googleusercontent.com/ogw/X=s32: the public copy of a signed-in photo address. */
export function publicPhoto(url: string): string | undefined {
  const m = /^https:\/\/lh(\d)\.google\.com\/(?:u\/\d+\/)?(.+)$/.exec(url);
  return m ? `https://lh${m[1]}.googleusercontent.com/${m[2]}` : undefined;
}

/** A host without CORS headers makes fetch throw though an <img> would show it, so that case loads it as one. */
export async function isImage(url: string, credentials: RequestCredentials): Promise<boolean> {
  try {
    const res = await fetch(url, { credentials, method: 'GET' });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return loadsAsImage(url);
  }
}

function loadsAsImage(url: string, timeoutMs = 8_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(false);
    const img = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    img.referrerPolicy = 'no-referrer';
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = url;
  });
}

export async function photoData(url: string, credentials: RequestCredentials): Promise<string | undefined> {
  const res = await fetch(url, { credentials });
  const blob = res.ok ? await res.blob() : undefined;
  if (!blob?.type.startsWith('image/') || blob.size > 200_000) return undefined;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
