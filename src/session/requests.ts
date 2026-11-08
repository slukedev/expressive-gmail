import type { Address } from '../app/data/types';

/** Request bodies for Gmail's sync endpoints (`/sync/u/N/i/{bv,fd,s}`), copied from requests Gmail itself sent as recorded in InboxSDK, gmail.js, crouton-labs/capture and sluice. */

/** Opaque per-request bookkeeping Gmail attaches to every /i/s call. */
export interface ClientClock {
  /** Epoch ms when this client session started. */
  sessionStart: number;
  now: number;
  counter: number;
}

/**
 * /i/bv search. InboxSDK `getSyncThreadsForSearch` sends `[[null, 51, null, query]]`;
 * its interceptor reads `[0][9]` as the page start Gmail itself sends.
 */
export function threadListBody(q: string, start: number, pageSize: number): unknown[] {
  const frame: unknown[] = [null, pageSize, null, q];
  if (start > 0) {
    frame.length = 10;
    frame.fill(null, 4);
    frame[9] = start;
  }
  return [frame];
}

/**
 * /i/bv in the full shape Gmail's own inbox view sends (sluice and crouton-labs
 * captures). Used for the label list and counts, which arrive at [1] and [6].
 */
export function labelListBody(accountIndex: number, now: number): unknown[] {
  const viewType = 49;
  const frame: unknown[] = new Array(33).fill(null);
  frame[0] = viewType;
  frame[1] = 1;
  frame[3] = 'in:inbox';
  frame[4] = [null, null, null, null, 0];
  frame[5] = `itemlist-ViewType(${viewType})-${accountIndex}`;
  frame[6] = accountIndex;
  frame[7] = 1;
  frame[9] = 0;
  frame[13] = 1;
  frame[18] = 0;
  frame[27] = 1;
  frame[28] = 0;
  frame[29] = '';
  frame[32] = [now, null, null, accountIndex];
  return [frame, null, [0, 5, null, null, 1, 1, 1]];
}

/** /i/fd for whole threads, as Gmail sends it: `[[["thread-f:..", 1]], 2]`. */
export function fetchThreadsBody(threadIds: string[]): unknown[] {
  return [threadIds.map((id) => [id, 1]), 2];
}

export interface LabelOp {
  threadId: string;
  messageIds: string[];
  add: string[];
  remove: string[];
}

/**
 * /i/s label change. One op per thread: `[opId, [threadId, [x6 null, [add, remove, messageIds]]]]`,
 * from Gmail's own archive request (gmail.js test data) and the `^io_re` op it
 * sends after a reply (InboxSDK 2023 fixture).
 */
export function labelChangeBody(ops: LabelOp[], firstOpId: number, historyId: number | undefined, clock: ClientClock): unknown[] {
  const updates = ops.map((op, i) => [
    firstOpId + i,
    [op.threadId, [null, null, null, null, null, null, [nonEmpty(op.add), nonEmpty(op.remove), op.messageIds]]],
  ]);
  return [null, [updates], syncState(historyId), [clock.sessionStart, 1, clock.now, 0, clock.counter], 2];
}

/** /i/s poll Gmail sends while idle (sluice capture): answers with changes since `historyId`. */
export function pollBody(historyId: number, clock: ClientClock): unknown[] {
  return [null, null, [1, historyId, null, null, [null, 0], null, 1], [clock.sessionStart, 0, null, 0, clock.counter], 2];
}

function syncState(historyId: number | undefined): unknown[] | null {
  return historyId === undefined ? null : [1, historyId, null, null, [null, 0], null, 1];
}

function nonEmpty(list: string[]): string[] | null {
  return list.length ? list : null;
}

export const DRAFT_LABELS = ['^all', '^r', '^r_bt'];
export const SEND_LABELS = ['^all', '^pfg', '^f_bt', '^f_btns', '^f_cl'];

export interface ComposeFields {
  messageId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  labels: string[];
  /** RFC Message-ID of the message being replied to. */
  inReplyTo?: string;
  attachments?: unknown[][];
  /** "s:<16 hex>" fixed for this client session. */
  syncRef: string;
  now: number;
}

/**
 * The 52-slot message Gmail sends in /i/s compose requests. Every slot set
 * here is set the same way in Gmail's own requests (InboxSDK 2022-09-09
 * fixtures): [1] from with the address repeated at [9], [8] body parts as
 * [kind, html], [15] In-Reply-To, [42] an edit counter, [51] "s:<hex>|#<id>|0".
 */
export function composeMessage(f: ComposeFields): unknown[] {
  const m: unknown[] = new Array(52).fill(null);
  m[0] = f.messageId;
  m[1] = [1, f.from.email, f.from.name ?? null, null, null, null, null, null, null, f.from.email];
  m[2] = recipients(f.to);
  m[3] = recipients(f.cc);
  m[4] = recipients(f.bcc);
  m[6] = f.now;
  m[7] = f.subject;
  m[8] = [null, [[0, f.html]], null, null, null, null, 1];
  m[10] = f.labels;
  if (f.attachments?.length) m[11] = f.attachments;
  if (f.inReplyTo) m[15] = f.inReplyTo;
  m[17] = f.now;
  m[41] = 0;
  m[42] = [0, 0, 1, 0];
  m[51] = `${f.syncRef}|#${f.messageId}|0`;
  return m;
}

function recipients(list: Address[]): unknown[] | null {
  if (!list.length) return null;
  return list.map((a) => (a.name ? [1, a.email, a.name] : [1, a.email]));
}

/** First message of a new thread: thread slot [2]. */
export function newThreadOp(opId: number, threadId: string, subject: string, message: unknown[], now: number): unknown[] {
  return [opId, [threadId, [null, null, [[subject, null, now, threadId, [message]]]]]];
}

/** New message appended to an existing thread (reply): thread slot [1]. */
export function appendOp(opId: number, threadId: string, message: unknown[], replyToId: string | null, now: number): unknown[] {
  return [opId, [threadId, [null, [message, replyToId, 1, null, [now]]]]];
}

/** Rewrite of an existing message (draft update, or sending a draft): thread slot [13]. */
export function updateOp(opId: number, threadId: string, message: unknown[], replyToId: string | null, now: number): unknown[] {
  const slot = new Array<unknown>(14).fill(null);
  slot[13] = replyToId ? [message, replyToId, 1, null, [now]] : [message, null, 1];
  return [opId, [threadId, slot]];
}

/** Draft saves carry the client's sync state; sends carry `[null, null, 2]` instead. */
export function composeBody(kind: 'save' | 'send', ops: unknown[][], historyId: number | undefined, clock: ClientClock): unknown[] {
  if (kind === 'send') {
    return [[null, null, 2], [ops], null, [clock.sessionStart, 1, clock.now, 1, clock.counter], 2];
  }
  return [null, [ops], syncState(historyId), [clock.sessionStart, 1, clock.now, 0, clock.counter], 2];
}

/**
 * Attachment slot for an uploaded file: [mime, name, size, _, clientId, _, 0, [], _, blobRef].
 * Unverified against live Gmail: based on crouton-labs/capture `sendEmail`,
 * matching the shape of a sent attachment in gmail.js test data.
 */
export function uploadedAttachment(mimeType: string, filename: string, size: number, clientId: string, blobRef: string): unknown[] {
  return [mimeType, filename, size, null, clientId, null, 0, [], null, blobRef];
}
