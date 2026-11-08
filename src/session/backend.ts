import { BackendError, type BackendEvent, type MailBackend } from '../app/data/backend';
import type {
  Account,
  Address,
  BackendCapabilities,
  Contact,
  Draft,
  Label,
  LabelChange,
  LabelId,
  MailChange,
  Message,
  OutgoingAttachment,
  OutgoingMessage,
  Thread,
  ThreadPage,
  ThreadQuery,
} from '../app/data/types';
import { accountIndexFromPath, isImage, photoData, publicPhoto, readAccountFromDocument, readGlobalsFromDocument } from './account';
import { REQUEST_TIMEOUT_MS, SyncClient, assertOk, fetchWithin } from './client';
import { PeopleStack } from './contacts';
import { defaultRandom, isThreadId, newDraftIds, normalizeThreadId, type RandomBytes } from './ids';
import { headSource, listHeadersFrom, originalSourceUrl } from './headers';
import { toInternalChange, type InternalLabelChange } from './labels';
import { parseThreadList } from './parse-list';
import { attachmentKey, parseThreadResponse } from './parse-thread';
import { parseAcks, parsePoll, parseUpdatedThreads } from './parse-sync';
import { fromDataUrl, thumbnailUrls } from './thumbnails';
import {
  DRAFT_LABELS,
  SEND_LABELS,
  appendOp,
  composeBody,
  composeMessage,
  fetchThreadsBody,
  labelChangeBody,
  labelListBody,
  newThreadOp,
  pollBody,
  threadListBody,
  updateOp,
  uploadedAttachment,
  type LabelOp,
} from './requests';
import { getDefaultStore, type TokenSource } from './session';
import { cap } from '../shared/bounded';
import { GmailPage, GmailPageError, type FolderView } from './gmail-page';
import type { GmailGemini } from './gemini-page';
import type { GeminiRequest, GeminiResult, GeminiSource, GeminiStatus } from '../app/data/gemini';

/** Per thread, message or attachment, while the tab stays open. */
const MEMO_LIMIT = 5000;

const SESSION_CAPABILITIES: BackendCapabilities = {
  send: true,
  drafts: true,
  snooze: false,
  scheduleSend: false,
  mute: true,
  labelsEdit: false,
  filters: false,
  contacts: true,
  attachments: true,
  deleteForever: false,
  changes: true,
  listHeadersOnDemand: true,
};

export interface SessionBackendOptions {
  tokens?: TokenSource;
  fetch?: typeof fetch;
  document?: Document;
  now?: () => number;
  random?: RandomBytes;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Re-read threads after a label change to confirm Gmail applied it. */
  verifyWrites?: boolean;
  sessionTimeoutMs?: number;
  /** How long one request to Gmail may take before it counts as lost. */
  requestTimeoutMs?: number;
  /** Breadcrumbs for the connection error screen. */
  diagnostic?: (line: string) => void;
  /** Another account read from this page with its saved session: the page's own header describes a different account. */
  elsewhere?: { name?: string; photoUrl?: string };
  /** Reads a signed-in-only image where the sign-in is (the extension background), as a data URL. */
  fetchPhoto?: (url: string) => Promise<string | undefined>;
  /** Gmail's own page in this tab, for delete forever, emptying folders and schedule send. Only for that page's account. */
  page?: GmailPage;
  /** Gemini on that same page (src/session/gemini-page.ts). Ignored without `page`. */
  gemini?: GmailGemini;
}

const MAX_PAGE = 100;
const SEARCH_COUNT_CAP = 200;
/** A hidden account frame can be slow to draw its header. */
const ACCOUNT_PHOTO_WATCH_MS = 120_000;
/** At most this often while Gmail is busy changing its page. */
const ACCOUNT_PHOTO_LOOK_MS = 250;
const VERIFY_BATCH = 20;
/** Gmail's re-read can echo the old labels for a moment after a write it did apply. */
const VERIFY_TRIES = 3;
const VERIFY_RETRY_MS = 1_000;
/** Re-reads after a permanent delete: Gmail can list a big folder for a while after emptying it. */
const SETTLE_TRIES = 15;
const SETTLE_POLL_MS = 2_000;
/** Presses of Empty Trash now before giving up, in case Gmail empties a huge folder in parts. */
const EMPTY_ROUNDS = 3;
/** Gmail schedules to the minute; anything further off is a time the user didn't pick. */
const SCHEDULE_SLACK_MS = 60_000;
const SCHEDULE_FAILED = "Couldn't schedule in Gmail. Your message is saved in Drafts.";
/** How long Gmail gets to list a message it just scheduled, however slow each re-read is. */
const SCHEDULE_CONFIRM_MS = 30_000;

/** Names the step, so the next try (or a report) can be specific. */
function scheduleFailed(failure: unknown): string {
  const said = failure instanceof GmailPageError ? failure.said : undefined;
  if (said) return `Gmail didn't schedule it: ${/[.!?]$/.test(said) ? said : `${said}.`} Your message is saved in Drafts.`;
  const step = failure instanceof GmailPageError ? failure.step : undefined;
  return step ? `Gmail stopped responding before it could ${step}, so nothing was sent. Your message is saved in Drafts.` : SCHEDULE_FAILED;
}

/** Sources whose subject Gmail's answer didn't give are looked up, at most this many. */
const GEMINI_SOURCE_LOOKUPS = 8;

function geminiFailure(err: unknown): never {
  if (err instanceof BackendError) throw err;
  if (err instanceof GmailPageError) {
    const said = err.step ? `Gmail stopped responding before it could ${err.step}.` : err.message;
    throw new BackendError(`${said} Try again in a moment, or use Gemini in classic Gmail.`, 'unknown', true);
  }
  throw err;
}

function pageFailure(err: unknown): never {
  if (err instanceof GmailPageError) throw new BackendError(`${err.message} Open classic Gmail to finish there.`, 'unknown');
  throw err;
}

interface DraftTarget {
  /** Sync id of the message being answered, for Gmail's threading. */
  replyToId: string | null;
  /** Sent as In-Reply-To. */
  inReplyTo?: string;
}

interface DraftContext extends DraftTarget {
  threadId: string;
}

