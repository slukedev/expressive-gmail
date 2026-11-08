import type { Address, Attachment, Message, Thread, ThreadSummary } from '../app/data/types';
import { isMessageId, normalizeThreadId } from './ids';
import { arr, at, num, readHistoryId, str, strings } from './json';
import { mapLabels } from './labels';

/**
 * Parsers for Gmail's two thread shapes.
 *
 * Nested (an /i/fd response, InboxSDK `extractThreadsFromThreadResponse_20220909`,
 * gmail.js `parse_fd_request_payload`): `[threadId, [summary, messageRows] | null, [[msgId, details], ...]]`.
 *   summary:    [0] id, [1] subject, [2] snippet, [3] last date, [13] decimal id, [15] legacy hex id
 *   messageRow: [0] id, [1] from, [2] date, [3] labels, [6] date, [7] List-Id, [10] snippet
 *   details:    [0] to, [1] cc, [2] bcc, [3] reply-to, [4] subject, [5] body, [6] snippet,
 *               [7] Message-ID, [8] References, [9] In-Reply-To, [10] sender card ([14] name,
 *               [16] address), [13] attachments, [16] date
 *
 * Flat (bv thread rows, compose responses, gmail.js `parse_fd_embedded_json`):
 *   thread:  [0] subject, [1] snippet, [2] last date, [3] id, [4] messages
 *   message: [0] id, [1] from, [2] to, [3] cc, [4] bcc, [5] reply-to, [6] date, [7] subject,
 *            [8] body, [9] snippet, [10] labels, [11] attachments, [13] Message-ID, [17] date
 *
 * Addresses are [1, email, name?]. Labels exist only on summary rows and flat
 * messages: nested details carry none (sluice checked 114/114 records).
 */

export interface ParsedThreads {
  threads: Thread[];
  /** "<messageId> <attachmentId>" → download URL Gmail gave for it. */
  attachmentUrls: Map<string, string>;
  historyId?: number;
}

export function attachmentKey(messageId: string, attachmentId: string): string {
  return `${messageId} ${attachmentId}`;
}

export function parseThreadResponse(root: unknown): ParsedThreads {
  const attachmentUrls = new Map<string, string>();
  // A thread can appear twice (e.g. a draft and then its sent version); the later entry is newer.
  const threads = new Map<string, Thread>();
  for (const wrapper of arr(at(root, 1)) ?? []) {
    const thread = parseThreadWrapper(wrapper, attachmentUrls);
    if (!thread) continue;
    threads.delete(thread.id);
    threads.set(thread.id, thread);
  }
  return { threads: [...threads.values()], attachmentUrls, historyId: readHistoryId(root) };
}

/** Accepts a nested fd wrapper, a flat thread, or a flat thread wrapped one level deep. */
export function parseThreadWrapper(wrapper: unknown, attachmentUrls = new Map<string, string>()): Thread | undefined {
  if (isFlatThread(wrapper)) return parseFlatThread(wrapper, attachmentUrls);
  if (normalizeThreadId(at(wrapper, 0))) return parseNestedThread(wrapper, attachmentUrls);
  for (const candidate of [at(wrapper, 0), at(wrapper, 1)]) {
    if (isFlatThread(candidate)) return parseFlatThread(candidate, attachmentUrls);
  }
  return undefined;
}

export function isFlatThread(node: unknown): boolean {
  return normalizeThreadId(at(node, 3)) !== undefined && Array.isArray(at(node, 4));
}

function parseNestedThread(wrapper: unknown, attachmentUrls: Map<string, string>): Thread | undefined {
  const id = normalizeThreadId(at(wrapper, 0));
  if (!id) return undefined;
  const summary = at(wrapper, 1, 0);
  const rows = new Map<string, unknown>();
  const order: string[] = [];
  for (const row of arr(at(wrapper, 1, 1)) ?? []) {
    const msgId = at(row, 0);
    if (!isMessageId(msgId)) continue;
    rows.set(msgId, row);
    order.push(msgId);
  }
  const details = new Map<string, unknown>();
  for (const entry of arr(at(wrapper, 2)) ?? []) {
    const msgId = at(entry, 0);
    if (!isMessageId(msgId)) continue;
    details.set(msgId, at(entry, 1));
    if (!rows.has(msgId)) order.push(msgId);
  }

  const threadSubject = str(at(summary, 1));
  const messages = order.map((msgId) =>
    nestedMessage(id, msgId, rows.get(msgId), details.get(msgId), threadSubject, attachmentUrls),
  );
  return buildThread(id, messages, {
    subject: threadSubject,
    snippet: str(at(summary, 2)),
    lastDate: num(at(summary, 3)),
  });
}

