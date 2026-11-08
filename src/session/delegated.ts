import type { DelegatedMailbox } from '../shared/accounts-rpc';
import { delegatedPath } from '../shared/takeover';

// Gmail links delegated mailboxes as /mail/u/N/d/<token>/ (or the older /mail/b/<id>/u/N/), in its
// switcher and its page data. Any such link with an address next to it counts, wherever it sits.

const ORIGIN = 'https://mail.google.com';
// A bare path only where a URL can start, so another site's /mail/ path never counts.
const LINK = /(?:https:\/\/mail\.google\.com|(?<=^|["'\s=]))\/mail\/(?:u\/\d{1,2}\/d\/[\w-]{8,}|b\/[\w.-]+\/u\/\d{1,2}|b\/[\w.-]{4,})(?=[/"'\s#?<\\]|$)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const EMAIL_CHAR = /[\w.+@-]/;
/** One switcher entry, not the next one. */
const NEAR = 320;
/** Escapes make raw text longer than what it reads as, so windows are cut wider. */
const WINDOW = 4 * (NEAR + 120);
const CANDIDATE = /\/mail\/|\\\/mail\\\/|\\(?:x2f|u002f)mail\\(?:x2f|u002f)/gi;
/** Data that crosses one of these belongs to another record. */
const OTHER_RECORD = /[[\]{}]|\/mail\//;
const MAX_TEXT = 8_000_000;
const MAX_FOUND = 50;

/** Script data escapes slashes and quotes; markup escapes ampersands. */
function unescape(text: string): string {
  return text
    .replace(/\\(?:x2f|u002f)/gi, '/')
    .replace(/\\(?:x40|u0040)/gi, '@')
    .replace(/\\(?:x22|u0022)/gi, '"')
    .replace(/\\\//g, '/')
    .replace(/&(?:amp|#38);/g, '&')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:#64|commat);/g, '@');
}

/** Stretched so no window cuts an address in two. */
function windows(text: string): string[] {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    let from = Math.max(0, m.index - WINDOW);
    let to = Math.min(text.length, m.index + WINDOW);
    for (let n = 0; n < 254 && from > 0 && EMAIL_CHAR.test(text[from - 1]!); n++) from--;
    for (let n = 0; n < 254 && to < text.length && EMAIL_CHAR.test(text[to]!); n++) to++;
    const last = spans[spans.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
  }
  return spans.map(([from, to]) => unescape(text.slice(from, to)));
}

export function delegatedUrl(href: string): string | undefined {
  try {
    const url = new URL(href, ORIGIN);
    if (url.origin !== ORIGIN) return undefined;
    const path = delegatedPath(url.pathname);
    return path ? `${ORIGIN}${path}/` : undefined;
  } catch {
    return undefined;
  }
}

/** A display name right before the address: `"Name","address"` in data, `Name (address)` or `Name <address>` in text. */
function nameBefore(text: string, at: number): string | undefined {
  const before = text.slice(Math.max(0, at - 120), at);
  const quoted = /"([^"\\@<>/]{1,80})"\s*,\s*"$/.exec(before);
  const plain = /(?:^|[>":,\]])\s*([^"\\@<>/(),:\]]{1,80}?)\s*[(<]\s*$/.exec(before);
  return usableName((quoted?.[1] ?? plain?.[1])?.trim());
}

function usableName(name: string | undefined): string | undefined {
  return name && name.length <= 80 && !name.includes('@') && !/^delegated$/i.test(name) ? name : undefined;
}

function entry(email: string, url: string, name: string | undefined): DelegatedMailbox {
  return { email, url, ...(name && name.toLowerCase() !== email.toLowerCase() ? { name } : {}) };
}

function mineSet(me: string[]) {
  return new Set(me.map((e) => e.trim().toLowerCase()));
}

/** Each mailbox once, by address and by link. */
function dedupe(found: DelegatedMailbox[]): DelegatedMailbox[] {
  const seen = new Set<string>();
  return found.filter((d) => {
    const key = d.email.toLowerCase();
    if (seen.has(key) || seen.has(d.url)) return false;
    seen.add(key);
    seen.add(d.url);
    return true;
  });
}

/** Each delegated link paired with the nearest address in the same record that isn't `me`; links with none are left out. */
export function parseDelegated(raw: string, me: string[] = []): DelegatedMailbox[] {
  const mine = mineSet(me);
  const out: DelegatedMailbox[] = [];
  for (const text of windows(raw.length > MAX_TEXT ? raw.slice(0, MAX_TEXT) : raw)) {
    for (const link of text.matchAll(LINK)) {
      const url = delegatedUrl(link[0]);
      if (!url) continue;
      const end = link.index + link[0].length;
      const from = Math.max(0, link.index - NEAR);
      let best: { email: string; at: number; distance: number } | undefined;
      for (const m of text.slice(from, end + NEAR).matchAll(EMAIL)) {
        const email = m[0];
        if (mine.has(email.toLowerCase())) continue;
        const at = from + m.index;
        const before = at < link.index;
        if (OTHER_RECORD.test(before ? text.slice(at + email.length, link.index) : text.slice(end, at))) continue;
        const distance = before ? link.index - (at + email.length) : at - end;
        if (!best || distance < best.distance) best = { email, at, distance };
      }
      if (best) out.push(entry(best.email, url, nameBefore(text, best.at)));
    }
    if (out.length >= MAX_FOUND * 2) break;
  }
  return dedupe(out).slice(0, MAX_FOUND);
}

function texts(node: Node, out: string[] = []): string[] {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const t = child.textContent?.trim();
      if (t) out.push(t);
    } else texts(child, out);
  }
  return out;
}

/** A switcher link names its own mailbox in its label, title or text, never a neighbour's. */
function fromAnchor(a: HTMLAnchorElement, mine: Set<string>): DelegatedMailbox | undefined {
  const url = delegatedUrl(a.getAttribute('href') ?? '');
  if (!url) return undefined;
  const parts = [a.getAttribute('aria-label'), a.getAttribute('title'), ...texts(a)].map((p) => unescape(p?.trim() ?? '')).filter(Boolean);
  for (const part of parts) {
    for (const m of part.matchAll(EMAIL)) {
      if (mine.has(m[0].toLowerCase())) continue;
      const name = nameBefore(part, m.index) ?? parts.map(usableName).find(Boolean);
      return entry(m[0], url, name);
    }
  }
  return undefined;
}

/** Links already drawn first, then inline script data. Never throws. */
export function delegatedFromDocument(doc: Pick<Document, 'querySelectorAll'>, me: string[] = []): DelegatedMailbox[] {
  try {
    const mine = mineSet(me);
    const anchors = [...doc.querySelectorAll<HTMLAnchorElement>('a[href*="/mail/"]')].map((a) => fromAnchor(a, mine)).filter((d) => !!d);
    let scripts = '';
    for (const s of doc.querySelectorAll('script:not([src])')) {
      const t = s.textContent ?? '';
      // Most of Gmail's inline scripts are code; only data with a delegated link is worth scanning.
      if (/\/mail(?:\\?\/|\\x2f|\\u002f)(?:u|b)/i.test(t)) scripts += `${t}\n`;
      if (scripts.length > MAX_TEXT) break;
    }
    return dedupe([...anchors, ...parseDelegated(scripts, me)]).slice(0, MAX_FOUND);
  } catch {
    return [];
  }
}

/** Every signed-in address is `me`, so one listed beside a link is never taken for the mailbox. */
export async function discoverDelegated(doc: Pick<Document, 'querySelectorAll'>, addresses: Promise<(string | undefined)[]>): Promise<DelegatedMailbox[]> {
  const me = await addresses.catch((): (string | undefined)[] => []);
  return delegatedFromDocument(doc, me.filter((e): e is string => !!e));
}