/** MailBackend over Gmail's internal sync API, with the session of the page this content script runs in. */
export class SessionBackend implements MailBackend {
  readonly kind = 'session' as const;
  readonly capabilities: BackendCapabilities;
  private readonly page?: GmailPage;
  readonly geminiStatus?: () => Promise<GeminiStatus>;
  readonly gemini?: (request: GeminiRequest, requestId: string) => Promise<GeminiResult>;
  readonly cancelGemini?: (requestId: string) => Promise<void>;

  private readonly client: SyncClient;
  private readonly tokens: TokenSource;
  private readonly fetchImpl: typeof fetch;
  private readonly doc: Document;
  private readonly now: () => number;
  private readonly random: RandomBytes;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly verifyWrites: boolean;
  private readonly requestTimeoutMs: number;
  private readonly syncRef: string;

  private readonly messageIds = new Map<string, string[]>();
  private readonly attachmentUrls = new Map<string, string>();
  private readonly attachmentTypes = new Map<string, string>();
  private readonly drafts = new Map<string, DraftContext>();
  private labelCounts: string | undefined;
  private lastPoll = 0;
  private pollFallback = false;
  /** Threads this tab changed: the write's own history id hides them from the next poll. */
  private readonly written = new Set<string>();
  /** Schedule sends in flight, by draft and time. */
  private readonly scheduling = new Map<string, Promise<{ id: string; threadId: string }>>();
  private readonly diagnostic: (line: string) => void;
  private readonly reported = new Set<string>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private stopPhotoWatch: (() => void) | undefined;
  private readonly elsewhere: { name?: string; photoUrl?: string } | undefined;
  /** Signed-in-only photo URLs, read once and kept as data URLs. */
  private readonly photoData = new Map<string, string>();
  private readonly fetchPhoto: ((url: string) => Promise<string | undefined>) | undefined;
  private readonly people: PeopleStack;

