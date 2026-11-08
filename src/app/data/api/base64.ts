/**
 * Encoding helpers for service workers, extension pages and Node (no Buffer, no DOM). Decoding tolerates base64url, stripped padding,
 * whitespace (raw MIME), stray characters (dropped rather than lose the body) and a dangling 4n+1 character. Invalid UTF-8 becomes U+FFFD.
 * Gmail hands over a body's original bytes, so callers pass the charset from Content-Type; unknown labels fall back to UTF-8.
 */

const CHUNK = 0x8000;

export function base64ToBytes(input: string): Uint8Array {
  let clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  while (clean.length % 4 !== 0) clean += '=';
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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