function nestedMessage(
  threadId: string,
  id: string,
  row: unknown,
  d: unknown,
  threadSubject: string | undefined,
  attachmentUrls: Map<string, string>,
): Message {
  const internalLabels = strings(at(row, 3));
  const from =
    parseAddress(at(row, 1)) ??
    addressFrom(str(at(d, 10, 16)), str(at(d, 10, 14))) ?? { email: '' };
  const body = parseBody(at(d, 5));
  const references = strings(at(d, 8));
  const message: Message = {
    id,
    threadId,
    labelIds: mapLabels(internalLabels),
    from,
    to: parseAddresses(at(d, 0)),
    cc: parseAddresses(at(d, 1)),
    bcc: parseAddresses(at(d, 2)),
    date: num(at(d, 16)) ?? num(at(row, 6)) ?? num(at(row, 2)) ?? 0,
    subject: str(at(d, 4)) ?? threadSubject ?? '',
    snippet: str(at(d, 6)) ?? str(at(row, 10)) ?? '',
    attachments: [],
    headers: {},
  };
  const replyTo = parseAddresses(at(d, 3));
  if (replyTo.length) message.replyTo = replyTo;
  if (body.html !== undefined) message.bodyHtml = body.html;
  if (body.text !== undefined) message.bodyText = body.text;
  setHeader(message, 'messageId', str(at(d, 7)));
  setHeader(message, 'inReplyTo', str(at(d, 9)));
  setHeader(message, 'references', references.length ? references.join(' ') : undefined);
  // Unverified against live Gmail: a "<...>" string at row[7] matched List-Id in InboxSDK's 2018 fixture.
  const listId = str(at(row, 7));
  if (listId && /^<[^>\s]+>$/.test(listId)) message.headers.listId = listId;
  if (internalLabels.includes('^r')) message.isDraft = true;

  for (const item of arr(at(d, 13)) ?? []) {
    const info = at(item, 0, 3);
    const attachmentId = str(at(item, 0, 1));
    const url = str(at(info, 1));
    pushAttachment(message, attachmentUrls, {
      attachmentId,
      url,
      filename: str(at(info, 2)),
      mimeType: str(at(info, 3)),
      size: num(at(info, 4)),
    });
  }
  return message;
}

export function parseFlatThread(node: unknown, attachmentUrls = new Map<string, string>()): Thread | undefined {
  const id = normalizeThreadId(at(node, 3));
  if (!id) return undefined;
  const subject = str(at(node, 0));
  const messages: Message[] = [];
  for (const m of arr(at(node, 4)) ?? []) {
    const message = flatMessage(id, m, subject, attachmentUrls);
    if (message) messages.push(message);
  }
  return buildThread(id, messages, { subject, snippet: str(at(node, 1)), lastDate: num(at(node, 2)) });
}

function flatMessage(threadId: string, m: unknown, threadSubject: string | undefined, attachmentUrls: Map<string, string>): Message | undefined {
  const id = at(m, 0);
  if (!isMessageId(id)) return undefined;
  const internalLabels = strings(at(m, 10));
  const body = parseBody(at(m, 8));
  const message: Message = {
    id,
    threadId,
    labelIds: mapLabels(internalLabels),
    from: parseAddress(at(m, 1)) ?? { email: '' },
    to: parseAddresses(at(m, 2)),
    cc: parseAddresses(at(m, 3)),
    bcc: parseAddresses(at(m, 4)),
    date: num(at(m, 6)) ?? num(at(m, 17)) ?? 0,
    subject: str(at(m, 7)) ?? threadSubject ?? '',
    snippet: str(at(m, 9)) ?? '',
    attachments: [],
    headers: {},
  };
  const replyTo = parseAddresses(at(m, 5));
  if (replyTo.length) message.replyTo = replyTo;
  if (body.html !== undefined) message.bodyHtml = body.html;
  if (body.text !== undefined) message.bodyText = body.text;
  setHeader(message, 'messageId', str(at(m, 13)));
  if (internalLabels.includes('^r')) message.isDraft = true;

  for (const item of arr(at(m, 11)) ?? []) {
    pushAttachment(message, attachmentUrls, {
      mimeType: str(at(item, 0)),
      filename: str(at(item, 1)),
      size: num(at(item, 2)),
      attachmentId: str(at(item, 3)),
      url: str(at(item, 5)),
    });
  }
  return message;
}

/**
 * Body is [null, parts, ...] with each part [kind, null, [null, html], hash] in
 * responses ([kind, html] in requests). Kinds seen: 0 content, 1 signature,
 * 2 quoted text, 3 trailing block; Gmail renders them concatenated.
 */