  constructor(options: SessionBackendOptions = {}) {
    this.tokens = options.tokens ?? getDefaultStore();
    this.page = options.page;
    this.capabilities = { ...SESSION_CAPABILITIES, deleteForever: !!options.page, scheduleSend: !!options.page };
    this.fetchImpl = options.fetch ?? pageFetch();
    this.doc = options.document ?? document;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? defaultRandom;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000;
    this.verifyWrites = options.verifyWrites ?? true;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.diagnostic = options.diagnostic ?? (() => undefined);
    this.elsewhere = options.elsewhere;
    this.fetchPhoto = options.fetchPhoto;
    this.client = new SyncClient({
      tokens: this.tokens,
      fetch: this.fetchImpl,
      now: this.now,
      sessionTimeoutMs: options.sessionTimeoutMs,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.people = new PeopleStack({
      fetch: this.fetchImpl,
      tokens: this.tokens,
      document: this.doc,
      origin: this.client.origin,
      now: this.now,
      report: (line) => this.report(line),
    });
    const gemini = options.page ? options.gemini : undefined;
    if (gemini) {
      this.geminiStatus = () => gemini.status();
      this.gemini = (request, requestId) => this.askGemini(gemini, request, requestId);
      this.cancelGemini = (requestId) => gemini.cancel(requestId);
    }
    const bytes = this.random(new Uint8Array(8));
    this.syncRef = `s:${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  subscribe(listener: (event: BackendEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BackendEvent) {
    for (const listener of [...this.listeners]) listener(event);
  }

  /** One breadcrumb per distinct problem, so a failing endpoint can't flood the log. */
  private report(line: string) {
    if (this.reported.has(line)) return;
    this.reported.add(line);
    this.diagnostic(line);
  }

  /** Streams the answer as `gemini` events. A chat about one conversation is grounded by its subject; sources Gmail named only by conversation get subject, sender and date from the sync API. */
  private async askGemini(gemini: GmailGemini, request: GeminiRequest, requestId: string): Promise<GeminiResult> {
    // Gemini works in the conversation on Gmail's page, where the user's own draft reply may sit; it's told which those are.
    const threadId = 'threadId' in request ? request.threadId : undefined;
    const thread = threadId ? await this.getThread(threadId).catch(() => undefined) : undefined;
    const subject = request.kind === 'chat' ? thread?.subject : undefined;
    const drafts = thread?.messages.filter((m) => m.isDraft).map((m) => m.id) ?? [];
    const result = await gemini
      .run(request, requestId, { subject, drafts, onText: (text) => this.emit({ type: 'gemini', requestId, text }) })
      .catch(geminiFailure);
    if (result.kind !== 'answer' || !result.sources.length) return result;
    return { ...result, sources: await this.completeSources(result.sources) };
  }

  private async completeSources(sources: GeminiSource[]): Promise<GeminiSource[]> {
    const lookup = sources.filter((s) => !s.subject || !s.from).slice(0, GEMINI_SOURCE_LOOKUPS);
    if (!lookup.length) return sources;
    const threads = await this.fetchThreads(lookup.map((s) => s.threadId)).catch(() => [] as Thread[]);
    const byId = new Map(threads.map((t) => [t.id, t]));
    return sources.map((s) => {
      const t = byId.get(s.threadId);
      if (!t) return s;
      const sender = t.participants.at(-1);
      const from = s.from ?? (sender ? sender.name || sender.email : undefined);
      return { ...s, subject: s.subject || t.subject, ...(from ? { from } : {}), date: s.date ?? t.lastDate };
    });
  }

  /** GLOBALS, which Gmail's HTML defines long before its first sync call, names the account; the UI picks its cached inbox from it. */
  async accountHint(timeoutMs = 2_000): Promise<string | undefined> {
    const read = () => this.tokens.current()?.email ?? (this.elsewhere ? undefined : readGlobalsFromDocument(this.doc).email);
    const step = 50;
    for (let waited = 0; ; waited += step) {
      const email = read();
      if (email || waited >= timeoutMs) return email || undefined;
      await new Promise((resolve) => setTimeout(resolve, step));
    }
  }

  async getAccount(): Promise<Account> {
    const session = await this.client.session();
    const email = session.email ?? this.tokens.current()?.email;
    if (!email) throw new BackendError("Gmail hasn't said which account is signed in yet.", 'session-unavailable', true);
    const index = accountIndexFromPath(session.syncPath);
    if (this.elsewhere) {
      const { name, photoUrl } = this.elsewhere;
      return { email, name: name || email.split('@')[0] || email, index, ...(photoUrl ? { photoUrl } : {}) };
    }
    const account = readAccountFromDocument(this.doc, email, index);
    if (account.photoUrl) {
      this.report(`account photo found in Gmail's header (${new URL(account.photoUrl).hostname})`);
      account.photoUrl = await this.portablePhoto(account.photoUrl);
    }
    else {
      const button = this.doc.querySelector('a[href^="https://accounts.google.com/SignOutOptions"]');
      this.report(`no account photo in Gmail's header yet (account button ${button ? `found, ${button.querySelectorAll('img').length} img` : 'missing'}); watching`);
      this.watchAccountPhoto(email, index);
    }
    return account;
  }

  /** Some account photos (lh3.google.com/u/N/...) only load with Google's sign-in cookies, which this page has and the app frame doesn't. */
  private async portablePhoto(url: string): Promise<string> {
    if (!/^https:\/\/lh\d\.google\.com\//.test(url)) return url;
    const cached = this.photoData.get(url);
    if (cached) return cached;
    const keep = (value: string, how: string) => {
      this.photoData.set(url, value);
      this.report(`account photo needs Google sign-in; ${how}`);
      return value;
    };
    const here = await photoData(url, 'include').catch(() => undefined);
    if (here) return keep(here, 'read from this page');
    // The background may carry the sign-in where this page can't (CORS).
    const there = await this.fetchPhoto?.(url).catch(() => undefined);
    if (there) return keep(there, 'read by the extension');
    // Last: the public copy. For work and school accounts whose photo is private to the organization, that's a generic silhouette.
    const open = publicPhoto(url);
    if (open && (await isImage(open, 'omit'))) return keep(open, "using its public address (couldn't read the signed-in one)");
    this.report("account photo couldn't be read here or by the extension");
    return url;
  }

  /** Gmail renders its header (where the photo is read) around its first sync call, sometimes after; watch, then have the UI read the account again. */
  private watchAccountPhoto(email: string, index: number) {
    if (this.stopPhotoWatch) return;
    const Observer = this.doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    const root = this.doc.documentElement;
    if (!Observer || !root) return;
    // Gmail mutates its page constantly while it starts, and in Safari every look runs on the app's thread too.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      pending = undefined;
      if (!readAccountFromDocument(this.doc, email, index).photoUrl) return;
      stop();
      this.report('account photo appeared in Gmail\'s header');
      this.emit({ type: 'account' });
    };
    const observer = new Observer(() => {
      pending ??= setTimeout(look, ACCOUNT_PHOTO_LOOK_MS);
    });
    const timer = setTimeout(() => {
      stop();
      this.report('gave up waiting for the account photo in Gmail\'s header');
    }, ACCOUNT_PHOTO_WATCH_MS);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(pending);
      this.stopPhotoWatch = undefined;
    };
    this.stopPhotoWatch = stop;
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'aria-label', 'href'] });
  }

  async listLabels(): Promise<Label[]> {
    const index = await this.accountIndex();
    const parsed = parseThreadList(await this.client.call('bv', labelListBody(index, this.now())));
    if (!parsed.labels) throw new BackendError('Gmail did not include the label list.', 'unknown');
    return parsed.labels;
  }

  async listThreads(query: ThreadQuery): Promise<ThreadPage> {
    const pageSize = Math.min(Math.max(Math.round(query.pageSize ?? 50), 1), MAX_PAGE);
    const { start, previousFirst } = decodePageToken(query.pageToken);
    const parsed = parseThreadList(this.people.learn(await this.client.call('bv', threadListBody(query.q, start, pageSize))));
    for (const [id, ids] of parsed.messageIds) this.messageIds.set(id, ids);
    cap(this.messageIds, MEMO_LIMIT);

    const { threads } = parsed;
    if (previousFirst && threads[0]?.id === previousFirst) {
      // Gmail ignored the offset and sent page one again; stop rather than loop forever.
      throw new BackendError("Gmail didn't return the next page of results.", 'unsupported');
    }
    const more = parsed.hasMore ?? threads.length >= pageSize;
    const page: ThreadPage = { threads };
    if (more && threads[0]) page.nextPageToken = encodePageToken(start + threads.length, threads[0].id);
    if (parsed.total !== undefined) {
      // Past 200 a search stops counting and answers 201 ("1-50 of many").
      const capped = more && parsed.total === SEARCH_COUNT_CAP + 1;
      page.resultSizeEstimate = capped ? SEARCH_COUNT_CAP : parsed.total;
      if (capped) page.resultSizeAtLeast = true;
    }
    return page;
  }

  async getThread(threadId: string): Promise<Thread> {
    const id = normalizeThreadId(threadId);
    if (!id) throw new BackendError(`"${threadId}" is not a Gmail conversation id.`, 'not-found');
    const [thread] = await this.fetchThreads([id]);
    if (!thread) throw new BackendError('This conversation no longer exists.', 'not-found');
    return thread;
  }

  private async fetchThreads(ids: string[]): Promise<Thread[]> {
    const parsed = parseThreadResponse(this.people.learn(await this.client.call('fd', fetchThreadsBody(ids))));
    for (const [key, url] of parsed.attachmentUrls) this.attachmentUrls.set(key, url);
    cap(this.attachmentUrls, MEMO_LIMIT);
    for (const thread of parsed.threads) {
      this.messageIds.set(thread.id, thread.messages.map((m) => m.id));
      for (const m of thread.messages) {
        for (const a of m.attachments) this.attachmentTypes.set(attachmentKey(m.id, a.id), a.mimeType);
      }
    }
    cap(this.attachmentTypes, MEMO_LIMIT);
    return parsed.threads.filter((t) => ids.includes(t.id));
  }

  async modifyThreads(threadIds: string[], change: LabelChange): Promise<void> {
    const internal = toInternalChange(change);
    await this.applyLabels(threadIds, internal, { present: change.add ?? [], absent: change.remove ?? [] });
  }

  trashThreads(threadIds: string[]): Promise<void> {
    return this.modifyThreads(threadIds, { add: ['TRASH'] });
  }

  /** Gmail's "Move to Inbox" from Trash: back to the inbox, not to the exact previous labels. */
  untrashThreads(threadIds: string[]): Promise<void> {
    return this.modifyThreads(threadIds, { remove: ['TRASH'] });
  }

  /** No known sync request deletes forever, so this presses Delete forever on Gmail's page and re-reads to make sure. */
  async deleteThreadsForever(threadIds: string[]): Promise<void> {
    const page = this.requirePage();
    const ids = unique(threadIds.map((t) => normalizeThreadId(t) ?? t));
    const found = await this.fetchThreads(ids);
    const inSpam = new Set(found.filter((t) => t.labelIds.includes('SPAM')).map((t) => t.id));
    const inTrash = ids.filter((id) => !inSpam.has(id));
    if (inTrash.length) await page.deleteForever(inTrash, 'trash', await this.folderView('trash')).catch(pageFailure);
    if (inSpam.size) await page.deleteForever([...inSpam], 'spam', await this.folderView('spam')).catch(pageFailure);
    ids.forEach((id) => {
      this.messageIds.delete(id);
      this.written.add(id);
    });
    // The sync API is the judge, not the page: Gmail can take a moment to forget a thread.
    let left: Thread[] = [];
    for (let tries = 0; tries < SETTLE_TRIES; tries++) {
      if (tries) await this.sleep(SETTLE_POLL_MS);
      left = (await this.fetchThreads(ids)).filter((t) => t.labelIds.includes('TRASH') || t.labelIds.includes('SPAM'));
      if (!left.length) return;
    }
    const n = left.length;
    throw new BackendError(`Gmail didn't delete ${n === 1 ? 'one conversation' : `${n} conversations`}. Open classic Gmail to delete ${n === 1 ? 'it' : 'them'}.`, 'unknown');
  }

  /** Pressed on Gmail's page (which empties every page of the folder server side), then re-read until the folder lists nothing. Resolves with the count. */
  async emptyFolder(folder: 'trash' | 'spam'): Promise<number> {
    const page = this.requirePage();
    let view = await this.folderView(folder);
    const count = view.total ?? view.landmarks.length;
    for (let round = 0; view.landmarks.length && round < EMPTY_ROUNDS; round++) {
      await page.emptyFolder(folder, view).catch(pageFailure);
      for (let tries = 0; tries < SETTLE_TRIES; tries++) {
        await this.sleep(SETTLE_POLL_MS);
        view = await this.folderView(folder);
        if (!view.landmarks.length) break;
      }
    }
    this.messageIds.clear();
    if (view.landmarks.length) {
      const n = view.total ?? view.landmarks.length;
      throw new BackendError(
        `Couldn't empty ${folder === 'trash' ? 'Trash' : 'Spam'}: Gmail still lists ${n === 1 ? 'one conversation' : `${n} conversations`} there. Open classic Gmail to finish.`,
        'unknown',
      );
    }
    return count;
  }

  private async folderView(folder: 'trash' | 'spam' | 'scheduled'): Promise<FolderView> {
    const list = await this.listThreads({ q: `in:${folder}`, pageSize: MAX_PAGE });
    const total = list.resultSizeEstimate ?? (list.nextPageToken ? undefined : list.threads.length);
    return { landmarks: list.threads.map((t) => t.id), ...(total === undefined ? {} : { total }) };
  }

  private requirePage(): GmailPage {
    if (!this.page) {
      throw new BackendError("Only this tab's own account can delete forever. Switch to it, or move the conversation to Trash; Gmail empties it after 30 days.", 'unsupported');
    }
    return this.page;
  }

  async snoozeThreads(): Promise<void> {
    throw new BackendError("Snooze isn't available with the session backend yet.", 'unsupported');
  }

  /** Unverified against live Gmail: snoozed threads carry "^t_z" (from Gmail's sidebar label list). */
  unsnoozeThreads(threadIds: string[]): Promise<void> {
    return this.applyLabels(threadIds, { add: ['^i'], remove: ['^t_z'] }, { present: [], absent: ['SNOOZED'] });
  }

  /** Unverified against live Gmail: "^g" is classic Gmail's muted label. */
  muteThreads(threadIds: string[], muted: boolean): Promise<void> {
    return muted
      ? this.applyLabels(threadIds, { add: ['^g'], remove: ['^i'] }, { present: [], absent: ['INBOX'] })
      : this.applyLabels(threadIds, { add: [], remove: ['^g'] }, { present: [], absent: [] });
  }

  private async applyLabels(
    threadIds: string[],
    change: InternalLabelChange,
    expected: { present: LabelId[]; absent: LabelId[] },
  ): Promise<void> {
    const ids = unique(threadIds.map((t) => normalizeThreadId(t) ?? t));
    if (!ids.length || (!change.add.length && !change.remove.length)) return;
    const bad = ids.find((id) => !isThreadId(id));
    if (bad) throw new BackendError(`"${bad}" is not a Gmail conversation id.`, 'not-found');

    let refused = await this.writeLabels(ids, change);
    if (refused.length) {
      // Gmail turns away a change built on an old read (the thread moved on elsewhere). Read again, which also refreshes the history id, and retry once.
      this.report(`label change refused (status ${refused.join(', ')}); retrying with fresh threads`);
      ids.forEach((id) => this.messageIds.delete(id));
      refused = await this.writeLabels(ids, change);
    }
    if (refused.length) throw refusedError(refused);
    ids.forEach((id) => this.written.add(id));
    if (!this.verifyWrites) return;
    let stale = await this.verify(ids, expected);
    if (stale.length) {
      // A message that arrived after the last read wasn't in the change.
      refused = await this.writeLabels(stale, change);
      if (refused.length) throw refusedError(refused);
      stale = await this.verify(stale, expected);
    }
    if (stale.length) throw new BackendError("Gmail accepted the request but didn't apply it. Try again from classic Gmail.", 'unsupported');
  }

  /** Resolves with the statuses of any ops Gmail refused. */
  private async writeLabels(ids: string[], change: InternalLabelChange): Promise<number[]> {
    const messageIds = await this.messageIdsFor(ids);
    const ops: LabelOp[] = ids.map((threadId) => ({
      threadId,
      messageIds: messageIds.get(threadId) ?? [],
      add: change.add,
      remove: change.remove,
    }));
    const firstOp = this.client.nextOpIds(ops.length);
    return refusedStatuses(await this.client.call('s', labelChangeBody(ops, firstOp, this.client.historyId, this.client.clock())));
  }

  private async messageIdsFor(threadIds: string[]): Promise<Map<string, string[]>> {
    const missing = threadIds.filter((id) => !this.messageIds.get(id)?.length);
    for (let i = 0; i < missing.length; i += VERIFY_BATCH) {
      await this.fetchThreads(missing.slice(i, i + VERIFY_BATCH));
    }
    const out = new Map<string, string[]>();
    for (const id of threadIds) {
      const ids = this.messageIds.get(id);
      if (!ids?.length) throw new BackendError('One of these conversations no longer exists.', 'not-found');
      out.set(id, ids);
    }
    return out;
  }

  /**
   * Gmail acks forged /i/s writes even when it ignores them (reported by
   * mikeg0/gmail-extension), so re-read the threads and check.
   */
  private async verify(threadIds: string[], expected: { present: LabelId[]; absent: LabelId[] }): Promise<string[]> {
    if (!expected.present.length && !expected.absent.length) return [];
    let pending = threadIds;
    for (let tries = 0; pending.length; tries++) {
      if (tries === VERIFY_TRIES) return pending;
      if (tries) await this.sleep(VERIFY_RETRY_MS);
      const stale: string[] = [];
      for (let i = 0; i < pending.length; i += VERIFY_BATCH) {
        for (const thread of await this.fetchThreads(pending.slice(i, i + VERIFY_BATCH))) {
          const has = new Set(thread.labelIds);
          const ok = expected.present.every((l) => has.has(l)) && expected.absent.every((l) => !has.has(l));
          if (!ok) stale.push(thread.id);
        }
      }
      pending = stale;
    }
    return [];
  }

  async send(message: OutgoingMessage): Promise<{ id: string; threadId: string }> {
    if (message.sendAt !== undefined) return this.schedule(message, message.sendAt);
    const ctx = await this.composeContext(message);

    if (ctx.isNewThread) {
      // Gmail's client saves a new thread as a draft before sending it; crouton-labs/capture does the same.
      const draft = this.buildMessage(message, ctx, DRAFT_LABELS);
      const op = newThreadOp(this.client.nextOpIds(1), ctx.threadId, message.subject, draft, this.now());
      const historyId = await this.historyId();
      assertAccepted(await this.client.call('s', composeBody('save', [op], historyId, this.client.clock())));
    }

    const outgoing = this.buildMessage(message, ctx, SEND_LABELS);
    const opId = this.client.nextOpIds(1);
    const op = ctx.isNewMessage && !ctx.isNewThread
      ? appendOp(opId, ctx.threadId, outgoing, ctx.replyToId, this.now())
      : updateOp(opId, ctx.threadId, outgoing, ctx.replyToId, this.now());
    const root = await this.client.call('s', composeBody('send', [op], undefined, this.client.clock()));
    assertAccepted(root);

    const echoed = findMessage(parseUpdatedThreads(root), ctx.messageId);
    if (!echoed || !echoed.message.labelIds.includes('SENT')) {
      throw new BackendError(
        "Gmail accepted the message but didn't confirm it was sent. Check Sent before trying again.",
        'unknown',
      );
    }
    this.drafts.delete(ctx.messageId);
    this.messageIds.delete(echoed.threadId);
    return { id: echoed.message.id, threadId: echoed.threadId };
  }

  async saveDraft(message: OutgoingMessage): Promise<Draft> {
    const ctx = await this.composeContext(message);
    const body = this.buildMessage(message, ctx, DRAFT_LABELS);
    const opId = this.client.nextOpIds(1);
    const now = this.now();
    const op = ctx.isNewThread
      ? newThreadOp(opId, ctx.threadId, message.subject, body, now)
      : ctx.isNewMessage
        ? appendOp(opId, ctx.threadId, body, ctx.replyToId, now)
        : updateOp(opId, ctx.threadId, body, ctx.replyToId, now);
    const root = await this.client.call('s', composeBody('save', [op], await this.historyId(), this.client.clock()));
    assertAccepted(root);

    this.drafts.set(ctx.messageId, { threadId: ctx.threadId, replyToId: ctx.replyToId, ...(ctx.inReplyTo ? { inReplyTo: ctx.inReplyTo } : {}) });
    cap(this.drafts, 500);
    this.messageIds.delete(ctx.threadId);
    const echoed = findMessage(parseUpdatedThreads(root), ctx.messageId);
    return { id: ctx.messageId, message: echoed?.message ?? localDraft(message, ctx, now) };
  }

  /** Gmail's own scheduled send, so Google's servers send it with the browser closed. No known sync request schedules, so the draft is saved through the sync API, Gmail's page schedules it with its own buttons, and a sync re-read is the judge. Never falls back to sending now. */
  private schedule(message: OutgoingMessage, sendAt: number): Promise<{ id: string; threadId: string }> {
    // A retry while the first try still runs is one schedule, never two.
    const key = message.draftId ? `${message.draftId}@${sendAt}` : undefined;
    const running = key ? this.scheduling.get(key) : undefined;
    if (running) return running;
    const run = this.scheduleOnce(message, sendAt).finally(() => key && this.scheduling.delete(key));
    if (key) this.scheduling.set(key, run);
    return run;
  }

  private async scheduleOnce(message: OutgoingMessage, sendAt: number): Promise<{ id: string; threadId: string }> {
    const page = this.page;
    if (!page) throw new BackendError('To schedule from this account, switch to it first.', 'unsupported');
    if (sendAt <= this.now()) throw new BackendError('Pick a time in the future.', 'unsupported');
    const { sendAt: _, ...rest } = message;
    void _;
    // Gmail schedules the draft it has: the last edits (often the recipients) may not have reached an autosave, and Gmail refuses a draft with nobody to send to.
    const draft = await this.saveDraft(rest);
    const threadId = draft.message.threadId;
    const messageId = draft.id;
    const target = { threadId, messageId };
    let failure: unknown;
    const recipients = [...rest.to, ...rest.cc, ...rest.bcc].map((a) => a.email);
    await page.scheduleDraft({ ...target, sendAt, recipients }).catch((err: unknown) => (failure = err));
    if (failure) this.diagnostic(`schedule send: ${failure instanceof Error ? failure.message : String(failure)}`);
    // Even when the page stalled Gmail may have taken it, so read before saying no; past the last press, give it the full wait.
    const pressed = !failure || (failure instanceof GmailPageError && failure.step === 'schedule the message');
    const scheduled = await this.scheduledMessage(target, pressed ? SETTLE_TRIES : 1);
    if (!scheduled) throw new BackendError(scheduleFailed(failure), 'unknown');
    this.drafts.delete(messageId);
    this.messageIds.delete(threadId);
    // A date in the past is the sync API's write time, not a send time; only a future one can be checked.
    if (scheduled.date > this.now() && Math.abs(scheduled.date - sendAt) > SCHEDULE_SLACK_MS) {
      const when = new Date(scheduled.date).toLocaleString();
      const undone = await this.cancelScheduled(threadId).then(
        () => true,
        () => false,
      );
      throw new BackendError(
        undone
          ? `Gmail scheduled it for ${when} instead, so it was cancelled. Your message is saved in Drafts.`
          : `Gmail scheduled it for ${when} instead. Cancel it in classic Gmail's Scheduled folder.`,
        'unknown',
      );
    }
    return { id: scheduled.id, threadId };
  }

  private async scheduledMessage(target: { threadId: string; messageId: string }, tries: number): Promise<Message | undefined> {
    const until = this.now() + SCHEDULE_CONFIRM_MS;
    for (let i = 0; i < tries; i++) {
      if (i && this.now() >= until) break;
      if (i) await this.sleep(SETTLE_POLL_MS);
      const [thread] = await this.fetchThreads([target.threadId]).catch((): Thread[] => []);
      const messages = thread?.messages ?? [];
      const stillDraft = messages.some((m) => m.id === target.messageId && m.isDraft);
      const found = messages.find((m) => m.labelIds.includes('SCHEDULED') && !m.isDraft && (m.id === target.messageId || !stillDraft));
      if (found) return found;
    }
    return undefined;
  }

  /** Pressed on Gmail's page; done once the sync API no longer lists the thread as scheduled. */
  async cancelScheduled(threadId: string): Promise<void> {
    const page = this.page;
    if (!page) throw new BackendError("To cancel this send, switch to its account first, or use classic Gmail's Scheduled folder.", 'unsupported');
    const id = normalizeThreadId(threadId);
    if (!id) throw new BackendError(`"${threadId}" is not a Gmail conversation id.`, 'not-found');
    const pending = (thread: Thread | undefined) => thread?.messages.some((m) => m.labelIds.includes('SCHEDULED')) ?? false;
    if (!pending((await this.fetchThreads([id]))[0])) throw new BackendError('Nothing in this conversation is scheduled anymore.', 'not-found');
    let failure: unknown;
    await page.cancelSend(id, await this.folderView('scheduled')).catch((err: unknown) => (failure = err));
    this.messageIds.delete(id);
    for (let i = 0; i < (failure ? 1 : SETTLE_TRIES); i++) {
      if (i) await this.sleep(SETTLE_POLL_MS);
      if (!pending((await this.fetchThreads([id]).catch((): Thread[] => []))[0])) return;
    }
    const reason = failure instanceof GmailPageError ? `${failure.message} ` : '';
    throw new BackendError(`${reason}Gmail didn't cancel the send. Open classic Gmail to cancel it there.`, 'unknown');
  }

  /** Pressed on Gmail's page; then the conversation is read again to be sure it went. */
  async deleteDraft(draftId: string, threadId?: string): Promise<void> {
    const page = this.page;
    if (!page) throw new BackendError('To discard a draft from this account, switch to it first.', 'unsupported');
    const id = normalizeThreadId(threadId) ?? this.drafts.get(draftId)?.threadId;
    if (!id) throw new BackendError("Couldn't find this draft's conversation. Discard it in classic Gmail.", 'not-found');
    await page.discardDraft({ threadId: id, messageId: draftId }).catch(pageFailure);
    this.drafts.delete(draftId);
    this.messageIds.delete(id);
    for (let i = 0; i < SETTLE_TRIES; i++) {
      if (i) await this.sleep(SETTLE_POLL_MS);
      const thread = (await this.fetchThreads([id]).catch((): Thread[] => []))[0];
      if (!thread?.messages.some((m) => m.id === draftId && m.isDraft)) return;
    }
    throw new BackendError("Gmail didn't discard the draft. Discard it in classic Gmail.", 'unknown');
  }

  private async composeContext(message: OutgoingMessage): Promise<ComposeContext> {
    const session = await this.client.session();
    const fromEmail = message.from?.email ?? session.email;
    if (!fromEmail) throw new BackendError("Gmail hasn't said which account is signed in yet.", 'session-unavailable', true);
    const from: Address = message.from ?? { email: fromEmail };

    let base: Omit<ComposeContext, 'attachments'>;
    if (message.draftId) {
      const known = this.drafts.get(message.draftId);
      const threadId = normalizeThreadId(message.threadId) ?? known?.threadId;
      if (!threadId) throw new BackendError('This draft is missing its conversation. Save it again.', 'not-found');
      const target = known ?? (await this.replyTarget(threadId, message.inReplyTo, message.draftId));
      base = { from, threadId, messageId: message.draftId, replyToId: target.replyToId, inReplyTo: target.inReplyTo, isNewThread: false, isNewMessage: false };
    } else if (message.threadId) {
      const threadId = normalizeThreadId(message.threadId);
      if (!threadId) throw new BackendError(`"${message.threadId}" is not a Gmail conversation id.`, 'not-found');
      const target = await this.replyTarget(threadId, message.inReplyTo);
      const { messageId } = newDraftIds(this.random);
      base = { from, threadId, messageId, ...target, isNewThread: false, isNewMessage: true };
    } else {
      const ids = newDraftIds(this.random);
      base = { from, ...ids, replyToId: null, isNewThread: true, isNewMessage: true };
    }
    return { ...base, attachments: await this.upload(message.attachments, session.syncPath, base.messageId) };
  }

  /** The one with the given Message-ID, else the newest sent one. */
  private async replyTarget(threadId: string, inReplyTo: string | undefined, exclude?: string): Promise<DraftTarget> {
    const thread = await this.getThread(threadId);
    const candidates = thread.messages.filter((m) => !m.isDraft && m.id !== exclude);
    const target = (inReplyTo && candidates.find((m) => m.headers.messageId === inReplyTo)) || candidates[candidates.length - 1];
    const rfcId = inReplyTo ?? target?.headers.messageId;
    return rfcId ? { replyToId: target?.id ?? null, inReplyTo: rfcId } : { replyToId: target?.id ?? null };
  }

  private buildMessage(message: OutgoingMessage, ctx: ComposeContext, labels: string[]): unknown[] {
    return composeMessage({
      messageId: ctx.messageId,
      from: ctx.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      html: message.html,
      labels,
      inReplyTo: message.inReplyTo ?? ctx.inReplyTo,
      attachments: ctx.attachments,
      syncRef: this.syncRef,
      now: this.now(),
    });
  }

  /** Draft saves carry the client's history id; learn one with a cheap list call. */
  private async historyId(): Promise<number | undefined> {
    if (this.client.historyId === undefined) await this.listLabels();
    return this.client.historyId;
  }

  /** Unverified against live Gmail: resumable upload to /_/upload, as crouton-labs/capture `uploadAttachmentsForMessage` does. */
  private async upload(files: OutgoingAttachment[], syncPath: string, messageId: string): Promise<unknown[][]> {
    const out: unknown[][] = [];
    const index = accountIndexFromPath(syncPath);
    for (const file of files) {
      const bytes = base64ToBytes(file.data);
      const start = await this.request(`${this.client.origin}/_/upload?authuser=${index}&dcp=asu-n`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-File-Name': encodeURIComponent(file.filename),
          'X-Goog-Upload-Header-Content-Length': String(bytes.length),
          'X-Goog-Upload-Header-Content-Type': file.mimeType,
          'X-Goog-Upload-Protocol': 'resumable',
        },
        body: JSON.stringify([messageId]),
      });
      const uploadUrl = start.headers.get('x-goog-upload-url');
      if (!uploadUrl) throw new BackendError(`Gmail didn't accept the upload of ${file.filename}.`, 'unsupported');
      const done = await this.request(uploadUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.mimeType,
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
        },
        body: bytes,
      }, UPLOAD_TIMEOUT_MS);
      const blobRef = (await done.text()).trim();
      if (!blobRef) throw new BackendError(`Gmail didn't accept the upload of ${file.filename}.`, 'unsupported');
      out.push(uploadedAttachment(file.mimeType, file.filename, bytes.length, `f_${randomBase36(this.random)}`, blobRef));
    }
    return out;
  }

  private async request(url: string, init: RequestInit, ms = this.requestTimeoutMs): Promise<Response> {
    let response: Response;
    try {
      response = await fetchWithin(this.fetchImpl, ms, url, init);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw new BackendError('Google took too long to answer. Try again.', 'network', true);
      throw new BackendError("Couldn't reach Google. Check your connection.", 'network', true);
    }
    assertOk(response);
    return response;
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; mimeType: string }> {
    const session = await this.client.session();
    const index = accountIndexFromPath(session.syncPath);
    const key = attachmentKey(messageId, attachmentId);
    const url = attachmentUrl(this.attachmentUrls.get(key), {
      origin: this.client.origin,
      index,
      ik: session.ik,
      messageId,
      attachmentId,
    });
    if (!url) throw new BackendError("Gmail hasn't finished loading. Try again in a moment.", 'session-unavailable', true);
    const response = await this.request(url, { credentials: 'include' });
    const type = response.headers.get('content-type')?.split(';')[0]?.trim();
    const expected = this.attachmentTypes.get(key);
    if (type === 'text/html' && expected !== 'text/html') {
      throw new BackendError("Gmail couldn't find that attachment.", 'not-found');
    }
    return { data: bytesToBase64(new Uint8Array(await response.arrayBuffer())), mimeType: expected ?? type ?? 'application/octet-stream' };
  }

  /** Set once a page fetch of a thumbnail throws (a cross-origin redirect), so later ones go to the extension. */
  private thumbsViaExtension = false;

  async getThumbnail(messageId: string, attachmentId: string): Promise<{ data: string; mimeType: string } | undefined> {
    const session = await this.client.session();
    const base = attachmentUrl(this.attachmentUrls.get(attachmentKey(messageId, attachmentId)), {
      origin: this.client.origin,
      index: accountIndexFromPath(session.syncPath),
      ik: session.ik,
      messageId,
      attachmentId,
    });
    if (!base) throw new BackendError("Gmail hasn't finished loading. Try again in a moment.", 'session-unavailable', true);
    for (const url of thumbnailUrls(base)) {
      const found = await this.thumbnailAt(url);
      if (found) return found;
    }
    return undefined;
  }

  private async thumbnailAt(url: string): Promise<{ data: string; mimeType: string } | undefined> {
    if (!this.thumbsViaExtension) {
      const abort = new AbortController();
      try {
        const response = await this.fetchImpl(url, { credentials: 'include', signal: abort.signal });
        const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        const length = Number(response.headers.get('content-length') ?? 0);
        // A server that ignores the size asked for would hand back the whole original.
        if (!response.ok || !type.startsWith('image/') || length > THUMB_MAX_BYTES) {
          abort.abort();
          return undefined;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        return bytes.length > THUMB_MAX_BYTES ? undefined : { data: bytesToBase64(bytes), mimeType: type };
      } catch {
        if (abort.signal.aborted) return undefined;
        this.thumbsViaExtension = true;
      }
    }
    return fromDataUrl(await this.fetchPhoto?.(url).catch(() => undefined));
  }

  private readonly listHeaderCache = new Map<string, Promise<Partial<Message['headers']>>>();

  /** Read from the original source, since Gmail's thread data leaves them out. */
  listHeaders(messageId: string): Promise<Partial<Message['headers']>> {
    let pending = this.listHeaderCache.get(messageId);
    if (!pending) {
      pending = (async () => {
        const session = await this.client.session();
        if (!session.ik) throw new BackendError("Gmail hasn't finished loading. Try again in a moment.", 'session-unavailable', true);
        const url = originalSourceUrl(this.client.origin, accountIndexFromPath(session.syncPath), session.ik, messageId);
        const response = await this.request(url, { credentials: 'include' });
        return listHeadersFrom(await headSource(response));
      })();
      pending.catch(() => this.listHeaderCache.delete(messageId));
      this.listHeaderCache.set(messageId, pending);
      cap(this.listHeaderCache, MEMO_LIMIT);
    }
    return pending;
  }

  async createLabel(): Promise<Label> {
    throw new BackendError("Creating labels isn't available with the session backend yet.", 'unsupported');
  }

  async updateLabel(): Promise<Label> {
    throw new BackendError("Editing labels isn't available with the session backend yet.", 'unsupported');
  }

  async deleteLabel(): Promise<void> {
    throw new BackendError("Deleting labels isn't available with the session backend yet.", 'unsupported');
  }

  searchContacts(prefix: string): Promise<Contact[]> {
    return this.people.search(prefix);
  }

  /** Answers, including "no photo", are remembered. */
  lookupPhotos(emails: string[]): Promise<Record<string, string>> {
    return this.people.lookupPhotos(emails);
  }

  async pollChanges(): Promise<MailChange[]> {
    const wait = this.lastPoll + this.pollIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastPoll = this.now();
    if (this.pollFallback) {
      this.written.clear();
      return [{ type: 'all' }];
    }

    const before = this.client.historyId;
    if (before === undefined) {
      await this.listLabels();
      return [];
    }
    let root: unknown;
    try {
      root = await this.client.call('s', pollBody(before, this.client.clock()));
    } catch (err) {
      if (err instanceof BackendError && (err.code === 'unsupported' || err.code === 'unknown')) {
        this.pollFallback = true;
        return [{ type: 'all' }];
      }
      throw err;
    }
    const poll = parsePoll(root);
    const changes: MailChange[] = [];
    const threadIds = [...new Set([...poll.threadIds, ...this.written])];
    this.written.clear();
    if (threadIds.length) changes.push({ type: 'threads', threadIds });
    const counts = JSON.stringify([...poll.labelCounts].sort(([a], [b]) => a.localeCompare(b)));
    if (poll.labelCounts.size && this.labelCounts !== undefined && counts !== this.labelCounts) changes.push({ type: 'labels' });
    if (poll.labelCounts.size) this.labelCounts = counts;
    if (!changes.length && poll.historyId !== undefined && poll.historyId > before) changes.push({ type: 'all' });
    for (const id of poll.threadIds) this.messageIds.delete(id);
    return changes;
  }

  private async accountIndex(): Promise<number> {
    return accountIndexFromPath((await this.client.session()).syncPath);
  }
}

