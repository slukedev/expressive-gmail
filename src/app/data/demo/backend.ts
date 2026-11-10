/** An in-memory mailbox that behaves like Gmail, deterministic from `seed` and `now()`, so the preview always looks current and tests can pin the clock. */
import { BackendError, type BackendEvent, type MailBackend } from '../backend';
import { ALL_GEMINI_FEATURES, type GeminiRequest, type GeminiResult, type GeminiStatus } from '../gemini';
import { demoGemini, streamedText, type DemoGeminiMode } from './gemini';
import type {
  Account,
  Address,
  Attachment,
  BackendCapabilities,
  Contact,
  Draft,
  Filter,
  Label,
  LabelChange,
  LabelId,
  MailChange,
  Message,
  OutgoingMessage,
  Thread,
  ThreadPage,
  ThreadQuery,
  ThreadSummary,
} from '../types';
import { avatarUrl } from './avatar';
import { Builder, isSystemLabel, type StoredThread } from './build';
import { createCtx, L, type Person } from './fixtures/model';
import { accountPeople } from './fixtures/people';
import { SYSTEM_LABELS } from './fixtures/labels';
import { welcomeThread } from './fixtures';
import { PERSONAS, type Persona, type PersonaId } from './fixtures/personas';
import { LIVE_ITEMS } from './fixtures/live';
import {
  compileQuery,
  fold,
  normalizeLabelName,
  type IndexedMessage,
  type IndexedThread,
  type SearchEnv,
} from './search';
import { createRng, fromBase64, hashString, htmlToText, snippetOf, toBase64 } from './util';

export const DEMO_NOTICE =
  'Demo mailbox. Every person, company, message and attachment here is fictional and generated for previews and tests.';

export interface DemoBackendOptions {
  /** Tests should always pass one. */
  now?: () => number;
  /** Simulated latency per call, ms. */
  latencyMs?: number;
  seed?: number;
  /** A brand new account with only a welcome message. */
  empty?: boolean;
  /** 0..1 chance that a call throws a retryable network error. */
  failRate?: number;
  /** One new message about every 90 s of `now()` time. */
  liveMail?: boolean;
  /** To test big-number layouts. */
  unreadBoost?: number;
  /** Like Google's autocomplete endpoint going away. */
  contactsFail?: boolean;
  /** Label writes are acknowledged at once but show up in reads this much later, the way Gmail's session endpoints lag behind a write. */
  writeLagMs?: number;
  /** Like the session backend. */
  noDeleteForever?: boolean;
  /** Like the Gmail API source (`?schedule=off`). */
  noSchedule?: boolean;
  /** Like the session source (`?labels=readonly`). */
  noLabelEdit?: boolean;
  /** Default 'main'. */
  persona?: PersonaId;
  /** `?gemini=`: ready (default), not in the plan, smart features off, or failing. */
  gemini?: DemoGeminiMode;
  /** Before it starts answering, then to stream. Defaults follow latency. */
  geminiDelayMs?: number;
}

export const LIVE_MAIL_INTERVAL_MS = 90_000;
const DEFAULT_PAGE_SIZE = 50;
const MUTED = 'MUTED';

const CAPABILITIES: BackendCapabilities = {
  send: true,
  drafts: true,
  snooze: true,
  scheduleSend: true,
  mute: true,
  labelsEdit: true,
  filters: true,
  contacts: true,
  attachments: true,
  deleteForever: true,
  changes: true,
};

const NOT_ADDABLE = new Set(['DRAFT', 'SENT', 'SCHEDULED', 'SNOOZED', 'CHAT']);

/** Derived from the draft's message id, so the UI can find them from a thread. */
export function draftIdFor(messageId: string): string {
  return `r-${messageId}`;
}

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

function encodeToken(sortDate: number, id: string): string {
  return toBase64(new TextEncoder().encode(`v1|${sortDate}|${id}`)).replace(/=+$/, '');
}

function decodeToken(token: string): { sortDate: number; id: string } {
  try {
    const raw = new TextDecoder().decode(fromBase64(token));
    const [v, d, ...rest] = raw.split('|');
    const sortDate = Number(d);
    if (v !== 'v1' || !Number.isFinite(sortDate) || rest.length === 0) throw new Error('bad');
    return { sortDate, id: rest.join('|') };
  } catch {
    throw new BackendError('Invalid page token', 'unknown');
  }
}

class DemoBackend implements MailBackend {
  readonly kind = 'demo' as const;
  readonly capabilities: BackendCapabilities;

  private readonly clock: () => number;
  private readonly latencyMs: number;
  private readonly writeLagMs: number;
  private readonly failRate: number;
  private readonly liveMail: boolean;
  private readonly unreadBoost: number;
  private readonly contactsFail: boolean;
  private readonly latencyRng: () => number;
  private readonly failRng: () => number;
  private readonly builder: Builder;
  private readonly persona: Persona;
  private readonly self: Person;

  private threads = new Map<string, StoredThread>();
  private messageThread = new Map<string, string>();
  private index = new Map<string, IndexedThread>();
  private labels = new Map<string, Label>();
  private drafts = new Map<string, string>(); // draftId -> messageId
  private filters: Filter[] = [];
  private people = new Map<string, Person>();

  private readonly geminiMode: DemoGeminiMode;
  private readonly geminiDelayMs: number;
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly geminiRuns = new Map<string, () => void>();

  private changedThreads = new Set<string>();
  private labelsChanged = false;

  private seq = 1000;
  private nextLive: number;
  private liveCursor: number;
  private liveCount = 0;

