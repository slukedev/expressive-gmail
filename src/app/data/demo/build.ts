/** Expands compact fixture specs into Gmail-shaped messages: labels, threading headers, quoted replies, snippets and real attachment bytes. */
import type { Attachment, LabelId, Message } from '../types';
import { encodePng, makeCsv, makeDocx, makeIcs, makePdf, padPng, scenePreviewUrl } from './files';
import type { AttachmentSpec, MessageSpec, Person, ThreadSpec } from './fixtures/model';
import { escapeHtml, formatQuoteDate, hashString, htmlToText, snippetOf } from './util';

export interface FileEntry {
  mimeType: string;
  size: number;
  make: () => Uint8Array;
}

export interface StoredThread {
  id: string;
  messages: Message[];
  muted: boolean;
  snoozedUntil?: number;
  /** When a snooze ended; the thread sorts as if it arrived then. */
  wokeAt?: number;
}

const SYSTEM = new Set([
  'INBOX', 'STARRED', 'UNREAD', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'SNOOZED', 'SCHEDULED', 'CHAT',
  'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
]);

export function isSystemLabel(id: string): boolean {
  return SYSTEM.has(id);
}

/** PNG bytes depend only on the scene, so every backend shares them. */
const pngMemo = new Map<string, Uint8Array>();

function pngCore(spec: Extract<AttachmentSpec, { kind: 'png' }>): Uint8Array {
  const key = JSON.stringify(spec.scene);
  let bytes = pngMemo.get(key);
  if (!bytes) {
    bytes = encodePng(spec.scene);
    pngMemo.set(key, bytes);
  }
  return bytes;
}

interface QuoteParts {
  ownText: string;
  ownHtml: string;
  /** Own words plus one level of quote, which is what the next reply quotes. */
  text1: string;
  html1: string;
}

const URL_RE = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;

function textToHtml(text: string, dir?: 'rtl'): string {
  const blocks = text.split(/\n{2,}/);
  const html = blocks
    .map((b) => {
      const lines = b.split('\n').map((line) => {
        const esc = escapeHtml(line);
        return esc
          .replace(URL_RE, (u) => `<a href="${u}">${u}</a>`)
          .replace(/\[image:([\w.-]+)\]/g, (_, cid: string) => `<img src="cid:${cid}" alt="" style="max-width:100%;border-radius:8px">`);
      });
      return `<div>${lines.join('<br>')}</div>`;
    })
    .join('<div><br></div>');
  return `<div dir="${dir ?? 'ltr'}">${html}</div>`;
}

function quoteHeader(m: Message): string {
  const who = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
  return `On ${formatQuoteDate(m.date)} ${who} wrote:`;
}

function quoteHtml(m: Message, inner: string): string {
  return (
    `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(quoteHeader(m))}<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${inner}</blockquote></div>`
  );
}

function quoteText(m: Message, inner: string): string {
  return `${quoteHeader(m)}\n\n${inner
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')}`;
}

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()!.toLowerCase();
  return (
    {
      pdf: 'application/pdf',
      png: 'image/png',
      ics: 'text/calendar',
      csv: 'text/csv',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }[ext] ?? 'application/octet-stream'
  );
}

export class Builder {
  readonly files = new Map<string, FileEntry>();
  private readonly quotes = new Map<string, QuoteParts>();

  constructor(
    readonly selfEmail: string,
    private readonly now: () => number,
  ) {}

  /** For an outgoing attachment the UI uploaded. */
  addFile(id: string, entry: FileEntry) {
    this.files.set(id, entry);
  }

  private attachment(msgId: string, k: number, spec: AttachmentSpec): Attachment {
    const id = `${msgId}-a${k}`;
    const filename = spec.kind === 'ics' ? (spec.filename ?? 'invite.ics') : spec.filename;
    const mimeType = mimeFor(filename);
    const att: Attachment = { id, messageId: msgId, filename, mimeType, size: 0 };
    let entry: FileEntry;
    switch (spec.kind) {
      case 'pdf': {
        if (spec.size) {
          const lines = spec.lines;
          const size = spec.size;
          entry = { mimeType, size, make: () => makePdf(lines, size) };
        } else {
          const bytes = makePdf(spec.lines);
          entry = { mimeType, size: bytes.length, make: () => bytes };
        }
        break;
      }
      case 'png': {
        const core = pngCore(spec);
        const size = Math.max(core.length, spec.size ?? 0);
        entry = { mimeType, size, make: () => (size > core.length ? padPng(core, size) : core) };
        att.previewUrl = scenePreviewUrl(spec.scene);
        if (spec.contentId) {
          att.contentId = spec.contentId;
          att.inline = true;
        }
        break;
      }
      case 'ics': {
        const bytes = makeIcs({
          ...spec.event,
          uid: spec.event.uid ?? `${hashString(msgId).toString(16)}@calendar.example.com`,
          stamp: this.now(),
        });
        entry = { mimeType, size: bytes.length, make: () => bytes };
        break;
      }
      case 'csv': {
        const bytes = makeCsv(spec.rows);
        entry = { mimeType, size: bytes.length, make: () => bytes };
        break;
      }
      case 'docx': {
        const paragraphs = spec.paragraphs;
        const size = spec.size;
        if (size) entry = { mimeType, size, make: () => makeDocx(paragraphs, size) };
        else {
          const bytes = makeDocx(paragraphs);
          entry = { mimeType, size: bytes.length, make: () => bytes };
        }
        break;
      }
    }
    att.size = entry.size;
    this.files.set(id, entry);
    return att;
  }