interface ComposeContext extends DraftTarget {
  from: Address;
  threadId: string;
  messageId: string;
  isNewThread: boolean;
  isNewMessage: boolean;
  attachments: unknown[][];
}

function refusedStatuses(root: unknown): number[] {
  return parseAcks(root)
    .filter((ack) => ack.status !== 0)
    .map((ack) => ack.status);
}

/** The status is the one detail a report of this can pass on. */
function refusedError(statuses: number[]) {
  return new BackendError(`Gmail turned down the change. Reload Gmail and try again (code ${statuses.join(', ')}).`, 'unsupported', true);
}

function assertAccepted(root: unknown) {
  const refused = refusedStatuses(root);
  if (refused.length) throw refusedError(refused);
}

function findMessage(threads: Thread[], messageId: string): { threadId: string; message: Message } | undefined {
  for (const thread of threads) {
    const message = thread.messages.find((m) => m.id === messageId);
    if (message) return { threadId: thread.id, message };
  }
  return undefined;
}

function localDraft(message: OutgoingMessage, ctx: ComposeContext, now: number): Message {
  const headers: Message['headers'] = {};
  const inReplyTo = message.inReplyTo ?? ctx.inReplyTo;
  if (inReplyTo) headers.inReplyTo = inReplyTo;
  if (message.references) headers.references = message.references;
  return {
    id: ctx.messageId,
    threadId: ctx.threadId,
    labelIds: ['DRAFT'],
    from: ctx.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    date: now,
    subject: message.subject,
    snippet: '',
    bodyHtml: message.html,
    attachments: [],
    headers,
    isDraft: true,
  };
}

