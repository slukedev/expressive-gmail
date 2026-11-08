/**
 * The RFC 2822 / MIME text messages.send and drafts.* take as `raw`: multipart/alternative (text, html), inside multipart/mixed with attachments.
 * Every line is 7-bit ASCII: RFC 2047 headers, RFC 2231 filenames plus an encoded-word `name` for older clients, base64 bodies at 76 columns.
 * CR and LF are stripped from header values so a subject can't inject headers.
 */
import type { OutgoingMessage } from '../types';
import { bytesToBase64, utf8Encode, wrapBase64 } from './base64';
import { formatAddress, formatAddressList } from './address';
import { encodeWords, isAscii } from './encoded-words';
import { htmlToText } from './html-text';

const CRLF = '\r\n';

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function boundary(tag: string, random: () => number): string {
  let id = '';
  for (let i = 0; i < 24; i++) id += Math.floor(random() * 36).toString(36);
  return `bg_${tag}_${id}`;
}

/** At commas or spaces, so no line exceeds 78 characters where possible. */
function foldHeader(name: string, value: string): string {
  const line = `${name}: ${value}`;
  if (line.length <= 78 || value.includes('\r\n')) return line;
  const out: string[] = [];
  let current = `${name}:`;
  for (const token of value.split(/(?<=,) /)) {
    const piece = ` ${token}`;
    if (current.length + piece.length > 78 && current.length > name.length + 1) {
      out.push(current);
      current = piece;
    } else current += piece;
  }
  out.push(current);
  return out.join(`${CRLF}`);
}

function encodeFilenameParams(filename: string): string {
  const safe = clean(filename) || 'attachment';
  if (isAscii(safe) && !/["\\]/.test(safe)) return `filename="${safe}"`;
  const pct = Array.from(utf8Encode(safe))
    .map((b) => {
      const c = String.fromCharCode(b);
      return /[A-Za-z0-9!#$&+.^_`|~-]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
  return `filename*=UTF-8''${pct}`;
}

function encodeNameParam(filename: string): string {
  const safe = clean(filename) || 'attachment';
  if (isAscii(safe)) return `name="${safe.replace(/(["\\])/g, '\\$1')}"`;
  return `name="${encodeWords(safe, ' ')}"`;
}

function base64Body(text: string): string {
  return wrapBase64(bytesToBase64(utf8Encode(text)));
}

export interface BuildOptions {
  /** Injectable for tests. */
  random?: () => number;
  /** Already ASCII-safe, e.g. for unsubscribe mail. */
  extraHeaders?: Record<string, string>;
}

export function buildMime(message: OutgoingMessage, options: BuildOptions = {}): string {
  const random = options.random ?? Math.random;
  const headers: string[] = [];
  if (message.from?.email) headers.push(foldHeader('From', formatAddress(message.from)));
  if (message.to.length) headers.push(foldHeader('To', formatAddressList(message.to)));
  if (message.cc.length) headers.push(foldHeader('Cc', formatAddressList(message.cc)));
  if (message.bcc.length) headers.push(foldHeader('Bcc', formatAddressList(message.bcc)));
  headers.push(`Subject: ${encodeWords(clean(message.subject))}`);
  if (message.inReplyTo) headers.push(`In-Reply-To: ${clean(message.inReplyTo)}`);
  if (message.references) headers.push(foldHeader('References', clean(message.references)));
  for (const [name, value] of Object.entries(options.extraHeaders ?? {})) headers.push(`${clean(name)}: ${clean(value)}`);
  headers.push('MIME-Version: 1.0');

  const html = message.html ?? '';
  const text = htmlToText(html);
  const altBoundary = boundary('alt', random);
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(text),
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(html),
    `--${altBoundary}--`,
  ].join(CRLF);

  if (!message.attachments.length) {
    return [...headers, alternative, ''].join(CRLF);
  }

  const mixedBoundary = boundary('mix', random);
  const parts = [`--${mixedBoundary}`, alternative];
  for (const att of message.attachments) {
    const mime = clean(att.mimeType) || 'application/octet-stream';
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${mime}; ${encodeNameParam(att.filename)}`,
      `Content-Disposition: attachment; ${encodeFilenameParams(att.filename)}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(att.data.replace(/\s+/g, '')),
    );
  }
  parts.push(`--${mixedBoundary}--`, '');
  return [...headers, `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, '', ...parts].join(CRLF);
}