function parseBody(node: unknown): { html?: string; text?: string } {
  const parts = arr(at(node, 1));
  if (!parts) return {};
  let content = '';
  let found = false;
  for (const part of parts) {
    const piece = str(at(part, 2, 1)) ?? str(at(part, 1));
    if (piece === undefined) continue;
    content += piece;
    found = true;
  }
  if (!found) return {};
  // Unverified against live Gmail: every fixture has [6] = 1; 0 is assumed to mean plain text.
  return at(node, 6) === 0 ? { text: content } : { html: content };
}

interface RawAttachment {
  attachmentId?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
}

function pushAttachment(message: Message, urls: Map<string, string>, raw: RawAttachment) {
  if (!raw.attachmentId) return;
  const attachment: Attachment = {
    id: raw.attachmentId,
    messageId: message.id,
    filename: raw.filename ?? 'attachment',
    mimeType: raw.mimeType ?? 'application/octet-stream',
    size: raw.size ?? 0,
  };
  // Gmail-composed inline images carry realattid=ii_<id>, which is also their Content-ID.
  const realId = raw.url ? /[?&]realattid=(ii_[^&#]+)/.exec(raw.url)?.[1] : undefined;
  if (realId) attachment.contentId = realId;
  if (realId || referencedInBody(message.bodyHtml, raw.attachmentId)) attachment.inline = true;
  message.attachments.push(attachment);
  if (raw.url) urls.set(attachmentKey(message.id, raw.attachmentId), raw.url);
}

/** Gmail rewrites cid: images to its own URLs, which name the part with attid=. */
function referencedInBody(html: string | undefined, attachmentId: string): boolean {
  if (!html) return false;
  const escaped = attachmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[?&](?:amp;)?attid=${escaped}(?=[&"'#\\s]|$)`).test(html);
}

function setHeader(message: Message, key: keyof Message['headers'], value: string | undefined) {
  if (value) message.headers[key] = value;
}

function parseAddress(node: unknown): Address | undefined {
  return addressFrom(str(at(node, 1)), str(at(node, 2)));
}

function addressFrom(email: string | undefined, name: string | undefined): Address | undefined {
  if (!email) return undefined;
  return name ? { name, email } : { email };
}

function parseAddresses(node: unknown): Address[] {
  const out: Address[] = [];
  for (const entry of arr(node) ?? []) {
    const address = parseAddress(entry);
    if (address) out.push(address);
  }
  return out;
}

const CHIP_LIMIT = 3;

/** Thread-level fields derived from its messages, the way Gmail's list rows show them. */
function summarize(id: string, messages: Message[], hints: { subject?: string; snippet?: string; lastDate?: number }): ThreadSummary {
  const sent = messages.filter((m) => !m.isDraft);
  const labels = new Set(messages.flatMap((m) => m.labelIds));
  const participants: Address[] = [];
  for (const m of sent) {
    if (!m.from.email) continue;
    const existing = participants.findIndex((p) => p.email.toLowerCase() === m.from.email.toLowerCase());
    if (existing >= 0) participants.splice(existing, 1);
    participants.push(m.from);
  }
  const files = messages.flatMap((m) => m.attachments.filter((a) => !a.inline));
  const newest = messages.reduce((max, m) => Math.max(max, m.date), 0);
  const summary: ThreadSummary = {
    id,
    subject: hints.subject || messages.find((m) => m.subject)?.subject || '',
    snippet: hints.snippet ?? messages[messages.length - 1]?.snippet ?? '',
    labelIds: [...labels],
    participants,
    recipients: sent[sent.length - 1]?.to,
    messageCount: sent.length,
    draftCount: messages.length - sent.length,
    lastDate: hints.lastDate ?? newest,
    hasAttachments: files.length > 0,
    attachments: files.slice(0, CHIP_LIMIT).map(({ id: attId, filename, mimeType, messageId, size }) => ({
      id: attId,
      filename,
      mimeType,
      messageId,
      size: size || undefined,
    })),
  };
  const scheduled = messages.find((m) => m.labelIds.includes('SCHEDULED'));
  if (scheduled) summary.scheduledFor = scheduled.date;
  // Rows carry decoded file sizes; Gmail stores (and size-searches) them base64 encoded, a third larger.
  const fileBytes = messages.reduce((sum, m) => sum + m.attachments.reduce((s, a) => s + a.size, 0), 0);
  if (fileBytes) summary.size = Math.round((fileBytes * 4) / 3);
  return summary;
}

function buildThread(id: string, messages: Message[], hints: { subject?: string; snippet?: string; lastDate?: number }): Thread {
  messages.sort((a, b) => a.date - b.date);
  return { ...summarize(id, messages, hints), messages };
}
