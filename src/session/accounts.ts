import type { SignedInAccount } from '../shared/accounts-rpc';
import { isProfilePhotoUrl, parseAccountLabel, publicPhoto, sizedPhoto } from './account';

// Signed-in accounts come from Gmail's atom feed (/mail/u/N/feed/atom): a few hundred bytes with the
// address in the title and the unread count, so listing them doesn't load Gmail.

/** Gmail's limit per browser. */
const MAX_ACCOUNTS = 10;

export function feedUrl(origin: string, index: number): string {
  return `${origin}/mail/u/${index}/feed/atom`;
}

/** The title is localized but always holds the address. */
export function parseAtomFeed(body: string): { email?: string; unread?: number } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? '';
  const email = /[^\s<>()"']+@[^\s<>()"']+\.[^\s<>()"']+/.exec(title)?.[0];
  const count = /<fullcount>\s*(\d+)\s*<\/fullcount>/i.exec(body)?.[1];
  return { ...(email ? { email } : {}), ...(count !== undefined ? { unread: Number(count) } : {}) };
}

async function readFeed(fetchFn: typeof fetch, origin: string, index: number): Promise<{ email?: string; unread?: number } | 'empty' | 'failed'> {
  try {
    const response = await fetchFn(feedUrl(origin, index), { credentials: 'include', cache: 'no-store' });
    // A slot nobody's signed in to sends you to the sign-in page (or back to /u/0), or refuses outright.
    if (/accounts\.google\.com/.test(response.url) || [401, 403, 404].includes(response.status)) return 'empty';
    if (!response.ok) return 'failed';
    return parseAtomFeed(await response.text());
  } catch {
    return 'failed';
  }
}

/** Walks /u/0, /u/1, ... until a slot is empty or repeats an address. Always includes the tab's own account. */
export async function discoverAccounts(
  fetchFn: typeof fetch,
  origin: string,
  home: { index: number; email?: string },
  /** An empty slot's feed answers with an HTTP auth challenge, which Safari shows as a sign-in prompt. */
  limit = MAX_ACCOUNTS,
  /** The walk goes past a failed slot, so it may have missed one. */
  onFailed?: (index: number) => void,
): Promise<SignedInAccount[]> {
  const out: SignedInAccount[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < Math.min(limit, MAX_ACCOUNTS); index++) {
    const read = await readFeed(fetchFn, origin, index);
    const feed = typeof read === 'object' ? read : undefined;
    const email = feed?.email ?? (index === home.index ? home.email : undefined);
    if (read === 'failed' && !email) {
      onFailed?.(index);
      continue;
    }
    if (!email || seen.has(email.toLowerCase())) break;
    seen.add(email.toLowerCase());
    out.push({
      email,
      index,
      ...(feed?.unread !== undefined ? { unread: feed.unread } : {}),
      ...(index === home.index ? { home: true } : {}),
    });
  }
  if (home.email && !seen.has(home.email.toLowerCase())) out.push({ email: home.email, index: home.index, home: true });
  return out.sort((a, b) => a.index - b.index);
}

/** A walk that only read as far as it was allowed may have missed some, so it never lowers the count. */
export function slotsToRemember(found: number, limit: number, previous: number, definite: boolean): number {
  return definite || found < limit ? found : Math.max(previous, found);
}

export async function unreadCounts(fetchFn: typeof fetch, origin: string, indices: number[]): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  await Promise.all(
    indices.map(async (index) => {
      const feed = await readFeed(fetchFn, origin, index);
      const unread = typeof feed === 'object' ? feed.unread : undefined;
      if (unread !== undefined) out[index] = unread;
    }),
  );
  return out;
}

/** As Google's own switchers ask for it: Chrome POSTs, Google's bar GETs. Tried in order. */
const LIST_ACCOUNTS_REQUESTS: { url: string; method: 'GET' | 'POST' }[] = [
  { url: 'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard', method: 'POST' },
  { url: 'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&json=standard&listPages=0&mo=1&mn=1', method: 'GET' },
  { url: 'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&json=standard', method: 'GET' },
];

export async function listAccounts(fetchFn: typeof fetch): Promise<Record<string, { name?: string; photoUrl?: string }>> {
  return (await listAccountsWithSlots(fetchFn)).accounts;
}

/**
 * Slots in use. Each account is ["gaia.l.a", 1, name, email, photo, ...], with 0 at [9] when its
 * session is no longer valid and 1 at [14] when signed out. Signed-in accounts take the slots in order.
 */
export function signedInSlots(body: string): number | undefined {
  const start = body.indexOf('[');
  if (start < 0) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(body.slice(start));
  } catch {
    return undefined;
  }
  let count = 0;
  let seen = false;
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node[0] === 'gaia.l.a') {
      seen = true;
      if (node[9] !== 0 && !node[14]) count++;
      return;
    }
    node.forEach(walk);
  };
  walk(json);
  return seen ? count : undefined;
}