  constructor(opts: DemoBackendOptions) {
    this.clock = opts.now ?? (() => Date.now());
    this.latencyMs = opts.latencyMs ?? 0;
    this.failRate = opts.failRate ?? 0;
    this.persona = PERSONAS[opts.persona ?? 'main'];
    this.self = this.persona.self;
    this.liveMail = opts.liveMail ?? this.persona.liveMail;
    this.unreadBoost = Math.max(0, opts.unreadBoost ?? 0);
    this.contactsFail = opts.contactsFail ?? false;
    this.writeLagMs = Math.max(0, opts.writeLagMs ?? 0);
    this.geminiMode = opts.gemini ?? 'ready';
    this.geminiDelayMs = opts.geminiDelayMs ?? Math.min(900, this.latencyMs * 3);
    this.capabilities = {
      ...CAPABILITIES,
      ...(opts.noDeleteForever ? { deleteForever: false } : {}),
      ...(opts.noSchedule ? { scheduleSend: false } : {}),
      ...(opts.noLabelEdit ? { labelsEdit: false } : {}),
    };
    const seed = opts.seed ?? 1;
    this.latencyRng = createRng(seed * 7 + 3);
    this.failRng = createRng(seed * 13 + 5);
    const start = this.clock();
    this.nextLive = start + LIVE_MAIL_INTERVAL_MS;
    this.liveCursor = Math.floor(createRng(seed * 31 + 11)() * LIVE_ITEMS.length);
    this.builder = new Builder(this.self.email, this.clock);

    if (this.persona.id === 'main') for (const p of accountPeople()) this.people.set(p.email.toLowerCase(), p);
    const ctx = createCtx(start, createRng(seed));
    if (opts.empty) {
      this.addThread(this.builder.thread(welcomeThread(ctx)));
    } else {
      for (const l of this.persona.labels) this.labels.set(l.id, { ...l });
      const box = this.persona.mailbox(ctx);
      for (const spec of box.threads) this.addThread(this.builder.thread(spec));
      for (const p of box.people) this.people.set(p.email.toLowerCase(), p);
      box.filters.forEach((f, i) => this.filters.push({ ...f, id: `filter-${i + 1}` }));
    }
    this.seq = 1000;
    this.ensureDraftIds();
  }

