import { tag } from './shape';

/** Where Gmail gets the pictures beside senders, from its responses and the avatars classic Gmail draws. Only domains and image shapes are recorded, so the Photos log is safe to paste. */
export interface ProbeRecord {
  /** "response /sync/i/fd", "page avatar". */
  where: string;
  /** "*@nytimes.com". */
  who: string;
  /** "<data:image/png:3KB>", "<url:lh3.googleusercontent.com/a->". */
  image: string;
}

export const PROBE_KEY = 'bg.photoProbe';
const PROBE_LIMIT = 60;

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IMAGE = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]{40,}|https:\/\/[a-z0-9.-]*(?:googleusercontent|gstatic|google)\.com\/[^\s"'\\<>]{4,}/g;
/** How far either side of an image an address still counts as its owner. */
const NEAR = 1500;

const who = (domain: string) => `*@${domain.toLowerCase()}`;

/** Path with anything id-like dropped: "/sync/u/0/i/fd" stays, long tokens go. */
export function probePath(url: string): string {
  try {
    const u = new URL(url, 'https://mail.google.com');
    return `${u.host === 'mail.google.com' ? '' : u.host}${u.pathname.replace(/\/[^/]{24,}/g, '/…')}`;
  } catch {
    return '?';
  }
}

/** Images in a response body, each with the address nearest to it. Up to `max`. */
export function probeBody(path: string, text: string, max = 8): ProbeRecord[] {
  const out: ProbeRecord[] = [];
  if (text.length > 8_000_000) return out;
  const body = text.replace(/\\u003d/gi, '=').replace(/\\\//g, '/');
  for (const m of body.matchAll(IMAGE)) {
    if (out.length >= max) break;
    const image = m[0];
    // Gmail's own interface images (icons, sprites) aren't anyone's picture.
    if (/\/(images|mail\/images|_\/scs|s2\/favicons|ui\/v1)\//.test(image)) continue;
    const at = m.index ?? 0;
    const from = Math.max(0, at - NEAR);
    let best: { domain: string; distance: number } | undefined;
    for (const e of body.slice(from, at + image.length + NEAR).matchAll(EMAIL)) {
      const distance = Math.abs(from + (e.index ?? 0) - at);
      if (!best || distance < best.distance) best = { domain: e[1]!, distance };
    }
    if (best) out.push({ where: `response ${path}`, who: who(best.domain), image: tag(image) });
  }
  return out;
}

/** The sender avatars Gmail has drawn on the page. */
export function probeDom(root: ParentNode): ProbeRecord[] {
  const out: ProbeRecord[] = [];
  for (const img of root.querySelectorAll<HTMLImageElement>('img[jid], img[data-hovercard-id], img[email]')) {
    const email = img.getAttribute('jid') ?? img.getAttribute('data-hovercard-id') ?? img.getAttribute('email') ?? '';
    const domain = /@([^\s@]+)$/.exec(email.trim())?.[1];
    if (!domain || !img.src) continue;
    out.push({ where: 'page avatar', who: who(domain), image: tag(img.src) });
  }
  return out;
}

/** Adds records, newest last, one per sender domain and image kind. */
export function mergeProbe(saved: ProbeRecord[], found: ProbeRecord[]): ProbeRecord[] {
  const key = (r: ProbeRecord) => `${r.where}|${r.who}|${r.image.replace(/:\d+KB>$/, '>')}`;
  const seen = new Set(saved.map(key));
  const added = found.filter((r) => !seen.has(key(r)) && seen.add(key(r)));
  return added.length ? [...saved, ...added].slice(-PROBE_LIMIT) : saved;
}
