/**
 * Encoding helpers for service workers, extension pages and Node (no Buffer, no DOM). Decoding tolerates base64url, stripped padding,
 * whitespace (raw MIME), stray characters (dropped rather than lose the body) and a dangling 4n+1 character. Invalid UTF-8 becomes U+FFFD.
 * Gmail hands over a body's original bytes, so callers pass the charset from Content-Type; unknown labels fall back to UTF-8.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ENCODE = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0));
const DECODE = new Uint8Array(128);
for (let i = 0; i < 64; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

/** ES2026 Uint8Array.fromBase64 / toBase64 where the engine has them. */
type NativeBase64 = { fromBase64?: (s: string) => Uint8Array };
const native = Uint8Array as unknown as NativeBase64;

/** Table lookups into byte arrays: attachments run to tens of megabytes, and building strings a few characters at a time takes seconds there. */
export function base64ToBytes(input: string): Uint8Array {
  let clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  if (native.fromBase64) return native.fromBase64(clean);
  const n = clean.length;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < n; i += 4) {
    const v = (DECODE[clean.charCodeAt(i)]! << 18) | (DECODE[clean.charCodeAt(i + 1)]! << 12) | (DECODE[clean.charCodeAt(i + 2)]! << 6) | DECODE[clean.charCodeAt(i + 3)]!;
    out[o++] = v >> 16;
    out[o++] = (v >> 8) & 255;
    out[o++] = v & 255;
  }
  if (n - i >= 2) {
    const v = (DECODE[clean.charCodeAt(i)]! << 18) | (DECODE[clean.charCodeAt(i + 1)]! << 12) | (n - i === 3 ? DECODE[clean.charCodeAt(i + 2)]! << 6 : 0);
    out[o++] = v >> 16;
    if (n - i === 3) out[o++] = (v >> 8) & 255;
  }
  return out.subarray(0, o);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const own = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof own === 'function') return own.call(bytes);
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out[o++] = ENCODE[v >> 18]!;
    out[o++] = ENCODE[(v >> 12) & 63]!;
    out[o++] = ENCODE[(v >> 6) & 63]!;
    out[o++] = ENCODE[v & 63]!;
  }
  if (i < n) {
    const v = (bytes[i]! << 16) | (i + 1 < n ? bytes[i + 1]! << 8 : 0);
    out[o++] = ENCODE[v >> 18]!;
    out[o++] = ENCODE[(v >> 12) & 63]!;
    out[o++] = i + 1 < n ? ENCODE[(v >> 6) & 63]! : 61;
    out[o] = 61;
  }
  return new TextDecoder().decode(out);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url (Gmail) to standard padded base64. */
export function base64UrlToBase64(input: string): string {
  return bytesToBase64(base64ToBytes(input));
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function decodeBytes(bytes: Uint8Array, charset = 'utf-8'): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(normalizeCharset(charset), { fatal: false });
  } catch {
    decoder = new TextDecoder('utf-8', { fatal: false });
  }
  return decoder.decode(bytes);
}

function normalizeCharset(charset: string): string {
  const c = charset.trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (c === '' || c === 'us-ascii' || c === 'ascii' || c === 'utf8') return 'utf-8';
  return c;
}

export function decodeBase64UrlText(data: string, charset = 'utf-8'): string {
  return decodeBytes(base64ToBytes(data), charset);
}

export function encodeBase64UrlText(text: string): string {
  return bytesToBase64Url(utf8Encode(text));
}

/** 76 characters per line with CRLF, as MIME requires. */
export function wrapBase64(b64: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
  return lines.join('\r\n');
}

/** One char per byte. */
export function latin1ToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/** Standard or url-safe. */
export function base64DecodedSize(b64: string): number {
  const clean = b64.replace(/[^A-Za-z0-9+/_-]/g, '');
  return Math.floor((clean.length * 3) / 4);
}
