import { BackendError } from '../app/data/backend';
import type { Message } from '../app/data/types';
import { fromLegacyHexId } from './ids';

/** Gmail's thread data leaves out List-Unsubscribe, so it's read from "Show original" (view=om), served as raw RFC 822 or as HTML with the source in a <pre>. */
export function originalSourceUrl(origin: string, index: number, ik: string, messageId: string): string {
  // permmsgid takes sync ids ("msg-f:<decimal>"); an old hex id converts to one.
  const permmsgid = /^[0-9a-f]{1,16}$/i.test(messageId) ? (fromLegacyHexId(messageId, 'msg') ?? messageId) : messageId;
  const params = new URLSearchParams({ ui: '2', ik, view: 'om', permmsgid });
  return `${origin}/mail/u/${index}/?${params}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const HEADER_LINE = /^[\x21-\x39\x3b-\x7e]+:/;

/** Headers every delivered message has, so a block with none of them isn't a message. */
const MESSAGE_HEADERS = ['from', 'received', 'message-id', 'delivered-to', 'return-path', 'date'];

/** Null when it holds none (a sign-in page). */
export function rawSourceFrom(body: string): string | null {
  // The page may be cut short after the headers (see headSource), so the <pre> may not close.
  const pres = [...body.matchAll(/<pre\b([^>]*)>([\s\S]*?)(?:<\/pre>|$)/gi)];
  const decoded = (m: RegExpMatchArray) => decodeEntities(m[2]!.replace(/<[^>]+>/g, '')).replace(/^\s+/, '');
  const byId = pres.find((m) => /\bid=["']?raw_message_text\b/i.test(m[1]!));
  if (byId) return decoded(byId);
  const looksLikeSource = pres.map(decoded).find((t) => HEADER_LINE.test(t));
  if (looksLikeSource !== undefined) return looksLikeSource;
  // Not every Gmail page starts with a doctype, so judge by the text itself.
  const text = body.replace(/^\uFEFF?\s+/, '');
  return HEADER_LINE.test(text) ? text : null;
}

/** Unfolded, keyed by lowercase name; first occurrence wins. */
export function parseHeaderBlock(raw: string): Map<string, string> {
  const end = raw.search(/\r?\n\r?\n/);
  const block = (end >= 0 ? raw.slice(0, end) : raw).replace(/\r?\n[ \t]+/g, ' ');
  const out = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!out.has(name)) out.set(name, line.slice(colon + 1).trim());
  }
  return out;
}

function completeHeaders(partial: string): Map<string, string> | null {
  const raw = rawSourceFrom(partial);
  if (raw === null || !/\r?\n\r?\n/.test(raw)) return null;
  const headers = parseHeaderBlock(raw);
  return MESSAGE_HEADERS.some((name) => headers.has(name)) ? headers : null;
}

/** Throws when the response holds no readable message, so "this sender has none" is never a guess. */
export function listHeadersFrom(body: string): Partial<Message['headers']> {
  const h = completeHeaders(body);
  if (!h) throw new BackendError("Couldn't read this message's headers from Gmail.", 'unknown', true);
  const out: Partial<Message['headers']> = {};
  if (h.get('list-unsubscribe')) out.listUnsubscribe = h.get('list-unsubscribe');
  if (h.get('list-unsubscribe-post')) out.listUnsubscribePost = h.get('list-unsubscribe-post');
  if (h.get('list-id')) out.listId = h.get('list-id');
  if (h.get('bimi-selector')) out.bimiSelector = h.get('bimi-selector');
  return out;
}

export function headersComplete(partial: string): boolean {
  return completeHeaders(partial) !== null;
}

/** The source holds every attachment; a 20 MB message shouldn't download to find one header. */
export async function headSource(response: Response, limit = 2 * 1024 * 1024): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      text += decoder.decode(value, { stream: true });
      if (headersComplete(text) || text.length > limit) break;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return text;
}