  /** `prev` is the message it replies to; `threadLabels` and `unread` decide its labels. */
  message(
    id: string,
    threadId: string,
    spec: MessageSpec,
    opts: { subject: string; prev?: Message; threadLabels: LabelId[]; unread: boolean; snoozed: boolean },
  ): Message {
    const self = spec.from.email.toLowerCase() === this.selfEmail;
    const labels = new Set<LabelId>();
    const carry = opts.threadLabels.filter((l) => l === 'STARRED' || l === 'IMPORTANT' || l === 'TRASH' || !SYSTEM.has(l));
    if (spec.draft) {
      labels.add('DRAFT');
      opts.threadLabels.filter((l) => !SYSTEM.has(l)).forEach((l) => labels.add(l));
    } else if (spec.scheduled) labels.add('SCHEDULED');
    else if (self) {
      labels.add('SENT');
      carry.forEach((l) => labels.add(l));
    } else opts.threadLabels.forEach((l) => labels.add(l));
    spec.labels?.forEach((l) => labels.add(l));
    if (opts.unread && !self && !spec.draft) labels.add('UNREAD');
    if (opts.snoozed && !spec.draft) {
      labels.add('SNOOZED');
      labels.delete('INBOX');
    }

    const prev = opts.prev;
    let bodyHtml: string;
    let bodyText: string;
    let snippetSource: string;
    if (spec.html) {
      bodyHtml = spec.html;
      bodyText = htmlToText(spec.html);
      snippetSource = bodyText;
      this.quotes.set(id, { ownText: bodyText, ownHtml: bodyHtml, text1: bodyText, html1: bodyHtml });
    } else {
      const own = spec.text ?? '';
      const ownHtml = textToHtml(own, spec.dir);
      const wantQuote = (spec.quote ?? !!prev) && !!prev;
      const pq = prev ? this.quotes.get(prev.id) : undefined;
      let text1 = own;
      let html1 = ownHtml;
      bodyText = own;
      bodyHtml = ownHtml;
      if (wantQuote && prev && pq) {
        text1 = `${own}\n\n${quoteText(prev, pq.ownText)}`;
        html1 = `${ownHtml}<br>${quoteHtml(prev, pq.ownHtml)}`;
        bodyText = `${own}\n\n${quoteText(prev, pq.text1)}`;
        bodyHtml = `${ownHtml}<br>${quoteHtml(prev, pq.html1)}`;
      }
      snippetSource = own.replace(/\[image:[\w.-]+\]/g, '');
      this.quotes.set(id, { ownText: own, ownHtml, text1, html1 });
    }

    const attachments = (spec.attachments ?? []).map((a, k) => this.attachment(id, k + 1, a));
    // Inline images in text bodies read as [image: name].
    for (const a of attachments) {
      if (a.contentId) bodyText = bodyText.replace(`[image:${a.contentId}]`, `[image: ${a.filename}]`);
    }

    const messageId = `<${id}.${hashString(id).toString(36)}@mail.example.com>`;
    const refs = prev ? [prev.headers.references, prev.headers.messageId].filter(Boolean).join(' ') : undefined;
    const addr = (p: Person) => ({ name: p.name, email: p.email });
    return {
      id,
      threadId,
      labelIds: [...labels],
      from: addr(spec.from),
      to: (spec.to ?? (self ? [] : [{ name: 'Alex Rivera', email: this.selfEmail }])).map(addr),
      cc: (spec.cc ?? []).map(addr),
      bcc: (spec.bcc ?? []).map(addr),
      ...(spec.replyTo ? { replyTo: spec.replyTo.map(addr) } : {}),
      date: spec.at,
      subject: spec.subject ?? opts.subject,
      snippet: snippetOf(snippetSource),
      bodyHtml,
      bodyText,
      attachments,
      headers: {
        messageId,
        ...(prev ? { inReplyTo: prev.headers.messageId, references: refs } : {}),
        ...spec.headers,
      },
      ...(spec.draft ? { isDraft: true } : {}),
    };
  }

  thread(spec: ThreadSpec): StoredThread {
    const messages: Message[] = [];
    const received = spec.messages
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.from.email.toLowerCase() !== this.selfEmail && !m.draft);
    const unreadCount = spec.unread === true ? received.length : (spec.unread || 0);
    const unreadIdx = new Set(received.slice(received.length - unreadCount).map((r) => r.i));
    let prev: Message | undefined;
    spec.messages.forEach((ms, i) => {
      const base = spec.subject;
      const subject = i === 0 || !base ? base : /^re:/i.test(base) ? base : `Re: ${base}`;
      const msg = this.message(`${spec.id}-m${i + 1}`, spec.id, ms, {
        subject,
        prev,
        threadLabels: spec.labels,
        unread: ms.unread ?? unreadIdx.has(i),
        snoozed: spec.snoozedUntil != null,
      });
      messages.push(msg);
      if (!ms.draft) prev = msg;
    });
    return {
      id: spec.id,
      messages,
      muted: !!spec.muted,
      ...(spec.snoozedUntil != null ? { snoozedUntil: spec.snoozedUntil } : {}),
    };
  }

  /** For messages created at runtime (sent mail, drafts). */
  registerRuntime(msg: Message) {
    const ownText = msg.bodyText ?? '';
    const ownHtml = msg.bodyHtml ?? '';
    this.quotes.set(msg.id, { ownText, ownHtml, text1: ownText, html1: ownHtml });
  }

  forget(messageId: string) {
    this.quotes.delete(messageId);
    for (const k of [...this.files.keys()]) if (k.startsWith(`${messageId}-a`)) this.files.delete(k);
  }
}
