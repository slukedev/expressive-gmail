/**
 * RFC 2047 encoded words. Encoding is only for non-ASCII text, splits into words of at most 75 characters, and never cuts a UTF-8 sequence
 * or surrogate pair (the receiver would show U+FFFD). Decoding (raw MIME only; the Gmail API decodes headers itself) drops whitespace
 * between adjacent encoded words but keeps it next to plain text, and leaves malformed words as text.
 */
import { base64ToBytes, bytesToBase64, decodeBytes, latin1ToBytes, utf8Encode } from './base64';

const MAX_WORD = 75;
const PREFIX = '=?UTF-8?B?';
const SUFFIX = '?=';

export function isAscii(text: string): boolean {
  return /^[\x20-\x7e\t]*$/.test(text);
}

/** On code point boundaries. */
function splitByUtf8Bytes(text: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of text) {
    const n = utf8Encode(ch).length;
    if (size + n > maxBytes && current) {
      pieces.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Joined by CRLF + space (a header fold); plain ASCII comes back unchanged. */
export function encodeWords(text: string, joiner = '\r\n '): string {
  if (isAscii(text)) return text;
  // Base64 of n bytes is 4*ceil(n/3) chars; fit inside 75 minus the wrapper.
  const room = MAX_WORD - PREFIX.length - SUFFIX.length;
  const maxBytes = Math.floor(room / 4) * 3;
  return splitByUtf8Bytes(text, maxBytes)
    .map((piece) => PREFIX + bytesToBase64(utf8Encode(piece)) + SUFFIX)
    .join(joiner);
}

const WORD_RE = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

function decodeQ(text: string): Uint8Array {
  const binary = text
    .replace(/_/g, ' ')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return latin1ToBytes(binary);
}

export function decodeWords(value: string): string {
  // Drop whitespace that only separates two encoded words.
  const joined = value.replace(/(\?=)\s+(?==\?)/g, '$1');
  return joined.replace(WORD_RE, (match, charset: string, enc: string, text: string) => {
    try {
      // RFC 2231 allows "charset*language"; the language is irrelevant here.
      const cs = charset.split('*')[0];
      const bytes = enc.toUpperCase() === 'B' ? base64ToBytes(text) : decodeQ(text);
      return decodeBytes(bytes, cs);
    } catch {
      return match;
    }
  });
}