  private now(): number {
    return this.clock();
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq.toString(36)}`;
  }

  private async run<T>(fn: () => T): Promise<T> {
    if (this.latencyMs > 0) {
      const ms = this.latencyMs * (0.6 + 0.8 * this.latencyRng());
      await new Promise((r) => setTimeout(r, ms));
    }
    if (this.failRate > 0 && this.failRng() < this.failRate) {
      throw new BackendError('The demo network dropped this request', 'network', true);
    }
    this.tick();
    return clone(fn());
  }

  private addThread(t: StoredThread) {
    this.threads.set(t.id, t);
    for (const m of t.messages) this.messageThread.set(m.id, t.id);
    this.index.delete(t.id);
  }

  private touch(threadId: string, labels = true) {
    this.index.delete(threadId);
    this.changedThreads.add(threadId);
    if (labels) this.labelsChanged = true;
  }

  private mustThread(id: string): StoredThread {
    const t = this.threads.get(id);
    if (!t) throw new BackendError(`Thread ${id} not found`, 'not-found');
    return t;
  }

  private mustThreads(ids: string[]): StoredThread[] {
    return ids.map((id) => this.mustThread(id));
  }

  private findMessage(messageId: string): { thread: StoredThread; message: Message } {
    const tid = this.messageThread.get(messageId);
    const thread = tid ? this.threads.get(tid) : undefined;
    const message = thread?.messages.find((m) => m.id === messageId);
    if (!thread || !message) throw new BackendError(`Message ${messageId} not found`, 'not-found');
    return { thread, message };
  }

  private labelExists(id: string): boolean {
    return isSystemLabel(id) || this.labels.has(id);
  }

  /** Applies everything that should have happened by now(): wake-ups, scheduled sends, live mail. */
  private tick() {
    const now = this.now();
    for (const t of this.threads.values()) {
      if (t.snoozedUntil != null && t.snoozedUntil <= now) this.wake(t);
      for (const m of t.messages) {
        if (m.labelIds.includes('SCHEDULED') && !m.labelIds.includes('TRASH') && m.date <= now) {
          this.deliverScheduled(t, m);
        }
      }
    }
    if (this.liveMail) {
      let delivered = 0;
      while (this.nextLive <= now && delivered < 3) {
        this.deliverLive(this.nextLive);
        this.nextLive += LIVE_MAIL_INTERVAL_MS;
        delivered++;
      }
      // A big clock jump: don't flood the inbox, just pick up the rhythm again.
      if (this.nextLive <= now) this.nextLive = now + LIVE_MAIL_INTERVAL_MS;
    }
  }

  private wake(t: StoredThread) {
    const at = t.snoozedUntil!;
    for (const m of t.messages) {
      m.labelIds = m.labelIds.filter((l) => l !== 'SNOOZED');
      if (!m.isDraft && !m.labelIds.includes('INBOX')) m.labelIds.push('INBOX');
    }
    const last = [...t.messages].reverse().find((m) => !m.isDraft);
    if (last && !last.labelIds.includes('UNREAD')) last.labelIds.push('UNREAD');
    delete t.snoozedUntil;
    t.wokeAt = at;
    this.touch(t.id);
  }

  private deliverScheduled(t: StoredThread, m: Message) {
    m.labelIds = m.labelIds.filter((l) => l !== 'SCHEDULED');
    m.labelIds.push('SENT');
    if (this.addressedToSelf(m)) m.labelIds.push('INBOX');
    this.touch(t.id);
  }

  private addressedToSelf(m: Pick<Message, 'to' | 'cc' | 'bcc'>): boolean {
    return [...m.to, ...m.cc, ...m.bcc].some((a) => a.email.toLowerCase() === this.self.email);
  }

  private deliverLive(at: number) {
    const item = LIVE_ITEMS[this.liveCursor % LIVE_ITEMS.length]!;
    this.liveCursor++;
    this.liveCount++;
    const n = this.liveCount;
    const target = item.replyTo ? this.threads.get(item.replyTo) : undefined;
    if (target && item.message && !target.messages.every((m) => m.labelIds.includes('TRASH'))) {
      const spec = item.message(at);
      const prev = [...target.messages].reverse().find((m) => !m.isDraft);
      const base = target.messages[0]?.subject ?? '';
      const keep = new Set<LabelId>(['CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS', 'IMPORTANT']);
      const threadLabels = [...new Set(target.messages.flatMap((m) => m.labelIds))].filter((l) => keep.has(l) || !isSystemLabel(l));
      if (!target.muted) threadLabels.push('INBOX');
      const msg = this.builder.message(`${target.id}-live${n}`, target.id, spec, {
        subject: /^re:/i.test(base) || !base ? base : `Re: ${base}`,
        prev,
        threadLabels,
        unread: true,
        snoozed: target.snoozedUntil != null,
      });
      this.applyFilters(msg);
      target.messages.push(msg);
      this.messageThread.set(msg.id, target.id);
      this.touch(target.id);
      return;
    }
    const spec = item.thread(at);
    const built = this.builder.thread({ ...spec, id: `live-${n}`, unread: true });
    for (const m of built.messages) this.applyFilters(m);
    this.addThread(built);
    this.touch(built.id);
  }

  private applyFilters(m: Message) {
    if (this.filters.length === 0) return;
    const probe: StoredThread = { id: '__probe', messages: [m], muted: false };
    const idx = this.buildIndex(probe);
    for (const f of this.filters) {
      const parts: string[] = [];
      const c = f.criteria;
      if (c.from) parts.push(`from:(${c.from})`);
      if (c.to) parts.push(`to:(${c.to})`);
      if (c.subject) parts.push(`subject:(${c.subject})`);
      if (c.query) parts.push(`(${c.query})`);
      if (c.negatedQuery) parts.push(`-(${c.negatedQuery})`);
      if (c.hasAttachment) parts.push('has:attachment');
      if (parts.length === 0) continue;
      if (!compileQuery(parts.join(' '), this.searchEnv())(idx)) continue;
      const add = (f.action.addLabelIds ?? []).filter((l) => this.labelExists(l));
      const remove = new Set(f.action.removeLabelIds ?? []);
      m.labelIds = [...new Set([...m.labelIds.filter((l) => !remove.has(l)), ...add])];
    }
  }

  private searchEnv(): SearchEnv {
    const byName = new Map<string, string>();
    for (const l of SYSTEM_LABELS) {
      byName.set(normalizeLabelName(l.id), l.id);
      byName.set(normalizeLabelName(l.name), l.id);
    }
    for (const l of this.labels.values()) byName.set(normalizeLabelName(l.name), l.id);
    return {
      now: this.now(),
      selfEmail: this.self.email,
      resolveLabel: (name) => byName.get(normalizeLabelName(name)) ?? (this.labels.has(name) ? name : undefined),
      userLabelIds: new Set(this.labels.keys()),
    };
  }

  private buildIndex(t: StoredThread): IndexedThread {
    const labels = new Set<string>();
    let allTrash = true;
    let allSpam = true;
    let anyTrash = false;
    let anySpam = false;
    const messages: IndexedMessage[] = t.messages.map((m) => {
      m.labelIds.forEach((l) => labels.add(l));
      const trash = m.labelIds.includes('TRASH');
      const spam = m.labelIds.includes('SPAM');
      allTrash &&= trash;
      allSpam &&= spam;
      anyTrash ||= trash;
      anySpam ||= spam;
      const addr = (a: Address) => fold(`${a.name ?? ''} ${a.email}`.trim());
      const files = m.attachments.map((a) => fold(a.filename));
      const text = fold(
        [
          m.subject,
          m.bodyText ?? htmlToText(m.bodyHtml ?? ''),
          addr(m.from),
          ...m.to.map(addr),
          ...m.cc.map(addr),
          ...files,
        ].join('\n'),
      );
      return {
        from: addr(m.from),
        fromEmail: fold(m.from.email),
        to: m.to.map(addr),
        toEmails: m.to.map((a) => fold(a.email)),
        cc: m.cc.map(addr),
        bcc: m.bcc.map(addr),
        subject: fold(m.subject),
        text,
        filenames: files,
        hasAttachment: m.attachments.some((a) => !a.inline),
        size: (m.bodyText?.length ?? 0) + (m.bodyHtml?.length ?? 0) + m.attachments.reduce((s, a) => s + a.size, 0),
        date: m.date,
        listId: fold(m.headers.listId ?? ''),
        rfcId: fold((m.headers.messageId ?? '').replace(/^<|>$/g, '')),
      };
    });
    return { labels, allTrash, allSpam, anyTrash, anySpam, muted: t.muted, messages };
  }

  private indexed(t: StoredThread): IndexedThread {
    let idx = this.index.get(t.id);
    if (!idx) {
      idx = this.buildIndex(t);
      this.index.set(t.id, idx);
    }
    return idx;
  }

  private delivered(t: StoredThread): Message[] {
    const d = t.messages.filter((m) => !m.isDraft && !m.labelIds.includes('SCHEDULED'));
    return d.length ? d : t.messages;
  }

  private lastDate(t: StoredThread): number {
    return Math.max(...this.delivered(t).map((m) => m.date));
  }

  private sortDate(t: StoredThread): number {
    return Math.max(this.lastDate(t), t.wokeAt ?? 0);
  }

  private summary(t: StoredThread): ThreadSummary {
    const shown = this.delivered(t);
    const last = shown[shown.length - 1]!;
    const participants: Address[] = [];
    const seen = new Set<string>();
    for (const m of t.messages.filter((x) => !x.isDraft)) {
      const key = m.from.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      participants.push({ ...m.from });
    }
    const labelIds = [...new Set(t.messages.flatMap((m) => m.labelIds))];
    if (t.muted) labelIds.push(MUTED);
    const files = t.messages.flatMap((m) => m.attachments.filter((a) => !a.inline));
    const scheduled = t.messages.filter((m) => m.labelIds.includes('SCHEDULED') && !m.labelIds.includes('TRASH'));
    return {
      id: t.id,
      subject: t.messages[0]!.subject,
      snippet: last.snippet,
      labelIds,
      participants,
      recipients: last.to,
      messageCount: t.messages.filter((m) => !m.isDraft).length,
      draftCount: t.messages.filter((m) => m.isDraft).length,
      lastDate: this.lastDate(t),
      hasAttachments: files.length > 0,
      attachments: files
        .slice(0, 3)
        .map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, messageId: a.messageId, size: a.size, ...(a.previewUrl ? { previewUrl: a.previewUrl } : {}) })),
      size: this.indexed(t).messages.reduce((sum, m) => sum + m.size, 0),
      ...(t.snoozedUntil != null ? { snoozedUntil: t.snoozedUntil } : {}),
      ...(scheduled.length ? { scheduledFor: Math.min(...scheduled.map((m) => m.date)) } : {}),
    };
  }

  /** Known up front, like the session backend reading Gmail's page. */
  async accountHint(): Promise<string | undefined> {
    return this.self.email;
  }

  getAccount(): Promise<Account> {
    const { self, photo, index, sendAs, signature } = this.persona;
    return this.run(() => ({
      email: self.email,
      name: self.name,
      photoUrl: avatarUrl(photo),
      index,
      sendAs,
      ...(signature ? { signature } : {}),
    }));
  }

  listLabels(): Promise<Label[]> {
    return this.run(() => {
      const total = new Map<string, number>();
      const unread = new Map<string, number>();
      /** Each category's inbox tab, as Gmail counts it beside the label. */
      const tab = new Map<string, number>();
      for (const t of this.threads.values()) {
        const idx = this.indexed(t);
        const isUnread = idx.labels.has('UNREAD');
        for (const l of idx.labels) {
          const counts =
            l === 'TRASH' ? idx.anyTrash : l === 'SPAM' ? idx.anySpam && !idx.allTrash : !idx.allTrash && !idx.allSpam;
          if (!counts) continue;
          total.set(l, (total.get(l) ?? 0) + 1);
          if (isUnread) unread.set(l, (unread.get(l) ?? 0) + 1);
          if (isUnread && l.startsWith('CATEGORY_') && idx.labels.has('INBOX') && !idx.allTrash && !idx.allSpam) tab.set(l, (tab.get(l) ?? 0) + 1);
        }
      }
      if (this.unreadBoost) {
        for (const id of ['INBOX', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'SPAM', L.work]) {
          unread.set(id, (unread.get(id) ?? 0) + this.unreadBoost);
          total.set(id, (total.get(id) ?? 0) + this.unreadBoost);
        }
      }
      const out: Label[] = [];
      for (const l of SYSTEM_LABELS) {
        out.push({
          ...l,
          totalCount: l.id === 'DRAFT' ? this.drafts.size : (total.get(l.id) ?? 0),
          unreadCount: l.id === 'DRAFT' ? 0 : (unread.get(l.id) ?? 0),
          ...(l.id.startsWith('CATEGORY_') ? { inboxUnreadCount: tab.get(l.id) ?? 0 } : {}),
        });
      }
      const user = [...this.labels.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (const l of user) out.push({ ...l, totalCount: total.get(l.id) ?? 0, unreadCount: unread.get(l.id) ?? 0 });
      return out;
    });
  }

  listThreads(query: ThreadQuery): Promise<ThreadPage> {
    return this.run(() => {
      const pred = compileQuery(query.q ?? '', this.searchEnv());
      const matched = [...this.threads.values()]
        .filter((t) => pred(this.indexed(t)))
        .map((t) => ({ t, key: this.sortDate(t) }))
        .sort((a, b) => b.key - a.key || (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0));
      const size = Math.max(1, Math.min(500, query.pageSize ?? DEFAULT_PAGE_SIZE));
      let start = 0;
      if (query.pageToken) {
        const after = decodeToken(query.pageToken);
        start = matched.findIndex((x) => x.key < after.sortDate || (x.key === after.sortDate && x.t.id > after.id));
        if (start < 0) start = matched.length;
      }
      const page = matched.slice(start, start + size);
      const last = page[page.length - 1];
      return {
        threads: page.map((x) => this.summary(x.t)),
        resultSizeEstimate: matched.length,
        ...(last && start + size < matched.length ? { nextPageToken: encodeToken(last.key, last.t.id) } : {}),
      };
    });
  }

  getThread(threadId: string): Promise<Thread> {
    return this.run(() => {
      const t = this.mustThread(threadId);
      return { ...this.summary(t), messages: t.messages };
    });
  }

  modifyThreads(threadIds: string[], change: LabelChange): Promise<void> {
    return this.run(() => {
      const add = change.add ?? [];
      const remove = change.remove ?? [];
      for (const l of [...add, ...remove]) {
        if (!this.labelExists(l)) throw new BackendError(`Label ${l} not found`, 'not-found');
      }
      for (const l of add) {
        if (NOT_ADDABLE.has(l)) throw new BackendError(`${l} can't be added directly`, 'unsupported');
      }
      const threads = this.mustThreads(threadIds);
      this.lagged(() => {
        for (const t of threads) {
          for (const m of t.messages) {
            const set = new Set(m.labelIds);
            for (const l of remove) set.delete(l);
            for (const l of add) {
              if (m.isDraft && isSystemLabel(l)) continue;
              set.add(l);
            }
            m.labelIds = [...set];
          }
          if (remove.includes('SNOOZED')) delete t.snoozedUntil;
          this.touch(t.id);
        }
      });
    });
  }

  /** Applies a write now, or after the simulated lag. */
  private lagged(apply: () => void) {
    if (this.writeLagMs) setTimeout(apply, this.writeLagMs);
    else apply();
  }

  trashThreads(threadIds: string[]): Promise<void> {
    return this.run(() => {
      const threads = this.mustThreads(threadIds);
      this.lagged(() => {
        for (const t of threads) {
          for (const m of t.messages) {
            m.labelIds = m.labelIds.filter((l) => l !== 'SNOOZED');
            if (!m.labelIds.includes('TRASH')) m.labelIds.push('TRASH');
          }
          delete t.snoozedUntil;
          this.touch(t.id);
        }
      });
    });
  }

  untrashThreads(threadIds: string[]): Promise<void> {
    return this.run(() => {
      for (const t of this.mustThreads(threadIds)) {
        for (const m of t.messages) m.labelIds = m.labelIds.filter((l) => l !== 'TRASH');
        this.touch(t.id);
      }
    });
  }

  deleteThreadsForever(threadIds: string[]): Promise<void> {
    return this.run(() => {
      for (const t of this.mustThreads(threadIds)) {
        for (const m of t.messages) {
          this.messageThread.delete(m.id);
          this.builder.forget(m.id);
        }
        for (const [draftId, mid] of this.drafts) if (t.messages.some((m) => m.id === mid)) this.drafts.delete(draftId);
        this.threads.delete(t.id);
        this.touch(t.id);
      }
    });
  }

  async emptyFolder(folder: 'trash' | 'spam'): Promise<number> {
    const label = folder === 'trash' ? 'TRASH' : 'SPAM';
    const ids = [...this.threads.values()].filter((t) => t.messages.some((m) => m.labelIds.includes(label))).map((t) => t.id);
    await this.deleteThreadsForever(ids);
    return ids.length;
  }

  snoozeThreads(threadIds: string[], until: number): Promise<void> {
    return this.run(() => {
      if (!(until > this.now())) throw new BackendError('Snooze time must be in the future', 'unknown');
      for (const t of this.mustThreads(threadIds)) {
        for (const m of t.messages) {
          if (m.isDraft) continue;
          m.labelIds = m.labelIds.filter((l) => l !== 'INBOX');
          if (!m.labelIds.includes('SNOOZED')) m.labelIds.push('SNOOZED');
        }
        t.snoozedUntil = until;
        delete t.wokeAt;
        this.touch(t.id);
      }
    });
  }

  unsnoozeThreads(threadIds: string[]): Promise<void> {
    return this.run(() => {
      for (const t of this.mustThreads(threadIds)) {
        if (t.snoozedUntil == null && !t.messages.some((m) => m.labelIds.includes('SNOOZED'))) continue;
        for (const m of t.messages) {
          if (m.isDraft) continue;
          m.labelIds = m.labelIds.filter((l) => l !== 'SNOOZED');
          if (!m.labelIds.includes('INBOX')) m.labelIds.push('INBOX');
        }
        delete t.snoozedUntil;
        this.touch(t.id);
      }
    });
  }

  muteThreads(threadIds: string[], muted: boolean): Promise<void> {
    return this.run(() => {
      for (const t of this.mustThreads(threadIds)) {
        t.muted = muted;
        if (muted) for (const m of t.messages) m.labelIds = m.labelIds.filter((l) => l !== 'INBOX');
        this.touch(t.id);
      }
    });
  }

  private outgoingMessage(id: string, threadId: string, msg: OutgoingMessage, labels: LabelId[], date: number, prev?: Message): Message {
    const attachments: Attachment[] = msg.attachments.map((a, k) => {
      const attId = `${id}-a${k + 1}`;
      const data = a.data;
      const bytes = fromBase64(data);
      this.builder.addFile(attId, { mimeType: a.mimeType, size: bytes.length, make: () => bytes });
      return { id: attId, messageId: id, filename: a.filename, mimeType: a.mimeType, size: bytes.length };
    });
    const text = htmlToText(msg.html);
    const from = msg.from ?? { name: this.self.name, email: this.self.email };
    const m: Message = {
      id,
      threadId,
      labelIds: labels,
      from: { ...from },
      to: msg.to.map((a) => ({ ...a })),
      cc: msg.cc.map((a) => ({ ...a })),
      bcc: msg.bcc.map((a) => ({ ...a })),
      date,
      subject: msg.subject,
      snippet: snippetOf(text.split(/\nOn .+ wrote:\n/)[0] ?? text),
      bodyHtml: msg.html,
      bodyText: text,
      attachments,
      headers: {
        messageId: `<${id}.${hashString(id).toString(36)}@mail.example.com>`,
        ...(msg.inReplyTo || prev?.headers.messageId ? { inReplyTo: msg.inReplyTo ?? prev?.headers.messageId } : {}),
        ...(msg.references || prev ? { references: msg.references ?? [prev?.headers.references, prev?.headers.messageId].filter(Boolean).join(' ') } : {}),
      },
    };
    this.builder.registerRuntime(m);
    return m;
  }

  /** Threads show drafts by message id; accept that as well as the draft id. */
  private draftKey(id: string): string {
    return this.drafts.has(id) || !this.drafts.has(draftIdFor(id)) ? id : draftIdFor(id);
  }

  /** Returns the thread it lived in. */
  private takeDraft(draftId: string): { thread: StoredThread; message: Message } {
    draftId = this.draftKey(draftId);
    const mid = this.drafts.get(draftId);
    if (!mid) throw new BackendError(`Draft ${draftId} not found`, 'not-found');
    const found = this.findMessage(mid);
    found.thread.messages = found.thread.messages.filter((m) => m.id !== mid);
    this.messageThread.delete(mid);
    this.drafts.delete(draftId);
    this.builder.forget(mid);
    return found;
  }

  send(message: OutgoingMessage): Promise<{ id: string; threadId: string }> {
    return this.run(() => {
      if (message.to.length + message.cc.length + message.bcc.length === 0) {
        throw new BackendError('Add at least one recipient', 'unknown');
      }
      if (message.threadId) this.mustThread(message.threadId);
      let thread: StoredThread | undefined = message.threadId ? this.threads.get(message.threadId) : undefined;
      if (message.draftId) {
        const { thread: draftThread } = this.takeDraft(message.draftId);
        if (!thread) thread = draftThread;
        else if (draftThread !== thread && draftThread.messages.length === 0) {
          this.threads.delete(draftThread.id);
          this.touch(draftThread.id);
        }
      }
      const now = this.now();
      const scheduled = message.sendAt != null && message.sendAt > now;
      if (!thread) {
        thread = { id: this.id('t'), messages: [], muted: false };
        this.threads.set(thread.id, thread);
      }
      const prev = [...thread.messages].reverse().find((m) => !m.isDraft);
      const labels: LabelId[] = scheduled ? ['SCHEDULED'] : ['SENT'];
      if (!scheduled && this.addressedToSelf(message)) labels.push('INBOX');
      const m = this.outgoingMessage(this.id('m'), thread.id, message, labels, scheduled ? message.sendAt! : now, prev);
      thread.messages.push(m);
      thread.messages.sort((a, b) => a.date - b.date);
      this.messageThread.set(m.id, thread.id);
      this.touch(thread.id);
      return { id: m.id, threadId: thread.id };
    });
  }

  saveDraft(message: OutgoingMessage): Promise<Draft> {
    return this.run(() => {
      const now = this.now();
      if (message.draftId) message = { ...message, draftId: this.draftKey(message.draftId) };
      if (message.draftId && this.drafts.has(message.draftId)) {
        const mid = this.drafts.get(message.draftId)!;
        const { thread, message: old } = this.findMessage(mid);
        this.builder.forget(mid);
        const updated = this.outgoingMessage(mid, thread.id, message, old.labelIds, now);
        updated.isDraft = true;
        updated.headers = { ...old.headers, messageId: old.headers.messageId };
        thread.messages = thread.messages.map((m) => (m.id === mid ? updated : m));
        this.touch(thread.id);
        return { id: message.draftId, message: updated };
      }
      if (message.draftId) throw new BackendError(`Draft ${message.draftId} not found`, 'not-found');
      let thread = message.threadId ? this.mustThread(message.threadId) : undefined;
      if (!thread) {
        thread = { id: this.id('t'), messages: [], muted: false };
        this.threads.set(thread.id, thread);
      }
      const prev = [...thread.messages].reverse().find((m) => !m.isDraft);
      const m = this.outgoingMessage(this.id('m'), thread.id, message, ['DRAFT'], now, prev);
      m.isDraft = true;
      thread.messages.push(m);
      this.messageThread.set(m.id, thread.id);
      const draftId = draftIdFor(m.id);
      this.drafts.set(draftId, m.id);
      this.touch(thread.id);
      return { id: draftId, message: m };
    });
  }

  deleteDraft(draftId: string): Promise<void> {
    return this.run(() => {
      const { thread } = this.takeDraft(draftId);
      if (thread.messages.length === 0) this.threads.delete(thread.id);
      this.touch(thread.id);
    });
  }

  /** Fixture drafts have no draft id yet. */
  private ensureDraftIds() {
    const registered = new Set(this.drafts.values());
    for (const t of this.threads.values()) {
      for (const m of t.messages) {
        if (m.isDraft && !registered.has(m.id)) this.drafts.set(draftIdFor(m.id), m.id);
      }
    }
  }

  cancelScheduled(threadId: string): Promise<void> {
    return this.run(() => {
      const t = this.mustThread(threadId);
      const pending = t.messages.filter((m) => m.labelIds.includes('SCHEDULED'));
      if (pending.length === 0) throw new BackendError('Nothing is scheduled in this thread', 'not-found');
      for (const m of pending) {
        m.labelIds = m.labelIds.filter((l) => l !== 'SCHEDULED');
        m.labelIds.push('DRAFT');
        m.isDraft = true;
        m.date = this.now();
        this.drafts.set(draftIdFor(m.id), m.id);
      }
      this.touch(t.id);
    });
  }

  /** A plausible RFC 822 source for a demo message. */
  getRawMessage(messageId: string): Promise<string> {
    return this.run(() => {
      const { message: m } = this.findMessage(messageId);
      const addr = (a: { name?: string; email: string }) => (a.name ? `"${a.name}" <${a.email}>` : a.email);
      const lines = [
        `Message-ID: ${m.headers.messageId ?? `<${m.id}@mail.example.com>`}`,
        `Date: ${new Date(m.date).toUTCString()}`,
        `From: ${addr(m.from)}`,
        `To: ${m.to.map(addr).join(', ')}`,
        ...(m.cc.length ? [`Cc: ${m.cc.map(addr).join(', ')}`] : []),
        `Subject: ${m.subject}`,
        ...(m.headers.inReplyTo ? [`In-Reply-To: ${m.headers.inReplyTo}`] : []),
        ...(m.headers.listUnsubscribe ? [`List-Unsubscribe: ${m.headers.listUnsubscribe}`] : []),
        'MIME-Version: 1.0',
        `Content-Type: ${m.bodyHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
        '',
        m.bodyHtml ?? m.bodyText ?? '',
      ];
      return lines.join('\r\n');
    });
  }

  getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; mimeType: string }> {
    return this.run(() => {
      const { message } = this.findMessage(messageId);
      const att = message.attachments.find((a) => a.id === attachmentId);
      const file = att ? this.builder.files.get(att.id) : undefined;
      if (!att || !file) throw new BackendError(`Attachment ${attachmentId} not found`, 'not-found');
      return { data: toBase64(file.make()), mimeType: file.mimeType };
    });
  }

  createLabel(label: Pick<Label, 'name' | 'color'>): Promise<Label> {
    return this.run(() => {
      const name = label.name.trim().replace(/\s*\/\s*/g, '/');
      if (!name) throw new BackendError('Label name is empty', 'unknown');
      this.assertNameFree(name);
      const id = `Label_${this.nextLabelNumber()}`;
      const created: Label = { id, name, type: 'user', ...(label.color ? { color: { ...label.color } } : {}) };
      this.labels.set(id, created);
      this.labelsChanged = true;
      return { ...created, totalCount: 0, unreadCount: 0 };
    });
  }

  private nextLabelNumber(): number {
    let n = 1;
    for (const id of this.labels.keys()) {
      const m = /^Label_(\d+)$/.exec(id);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    return n;
  }

  private assertNameFree(name: string, except?: string) {
    const norm = name.toLowerCase();
    const clash =
      SYSTEM_LABELS.some((l) => l.name.toLowerCase() === norm || l.id.toLowerCase() === norm) ||
      [...this.labels.values()].some((l) => l.id !== except && l.name.toLowerCase() === norm);
    if (clash) throw new BackendError(`A label named "${name}" already exists`, 'unknown');
  }

  updateLabel(id: string, patch: Partial<Pick<Label, 'name' | 'color' | 'hidden'>>): Promise<Label> {
    return this.run(() => {
      if (isSystemLabel(id)) throw new BackendError('System labels can’t be edited', 'unsupported');
      const l = this.labels.get(id);
      if (!l) throw new BackendError(`Label ${id} not found`, 'not-found');
      if (patch.name != null && patch.name.trim() !== l.name) {
        const name = patch.name.trim().replace(/\s*\/\s*/g, '/');
        if (!name) throw new BackendError('Label name is empty', 'unknown');
        this.assertNameFree(name, id);
        const oldPrefix = `${l.name}/`;
        for (const child of this.labels.values()) {
          if (child.name.startsWith(oldPrefix)) child.name = `${name}/${child.name.slice(oldPrefix.length)}`;
        }
        l.name = name;
      }
      if (patch.color !== undefined) {
        if (patch.color) l.color = { ...patch.color };
        else delete l.color;
      }
      if (patch.hidden !== undefined) l.hidden = patch.hidden;
      this.labelsChanged = true;
      return { ...l };
    });
  }

  deleteLabel(id: string): Promise<void> {
    return this.run(() => {
      if (isSystemLabel(id)) throw new BackendError('System labels can’t be deleted', 'unsupported');
      if (!this.labels.delete(id)) throw new BackendError(`Label ${id} not found`, 'not-found');
      for (const t of this.threads.values()) {
        let hit = false;
        for (const m of t.messages) {
          if (m.labelIds.includes(id)) {
            m.labelIds = m.labelIds.filter((l) => l !== id);
            hit = true;
          }
        }
        if (hit) this.touch(t.id);
      }
      for (const f of this.filters) {
        if (f.action.addLabelIds) f.action.addLabelIds = f.action.addLabelIds.filter((l) => l !== id);
        if (f.action.removeLabelIds) f.action.removeLabelIds = f.action.removeLabelIds.filter((l) => l !== id);
      }
      this.labelsChanged = true;
    });
  }

  listFilters(): Promise<Filter[]> {
    return this.run(() => this.filters);
  }

  createFilter(filter: Omit<Filter, 'id'>): Promise<Filter> {
    return this.run(() => {
      const c = filter.criteria;
      if (!c.from && !c.to && !c.subject && !c.query && !c.negatedQuery && !c.hasAttachment) {
        throw new BackendError('A filter needs at least one search criterion', 'unknown');
      }
      for (const l of [...(filter.action.addLabelIds ?? []), ...(filter.action.removeLabelIds ?? [])]) {
        if (!this.labelExists(l)) throw new BackendError(`Label ${l} not found`, 'not-found');
      }
      const created: Filter = { ...clone(filter), id: this.id('filter') };
      this.filters.push(created);
      return created;
    });
  }

  deleteFilter(id: string): Promise<void> {
    return this.run(() => {
      const before = this.filters.length;
      this.filters = this.filters.filter((f) => f.id !== id);
      if (this.filters.length === before) throw new BackendError(`Filter ${id} not found`, 'not-found');
    });
  }

  lookupPhotos(emails: string[]): Promise<Record<string, string>> {
    return this.run(() => {
      const out: Record<string, string> = {};
      for (const email of emails) {
        const person = this.people.get(email.trim().toLowerCase());
        if (person?.photo) out[email.trim().toLowerCase()] = avatarUrl(person.email);
      }
      return out;
    });
  }

  searchContacts(prefix: string): Promise<Contact[]> {
    if (this.contactsFail) return Promise.reject(new BackendError('Demo contact search is switched off (?contacts=fail).', 'unsupported'));
    return this.run(() => {
      const counts = new Map<string, { a: Address; n: number; last: number }>();
      for (const t of this.threads.values()) {
        for (const m of t.messages) {
          for (const a of [m.from, ...m.to, ...m.cc]) {
            const key = a.email.toLowerCase();
            if (key === this.self.email) continue;
            const cur = counts.get(key);
            if (cur) {
              cur.n++;
              cur.last = Math.max(cur.last, m.date);
              if (!cur.a.name && a.name) cur.a = { ...a };
            } else counts.set(key, { a: { ...a }, n: 1, last: m.date });
          }
        }
      }
      const p = fold(prefix.trim());
      const matches = [...counts.values()].filter(({ a }) => {
        if (!p) return true;
        const email = fold(a.email);
        if (email.startsWith(p)) return true;
        const name = fold(a.name ?? '');
        return name.startsWith(p) || name.split(/[\s.\-']+/).some((w) => w.startsWith(p));
      });
      matches.sort((x, y) => y.n - x.n || y.last - x.last || x.a.email.localeCompare(y.a.email));
      return matches.slice(0, 8).map(({ a }) => {
        const person = this.people.get(a.email.toLowerCase());
        return {
          ...(a.name ? { name: a.name } : {}),
          email: a.email,
          ...(person?.photo ? { photoUrl: avatarUrl(person.email) } : {}),
        };
      });
    });
  }

  pollChanges(): Promise<MailChange[]> {
    return this.run(() => {
      const out: MailChange[] = [];
      if (this.changedThreads.size) out.push({ type: 'threads', threadIds: [...this.changedThreads] });
      if (this.labelsChanged) out.push({ type: 'labels' });
      this.changedThreads.clear();
      this.labelsChanged = false;
      return out;
    });
  }

  subscribe(listener: (event: BackendEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async geminiStatus(): Promise<GeminiStatus> {
    if (this.geminiMode === 'plan') return { ready: false, block: 'plan' };
    if (this.geminiMode === 'smart-features') return { ready: false, block: 'smart-features' };
    return { ready: true, features: [...ALL_GEMINI_FEATURES] };
  }

  /** A pause while it thinks, then the text a few words at a time. */
  async gemini(request: GeminiRequest, requestId: string): Promise<GeminiResult> {
    // Registered before anything waits, so Stop pressed at once still lands.
    let stopped = false;
    let wake = () => undefined as void;
    this.geminiRuns.set(requestId, () => {
      stopped = true;
      wake();
    });
    const status = await this.geminiStatus();
    if (!status.ready) {
      this.geminiRuns.delete(requestId);
      throw new BackendError('Gemini isn’t available for this account.', 'unsupported');
    }
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
    try {
      await pause(this.geminiDelayMs);
      if (stopped) throw new BackendError('Stopped', 'unknown');
      if (this.geminiMode === 'fail') throw new BackendError('Gemini couldn’t answer right now. Try again in a moment.', 'network', true);
      this.tick();
      const result = demoGemini(request, {
        thread: (id) => {
          const t = this.mustThread(id);
          return { ...this.summary(t), messages: t.messages };
        },
        search: (q) =>
          [...this.threads.values()]
            .filter((t) => compileQuery(q, this.searchEnv())(this.indexed(t)))
            .sort((a, b) => this.sortDate(b) - this.sortDate(a))
            .map((t) => this.summary(t)),
        me: { name: this.self.name, email: this.self.email },
        now: () => this.now(),
        labelName: (id) => this.labels.get(id)?.name,
      });
      const text = streamedText(result);
      if (text && this.geminiDelayMs > 0) {
        const words = text.split(/(?<=\s)/);
        const step = Math.max(2, Math.ceil(words.length / 24));
        for (let i = step; i < words.length; i += step) {
          for (const l of [...this.listeners]) l({ type: 'gemini', requestId, text: words.slice(0, i).join('') });
          await pause(45);
          if (stopped) throw new BackendError('Stopped', 'unknown');
        }
      }
      return clone(result);
    } finally {
      this.geminiRuns.delete(requestId);
    }
  }

  async cancelGemini(requestId: string): Promise<void> {
    this.geminiRuns.get(requestId)?.();
  }

  unsubscribe(messageId: string): Promise<'one-click' | 'mailto' | 'link'> {
    return this.run(() => {
      const { message } = this.findMessage(messageId);
      const lu = message.headers.listUnsubscribe ?? '';
      const https = /<(https?:[^>]+)>/i.exec(lu);
      if (https && /one-click/i.test(message.headers.listUnsubscribePost ?? '')) return 'one-click' as const;
      if (/<mailto:[^>]+>/i.test(lu)) return 'mailto' as const;
      if (https) return 'link' as const;
      throw new BackendError('This sender doesn’t offer an unsubscribe link', 'unsupported');
    });
  }
}

export function createDemoBackend(options: DemoBackendOptions = {}): MailBackend {
  return new DemoBackend(options);
}
