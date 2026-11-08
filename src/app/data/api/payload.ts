/**
 * Reads a Gmail API MessagePart tree (format=full) into bodies, attachments and headers.
 * multipart/alternative can be nested in mixed and related, and its last part is the richest. A text part with a filename or
 * "Content-Disposition: attachment" is a file, not the body, and a forwarded message/rfc822's text isn't this message's.
 * Large bodies arrive as an attachmentId to fetch. Content-ID brackets are stripped so "cid:" matches. Tiny attachments with data
 * but no attachmentId get a synthetic "part:<partId>" id.
 */
import type { Attachment, Message } from '../types';
import { decodeBase64UrlText, decodeBytes, utf8Encode } from './base64';
import type { GmailHeader, GmailMessage, GmailMessagePart } from './gmail-types';
import { parseAddress, parseAddressList } from './address';

export function header(headers: GmailHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const h of headers) if (h.name.toLowerCase() === lower) return h.value;
  return undefined;
}

/** Lowercased type and params (keys lowercased). */
export function parseHeaderParams(value: string | undefined): { value: string; params: Record<string, string> } {
  if (!value) return { value: '', params: {} };
  const params: Record<string, string> = {};
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') inQuote = !inQuote;
    if (ch === '\\' && inQuote && i + 1 < value.length) {
      current += value[++i];
      continue;
    }
    if (ch === ';' && !inQuote) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  const main = parts.shift()!.trim().toLowerCase();
  // RFC 2231: name*=charset'lang'pct-encoded and continuations name*0=, name*1*=.
  const extended: Record<string, { idx: number; val: string; encoded: boolean }[]> = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const rawKey = p.slice(0, eq).trim().toLowerCase();
    let val = p.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
    else val = val.replace(/"/g, '');
    const m = /^([^*]+)\*(?:(\d+)\*?)?$/.exec(rawKey);
    if (m && rawKey.includes('*')) {
      const encoded = rawKey.endsWith('*');
      (extended[m[1]] ??= []).push({ idx: m[2] ? Number(m[2]) : 0, val, encoded });
    } else {
      params[rawKey] = val;
    }
  }
  for (const [key, pieces] of Object.entries(extended)) {
    pieces.sort((a, b) => a.idx - b.idx);
    let charset = 'utf-8';
    let text = '';
    pieces.forEach((piece, i) => {
      let v = piece.val;
      if (piece.encoded && i === 0) {
        const m = /^([^']*)'[^']*'(.*)$/.exec(v);
        if (m) {
          charset = m[1] || 'utf-8';
          v = m[2];
        }
      }
      text += piece.encoded ? v : encodeURIComponent(v);
    });
    params[key] = decodePercent(text, charset);
  }
  return { value: main, params };
}

function decodePercent(text: string, charset: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of utf8Encode(ch)) bytes.push(b);
    }
  }
  return decodeBytes(new Uint8Array(bytes), charset);
}

interface BodyRef {
  /** Decoded text when the API included data inline. */
  text?: string;
  /** Set when the body must be fetched with messages.attachments.get. */
  attachmentId?: string;
  charset: string;
}

export interface ParsedPayload {
  html?: BodyRef;
  text?: BodyRef;
  attachments: Attachment[];
}

function isAttachmentPart(part: GmailMessagePart): boolean {
  if (part.filename) return true;
  const disposition = parseHeaderParams(header(part.headers, 'Content-Disposition')).value;
  return disposition === 'attachment';
}

function bodyRef(part: GmailMessagePart): BodyRef {
  const charset = parseHeaderParams(header(part.headers, 'Content-Type')).params.charset ?? 'utf-8';
  if (part.body?.data) return { text: decodeBase64UrlText(part.body.data, charset), charset };
  if (part.body?.attachmentId) return { attachmentId: part.body.attachmentId, charset };
  return { text: '', charset };
}

function mimeOf(part: GmailMessagePart): string {
  return (part.mimeType ?? parseHeaderParams(header(part.headers, 'Content-Type')).value ?? '').toLowerCase();
}

interface Found {
  html?: GmailMessagePart;
  text?: GmailMessagePart;
}

/** Returns the parts so attachment collection can skip them. */
function findBodies(part: GmailMessagePart): Found {
  const mime = mimeOf(part);
  if (mime === 'text/html' && !isAttachmentPart(part)) return { html: part };
  if (mime === 'text/plain' && !isAttachmentPart(part)) return { text: part };
  if (mime === 'message/rfc822') return {};
  if (!mime.startsWith('multipart/') || !part.parts?.length) return {};

  if (mime === 'multipart/alternative') {
    // Later alternatives are preferred: walk backwards and keep the first hit per kind.
    const found: Found = {};
    for (let i = part.parts.length - 1; i >= 0; i--) {
      const sub = findBodies(part.parts[i]);
      found.html ??= sub.html;
      found.text ??= sub.text;
    }
    return found;
  }

  // Mixed, related, signed...: the first part that yields a body wins for each kind, so an attached .txt later on can't replace the real body.
  const found: Found = {};
  for (const child of part.parts) {
    const sub = findBodies(child);
    if (!found.html && !found.text) {
      found.html = sub.html;
      found.text = sub.text;
    } else {
      found.html ??= sub.html;
      found.text ??= sub.text;
    }
  }
  return found;
}