/** Gmail's attachment URLs sometimes omit the account ("/mail/?ui=2&..."), which gmail.js also rewrites. Without one, build the documented `?ui=2&ik=..&attid=..&permmsgid=..&view=att` form. */
function attachmentUrl(
  known: string | undefined,
  ctx: { origin: string; index: number; ik?: string; messageId: string; attachmentId: string },
): string | undefined {
  let url: string;
  if (known) {
    // Edited as a string so Gmail's valueless flags ("&zw") survive untouched.
    url = known.startsWith('/') ? `${ctx.origin}${known}` : known;
    if (!url.startsWith(`${ctx.origin}/`)) return undefined;
    url = url.replace(`${ctx.origin}/mail/?`, `${ctx.origin}/mail/u/${ctx.index}/?`);
  } else {
    if (!ctx.ik) return undefined;
    const params = new URLSearchParams({ ui: '2', ik: ctx.ik, attid: ctx.attachmentId, permmsgid: ctx.messageId, view: 'att' });
    url = `${ctx.origin}/mail/u/${ctx.index}/?${params}`;
  }
  return /[?&]disp=/.test(url) ? url : `${url}&disp=safe`;
}

const THUMB_MAX_BYTES = 1_000_000;
/** A 25 MB attachment on a slow uplink. */
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

function encodePageToken(start: number, firstId: string): string {
  return `${start}~${firstId}`;
}

function decodePageToken(token: string | undefined): { start: number; previousFirst?: string } {
  if (!token) return { start: 0 };
  const [start, previousFirst] = token.split('~');
  const n = Number(start);
  if (!Number.isInteger(n) || n < 0) throw new BackendError('That page of results has expired. Reload the list.', 'not-found');
  return { start: n, previousFirst };
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

function randomBase36(random: RandomBytes): string {
  const bytes = random(new Uint8Array(9));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Firefox gives content scripts `content.fetch` for requests made as the page. */
function pageFetch(): typeof fetch {
  const content = (globalThis as { content?: { fetch?: typeof fetch } }).content;
  if (content && typeof content.fetch === 'function') return content.fetch.bind(content);
  return globalThis.fetch.bind(globalThis);
}