export async function listAccountsWithSlots(
  fetchFn: typeof fetch,
): Promise<{ accounts: Record<string, { name?: string; photoUrl?: string }>; slots?: number }> {
  const tries: string[] = [];
  for (const { url, method } of LIST_ACCOUNTS_REQUESTS) {
    try {
      const res = await fetchFn(url, { method, credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        tries.push(`${method} HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      const accounts = parseListAccounts(body);
      const slots = signedInSlots(body);
      if (Object.keys(accounts).length) return { accounts, ...(slots !== undefined ? { slots } : {}) };
      tries.push(`${method} no accounts in the answer`);
    } catch (err) {
      tries.push(`${method} ${(err as Error)?.message ?? String(err)}`);
    }
  }
  throw new Error(tries.join('; '));
}

/** Keyed by lowercased address. Read by shape (name, address, photo after) so a reshuffled slot doesn't break it. */
export function parseListAccounts(body: string): Record<string, { name?: string; photoUrl?: string }> {
  const out: Record<string, { name?: string; photoUrl?: string }> = {};
  let json: unknown;
  // JSON, possibly behind Google's )]}' guard, or inside the bar's postMessage page as a string.
  const start = body.indexOf('[');
  if (start < 0) return out;
  try {
    json = JSON.parse(body.slice(start));
  } catch {
    try {
      json = JSON.parse(body.slice(start, body.lastIndexOf(']') + 1));
    } catch {
      const quoted = /'(\[\\x22[^']*)'/.exec(body) ?? /"(\[\\"[^"]*)"/.exec(body);
      try {
        json = quoted ? JSON.parse(quoted[1]!.replace(/\\x22/g, '"').replace(/\\"/g, '"').replace(/\\\//g, '/')) : undefined;
      } catch {
        return out;
      }
    }
  }
  const isEmail = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    const at = node.findIndex(isEmail);
    if (at > 0) {
      const email = (node[at] as string).toLowerCase();
      const name = typeof node[at - 1] === 'string' && !isEmail(node[at - 1]) ? (node[at - 1] as string).trim() : undefined;
      const photo = node
        .slice(at + 1)
        .find((v): v is string => typeof v === 'string' && /^(https:)?\/\/([^/]*\.googleusercontent\.com|lh\d\.google\.com)\//.test(v));
      if (!out[email]) {
        const absolute = photo && (photo.startsWith('//') ? `https:${photo}` : photo);
        // The signed-in copy (lh3.google.com/u/N/...) won't load in the app's frame; its public twin does.
        const loadable = absolute && (publicPhoto(absolute) ?? absolute);
        out[email] = {
          ...(name ? { name } : {}),
          ...(loadable ? { photoUrl: sizedPhoto(loadable) } : {}),
        };
      }
    }
    node.forEach(walk);
  };
  walk(json);
  return out;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeAttr(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole;
    }
    return ENTITY[code.toLowerCase()] ?? whole;
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const raw = m?.[2] ?? m?.[3];
  return raw === undefined ? undefined : decodeAttr(raw);
}

function httpsUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u.trim(), 'https://mail.google.com/');
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** From the server-drawn account button, read as text: no scripts run and no DOM is built. */
export function profileFromPage(html: string, email: string): { name?: string; photoUrl?: string } {
  const wanted = email.toLowerCase();
  for (let at = html.indexOf('SignOutOptions'); at >= 0; at = html.indexOf('SignOutOptions', at + 14)) {
    const start = html.lastIndexOf('<a', at);
    const end = html.indexOf('</a>', at);
    if (start < 0 || end < 0 || end - start > 6000) continue;
    const anchor = html.slice(start, end);
    const open = anchor.slice(0, anchor.indexOf('>') + 1);
    const parsed = parseAccountLabel(attr(open, 'aria-label'));
    if (parsed.email?.toLowerCase() !== wanted) continue;
    let photo: string | undefined;
    for (const img of anchor.match(/<img\b[^>]*>/gi) ?? []) {
      const photoUrl = (u: string | undefined) => {
        const url = httpsUrl(u);
        return url && isProfilePhotoUrl(url) ? url : undefined;
      };
      photo = photoUrl(attr(img, 'src')) ?? attr(img, 'srcset')?.split(',').map((c) => photoUrl(c.trim().split(/\s+/)[0])).find(Boolean);
      if (photo) break;
    }
    return { ...(parsed.name ? { name: parsed.name } : {}), ...(photo ? { photoUrl: sizedPhoto(photo) } : {}) };
  }
  return {};
}

export async function readProfiles(
  fetchFn: typeof fetch,
  origin: string,
  accounts: { index: number; email: string }[],
): Promise<Record<number, { name?: string; photoUrl?: string }>> {
  const out: Record<number, { name?: string; photoUrl?: string }> = {};
  await Promise.all(
    accounts.map(async ({ index, email }) => {
      try {
        const response = await fetchFn(`${origin}/mail/u/${index}/`, { credentials: 'include' });
        if (!response.ok || /accounts\.google\.com/.test(response.url)) return;
        const profile = profileFromPage(await response.text(), email);
        if (profile.name || profile.photoUrl) out[index] = profile;
      } catch {
        // Offline or signed out: the switcher keeps the letter.
      }
    }),
  );
  return out;
}