function collectAttachments(
  part: GmailMessagePart,
  messageId: string,
  skip: Set<GmailMessagePart>,
  out: Attachment[],
): void {
  if (skip.has(part)) return;
  const mime = mimeOf(part);
  const hasChildren = !!part.parts?.length;
  if (hasChildren && mime !== 'message/rfc822') {
    for (const child of part.parts!) collectAttachments(child, messageId, skip, out);
    return;
  }
  const attachmentId = part.body?.attachmentId;
  const disposition = parseHeaderParams(header(part.headers, 'Content-Disposition'));
  const isFile = !!part.filename || !!attachmentId || disposition.value === 'attachment' || mime === 'message/rfc822';
  if (!isFile) return;
  // Bare multipart containers aren't files.
  if (mime.startsWith('multipart/')) return;
  const contentId = header(part.headers, 'Content-ID')?.trim().replace(/^<|>$/g, '') || undefined;
  const inline = disposition.value === 'inline' || (!!contentId && disposition.value !== 'attachment');
  const filename =
    part.filename ||
    disposition.params.filename ||
    parseHeaderParams(header(part.headers, 'Content-Type')).params.name ||
    (mime === 'message/rfc822' ? 'message.eml' : 'attachment');
  out.push({
    id: attachmentId ?? `part:${part.partId ?? out.length}`,
    messageId,
    filename,
    mimeType: mime || 'application/octet-stream',
    size: part.body?.size ?? 0,
    ...(contentId ? { contentId } : {}),
    ...(inline ? { inline: true } : {}),
  });
}

export function parsePayload(payload: GmailMessagePart | undefined, messageId: string): ParsedPayload {
  if (!payload) return { attachments: [] };
  const found = findBodies(payload);
  const skip = new Set<GmailMessagePart>();
  if (found.html) skip.add(found.html);
  if (found.text) skip.add(found.text);
  const attachments: Attachment[] = [];
  collectAttachments(payload, messageId, skip, attachments);
  return {
    html: found.html ? bodyRef(found.html) : undefined,
    text: found.text ? bodyRef(found.text) : undefined,
    attachments,
  };
}

/** For "part:<id>" attachments that carry data inline. */
export function findPart(part: GmailMessagePart | undefined, partId: string): GmailMessagePart | undefined {
  if (!part) return undefined;
  if (part.partId === partId) return part;
  for (const child of part.parts ?? []) {
    const hit = findPart(child, partId);
    if (hit) return hit;
  }
  return undefined;
}

function parseMessageHeaders(headers: GmailHeader[] | undefined): Message['headers'] {
  const out: Message['headers'] = {};
  const set = (key: keyof Message['headers'], name: string) => {
    const v = header(headers, name);
    if (v !== undefined) out[key] = v.trim();
  };
  set('messageId', 'Message-ID');
  set('inReplyTo', 'In-Reply-To');
  set('references', 'References');
  set('listUnsubscribe', 'List-Unsubscribe');
  set('listUnsubscribePost', 'List-Unsubscribe-Post');
  set('listId', 'List-Id');
  set('bimiSelector', 'BIMI-Selector');
  return out;
}

export interface MessageBodies {
  html?: string;
  text?: string;
}

/** `bodies` overrides the inline body text, for bodies fetched separately. */
export function toMessage(msg: GmailMessage, bodies?: MessageBodies): Message {
  const headers = msg.payload?.headers;
  const parsed = parsePayload(msg.payload, msg.id);
  const labelIds = msg.labelIds ?? [];
  const dateHeader = header(headers, 'Date');
  const date = msg.internalDate ? Number(msg.internalDate) : dateHeader ? Date.parse(dateHeader) || 0 : 0;
  const replyTo = parseAddressList(header(headers, 'Reply-To'));
  const message: Message = {
    id: msg.id,
    threadId: msg.threadId,
    labelIds,
    from: parseAddress(header(headers, 'From')) ?? { email: '' },
    to: parseAddressList(header(headers, 'To')),
    cc: parseAddressList(header(headers, 'Cc')),
    bcc: parseAddressList(header(headers, 'Bcc')),
    date,
    subject: header(headers, 'Subject') ?? '',
    snippet: decodeSnippet(msg.snippet ?? ''),
    attachments: parsed.attachments,
    headers: parseMessageHeaders(headers),
  };
  if (replyTo.length) message.replyTo = replyTo;
  const html = bodies?.html ?? parsed.html?.text;
  const text = bodies?.text ?? parsed.text?.text;
  if (html !== undefined) message.bodyHtml = html;
  if (text !== undefined) message.bodyText = text;
  if (labelIds.includes('DRAFT')) message.isDraft = true;
  return message;
}

/** Gmail snippets are HTML-escaped ("&#39;", "&amp;"). */
export function decodeSnippet(snippet: string): string {
  return snippet.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m, ent: string) => {
    switch (ent) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      case 'nbsp':
        return ' ';
    }
    const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}
