/** List-Unsubscribe (RFC 2369) and its mailto targets. */
export function parseListUnsubscribe(value: string | undefined): { https?: string; http?: string; mailto?: string } {
  if (!value) return {};
  // A plain http link can't take a one-click POST (RFC 8058) but still opens as a page.
  const out: { https?: string; http?: string; mailto?: string } = {};
  // Whitespace inside <...> is folding, not part of the URL (RFC 2369).
  const candidates = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].replace(/\s+/g, ''));
  if (!candidates.length) candidates.push(...value.split(',').map((s) => s.trim()));
  for (const c of candidates) {
    if (!out.https && /^https:\/\//i.test(c)) out.https = c;
    else if (!out.http && /^http:\/\//i.test(c)) out.http = c;
    else if (!out.mailto && /^mailto:/i.test(c)) out.mailto = c;
  }
  return out;
}

export function parseMailto(url: string): { to: string[]; subject?: string; body?: string } {
  const rest = url.replace(/^mailto:/i, '');
  const q = rest.indexOf('?');
  const path = q >= 0 ? rest.slice(0, q) : rest;
  const params = new URLSearchParams(q >= 0 ? rest.slice(q + 1) : '');
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const to = path
    .split(',')
    .map((s) => decode(s).trim())
    .filter((s) => s.includes('@'));
  // Header names in a mailto URL are case-insensitive (RFC 6068).
  const get = (name: string) => [...params].filter(([k]) => k.toLowerCase() === name).map(([, v]) => v);
  for (const extra of get('to')) to.push(...extra.split(',').map((s) => s.trim()).filter(Boolean));
  return { to, subject: get('subject')[0], body: get('body')[0] };
}

/** In the languages Gmail's own detection covers best. */
const UNSUBSCRIBE_WORDS = new RegExp(
  [
    'unsubscribe',
    'unsub',
    '\\bopt[ _-]?out\\b',
    'e-?mail preferences',
    'manage (?:your )?(?:subscriptions?|preferences|e-?mails?|notifications)',
    'subscription preferences',
    'd[ée]sabonner',
    'd[ée]sinscri',
    'abmelden',
    'abbestellen',
    'darse de baja',
    'cancelar (?:la )?suscripci[oó]n',
    'descadastr',
    'cancelar inscri',
    'disiscri',
    'annulla (?:l.)?iscrizione',
    'uitschrijven',
    'avregistrer',
    'afmeld',
    'wypisz',
    'отписаться',
    '配信停止',
    '退订',
    '取消订阅',
    '구독 ?취소',
    '수신 ?거부',
  ].join('|'),
  'i',
);

const TAG_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return TAG_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** For senders without a List-Unsubscribe header. A link whose text says so beats one whose URL does. */
export function findUnsubscribeLink(html: string | undefined, text?: string): string | undefined {
  const key = `${html ?? ''}\u0000${text ?? ''}`;
  // Thread views ask on every render; bodies can be large.
  if (linkMemo.has(key)) return linkMemo.get(key);
  const found = scanForLink(html, text);
  if (linkMemo.size >= 32) linkMemo.delete(linkMemo.keys().next().value!);
  linkMemo.set(key, found);
  return found;
}

const linkMemo = new Map<string, string | undefined>();

function scanForLink(html: string | undefined, text?: string): string | undefined {
  let best: { url: string; score: number } | undefined;
  for (const m of (html ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]!);
    const url = decodeHtml((href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim());
    if (!/^https?:\/\//i.test(url)) continue;
    const label = decodeHtml(m[2]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const title = decodeHtml(/\b(?:title|aria-label)\s*=\s*"([^"]*)"/i.exec(m[1]!)?.[1] ?? '');
    const score = UNSUBSCRIBE_WORDS.test(label) || UNSUBSCRIBE_WORDS.test(title) ? 2 : UNSUBSCRIBE_WORDS.test(decodeURIComponentSafe(url)) ? 1 : 0;
    if (score > (best?.score ?? 0)) best = { url, score };
    if (score === 2) break;
  }
  if (best) return best.url;
  // Plain-text mail: a URL on a line that talks about unsubscribing.
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (!UNSUBSCRIBE_WORDS.test(line)) continue;
    const url = /https?:\/\/[^\s<>"')\]]+/i.exec(line)?.[0]?.replace(/[.,;:!?]+$/, '');
    if (url) return url;
  }
  return undefined;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
