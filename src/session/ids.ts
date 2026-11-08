/**
 * Canonical ids are Gmail's sync ids, used verbatim:
 *   threads  "thread-f:<decimal>" (received) or "thread-a:r<decimal>" (started by this account)
 *   messages "msg-f:<decimal>" or "msg-a:r<decimal>"
 * For the "-f" forms the decimal is the legacy 64-bit hex id ("#inbox/<hex>", `th=`) in base 10.
 * Search results sometimes append "|msg-f:..." to a thread id; that suffix is dropped.
 */

/** Fills and returns the given buffer with random bytes (crypto.getRandomValues by default). */
export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

const THREAD_RE = /^thread-[af]:r?-?\d+$/;
const MESSAGE_RE = /^msg-[af]:r?-?\d+$/;
const LEGACY_HEX_RE = /^[0-9a-f]{1,16}$/i;

export function normalizeThreadId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.split('|')[0] ?? '';
  return THREAD_RE.test(id) ? id : undefined;
}

export function isThreadId(value: unknown): value is string {
  return typeof value === 'string' && THREAD_RE.test(value);
}

/** Excludes "msg-a:bump-..." placeholders Gmail uses for thread bumps. */
export function isMessageId(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_RE.test(value);
}

/** Undefined for "-a" ids, which have none. */
export function toLegacyHexId(syncId: string): string | undefined {
  const match = /^(?:thread|msg)-f:(\d+)$/.exec(syncId);
  if (!match?.[1]) return undefined;
  return BigInt(match[1]).toString(16);
}

export function fromLegacyHexId(hex: string, kind: 'thread' | 'msg'): string | undefined {
  if (!LEGACY_HEX_RE.test(hex)) return undefined;
  return `${kind}-f:${BigInt(`0x${hex}`).toString(10)}`;
}

/** Like the ones in Gmail's own "thread-a:r..." ids. */
export function randomSignedDecimal(random: RandomBytes = defaultRandom): string {
  const bytes = random(new Uint8Array(8));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return BigInt.asIntN(64, value).toString(10);
}

export function newDraftIds(random?: RandomBytes): { threadId: string; messageId: string } {
  return {
    threadId: `thread-a:r${randomSignedDecimal(random)}`,
    messageId: `msg-a:r${randomSignedDecimal(random)}`,
  };
}

export function defaultRandom(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(bytes);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const GMAIL_URL_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZbcdfghjklmnpqrstvwxz';

/**
 * The id Gmail's `#drafts?compose=<id>` opens a draft by (InboxSDK
 * encodeDraftUrlId): "<thread id without 'thread-'>+<message id>", base64,
 * read as one number and written in Gmail's 40-letter URL alphabet.
 */
export function composeUrlId(threadId: string, messageId: string): string {
  return toUrlAlphabet(`${threadId.replace(/^thread-/, '')}+${messageId}`);
}

/** The id in Gmail's conversation addresses ("#inbox/FMfcg..."), for "thread-a:" ids, which have no legacy hex id. */
export function threadUrlId(threadId: string): string {
  return toUrlAlphabet(threadId);
}

export function fromThreadUrlId(urlId: string): string | undefined {
  if (!/^[A-Za-z]+$/.test(urlId)) return undefined;
  const base = BigInt(GMAIL_URL_ALPHABET.length);
  let n = 0n;
  for (const ch of urlId) {
    const digit = GMAIL_URL_ALPHABET.indexOf(ch);
    if (digit < 0) return undefined;
    n = n * base + BigInt(digit);
  }
  let b64 = '';
  while (n > 0n) {
    b64 = B64[Number(n % 64n)] + b64;
    n /= 64n;
  }
  try {
    const bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    return normalizeThreadId(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function toUrlAlphabet(raw: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(raw))).replace(/=+$/, '');
  let n = 0n;
  for (const ch of b64) n = n * 64n + BigInt(B64.indexOf(ch));
  let out = '';
  const base = BigInt(GMAIL_URL_ALPHABET.length);
  while (n > 0n) {
    out = GMAIL_URL_ALPHABET[Number(n % base)] + out;
    n /= base;
  }
  return out || GMAIL_URL_ALPHABET[0]!;
}
