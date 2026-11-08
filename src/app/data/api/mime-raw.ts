/**
 * Parses raw RFC 2822 / MIME (format=raw, or buildMime's output) into the MessagePart tree the Gmail API returns for format=full, so
 * payload.ts reads either. Accepts CRLF or LF, folded and encoded-word headers, boundaries matched literally, a missing closing boundary,
 * base64, quoted-printable and 7bit/8bit/binary bodies. No Content-Type means text/plain; charset=us-ascii (RFC 2045).
 */
import { base64ToBytes, bytesToBase64Url, latin1ToBytes } from './base64';
import { decodeWords } from './encoded-words';
import type { GmailHeader, GmailMessagePart } from './gmail-types';
import { header, parseHeaderParams } from './payload';

function splitHeadBody(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  if (!m) return { head: raw, body: '' };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

function parseRawHeaders(head: string): GmailHeader[] {
  const lines = head.split(/\r?\n/);
  const out: GmailHeader[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1].value += ' ' + line.trim();
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    out.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  return out.map((h) => ({ name: h.name, value: decodeWords(h.value) }));
}

function decodeQuotedPrintable(body: string): Uint8Array {
  const s = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return latin1ToBytes(s);
}

function decodeTransfer(body: string, encoding: string | undefined): Uint8Array {
  switch ((encoding ?? '7bit').trim().toLowerCase()) {
    case 'base64':
      return base64ToBytes(body);
    case 'quoted-printable':
      return decodeQuotedPrintable(body);
    default:
      return latin1ToBytes(body);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitMultipart(body: string, boundaryValue: string): string[] {
  const delimiter = new RegExp(`(?:^|\\r?\\n)--${escapeRegExp(boundaryValue)}(--)?[ \\t]*(?=\\r?\\n|$)`, 'g');
  const parts: string[] = [];
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = delimiter.exec(body))) {
    if (start >= 0) parts.push(body.slice(start, m.index));
    if (m[1]) {
      start = -1;
      break;
    }
    // Skip the line break that ends the delimiter line.
    const after = body.slice(delimiter.lastIndex).match(/^\r?\n/);
    start = delimiter.lastIndex + (after ? after[0].length : 0);
  }
  if (start >= 0) parts.push(body.slice(start));
  return parts;
}

function parseEntity(raw: string, partId: string): GmailMessagePart {
  const { head, body } = splitHeadBody(raw);
  const headers = parseRawHeaders(head);
  const ct = parseHeaderParams(header(headers, 'Content-Type') ?? 'text/plain; charset=us-ascii');
  const mimeType = ct.value || 'text/plain';
  const disposition = parseHeaderParams(header(headers, 'Content-Disposition'));
  const filename = disposition.params.filename ?? ct.params.name ?? '';
  const part: GmailMessagePart = { partId, mimeType, filename, headers };

  if (mimeType.startsWith('multipart/') && ct.params.boundary) {
    const children = splitMultipart(body, ct.params.boundary);
    part.body = { size: 0 };
    part.parts = children.map((child, i) => parseEntity(child, partId === '' ? String(i) : `${partId}.${i}`));
    return part;
  }
  const bytes = decodeTransfer(body, header(headers, 'Content-Transfer-Encoding'));
  part.body = { size: bytes.length, data: bytesToBase64Url(bytes) };
  return part;
}

/** The root part has partId "" like the Gmail API. */
export function parseRawMessage(raw: string): GmailMessagePart {
  return parseEntity(raw, '');
}
