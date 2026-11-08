import { BackendError, type BackendEvent, type MailBackend } from '../backend';
import type {
  Account,
  BackendCapabilities,
  Contact,
  Draft,
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
import { cap } from '../../../shared/bounded';
import type { GeminiRequest, GeminiResult, GeminiStatus } from '../gemini';
import { mergedLabelId, mergedLabelName, qualify, rawId, splitId } from './ids';

// One backend over several accounts. User labels are matched by name, and an account that fails to
// answer is named in `unavailable` instead of failing the whole list.

const KNOWN_LIMIT = 20_000;

export interface MergedMember {
  key: string;
  email: string;
  backend: MailBackend;
}

interface MergedOptions {
  /** Words that pick an account in `account:` searches, by key. Read on every search. */
  aliases?: () => Record<string, string[]>;
}

interface Cursor {
  /** Member page token (undefined: its first page). */
  t?: string;
  /** Threads already taken from that page. */
  s: number;
  done?: 1;
  failed?: 1;
}

const TOKEN_PREFIX = 'm1:';
const PAGE_CACHE_LIMIT = 120;
const DEFAULT_PAGE_SIZE = 50;

function encodeToken(state: Record<string, Cursor>): string {
  return TOKEN_PREFIX + JSON.stringify(state);
}

function decodeToken(token: string): Record<string, Cursor> {
  if (!token.startsWith(TOKEN_PREFIX)) throw new BackendError('Invalid page token', 'unknown');
  try {
    return JSON.parse(token.slice(TOKEN_PREFIX.length)) as Record<string, Cursor>;
  } catch {
    throw new BackendError('Invalid page token', 'unknown');
  }
}

/** System and other built-in ids (INBOX, CATEGORY_SOCIAL, MUTED) mean the same thing in every account. */
const isBuiltIn = (id: string) => /^[A-Z][A-Z0-9_]*$/.test(id);

interface LabelState {
  list: Label[];
  toMerged: Map<string, string>;
  /** Lowercased name → member label id. */
  byName: Map<string, string>;
}

const OPTIONAL = ['cancelScheduled', 'lookupPhotos', 'listHeaders', 'unsubscribe', 'getRawMessage', 'getThumbnail', 'geminiStatus', 'gemini', 'cancelGemini'] as const;

export function createMergedBackend(members: MergedMember[], options: MergedOptions = {}): MailBackend {
  if (!members.length) throw new BackendError('No accounts to show', 'unknown');
  return new MergedBackend(members, options);
}

class MergedBackend implements MailBackend {
  readonly kind: MailBackend['kind'];
  readonly capabilities: BackendCapabilities;

  private readonly byKey: Map<string, MergedMember>;
  private readonly labels = new Map<string, Promise<LabelState>>();
  private readonly accounts = new Map<string, Promise<Account>>();
  private readonly pages = new Map<string, Promise<ThreadPage>>();
  /** For ids that arrive without their account (old links, notifications). */
  private readonly known = new Map<string, string>();

  constructor(
    private readonly members: MergedMember[],
    private readonly options: MergedOptions,
  ) {
    this.byKey = new Map(members.map((m) => [m.key, m]));
    this.kind = members[0]!.backend.kind;
    const all = (k: keyof BackendCapabilities) => members.every((m) => !!m.backend.capabilities[k]);
    this.capabilities = {
      send: all('send'),
      drafts: all('drafts'),
      snooze: all('snooze'),
      // Only the tab's own account can schedule in session mode; send() says so for the others.
      scheduleSend: members.some((m) => m.backend.capabilities.scheduleSend),
      mute: all('mute'),
      labelsEdit: all('labelsEdit'),
      // Filters belong to one account; edit them from that account.
      filters: false,
      contacts: members.some((m) => m.backend.capabilities.contacts),
      attachments: all('attachments'),
      deleteForever: all('deleteForever'),
      changes: all('changes'),
      listHeadersOnDemand: members.some((m) => m.backend.capabilities.listHeadersOnDemand),
    };
    // Optional methods exist only when some account has them, so the UI's checks stay honest.
    for (const name of OPTIONAL) {
      if (!members.some((m) => typeof m.backend[name] === 'function')) {
        Object.defineProperty(this, name, { value: undefined });
      }
    }
  }

  private account(m: MergedMember): Promise<Account> {
    let p = this.accounts.get(m.key);
    if (!p) {
      p = m.backend.getAccount();
      this.accounts.set(m.key, p);
      p.catch(() => this.accounts.delete(m.key));
    }
    return p;
  }

  async getAccount(): Promise<Account> {
    const settled = await Promise.allSettled(this.members.map((m) => m.backend.getAccount()));
    const read = settled.map((r, i) => {
      const m = this.members[i]!;
      if (r.status === 'fulfilled') {
        this.accounts.set(m.key, Promise.resolve(r.value));
        return { m, account: r.value };
      }
      return { m, account: undefined };
    });
    const first = read.find((r) => r.account);
    if (!first) throw (settled[0] as PromiseRejectedResult).reason;
    const sendAs = new Map<string, { name?: string; email: string }>();
    for (const { account } of read) {
      if (!account) continue;
      for (const a of account.sendAs?.length ? account.sendAs : [{ name: account.name, email: account.email }]) {
        if (!sendAs.has(a.email.toLowerCase())) sendAs.set(a.email.toLowerCase(), a);
      }
    }
    return {
      ...first.account!,
      sendAs: [...sendAs.values()],
      members: read.map(({ m, account }) => ({
        key: m.key,
        email: account?.email ?? m.email,
        name: account?.name ?? m.email,
        index: account?.index ?? 0,
        ...(account?.photoUrl ? { photoUrl: account.photoUrl } : {}),
        ...(account?.sendAs ? { sendAs: account.sendAs } : {}),
        ...(account?.signature ? { signature: account.signature } : {}),
      })),
    };
  }

  private labelState(m: MergedMember, fresh = false): Promise<LabelState> {
    let p = fresh ? undefined : this.labels.get(m.key);
    if (!p) {
      p = m.backend.listLabels().then((list) => {
        const toMerged = new Map<string, string>();
        const byName = new Map<string, string>();
        for (const l of list) {
          if (l.type === 'system' || isBuiltIn(l.id)) toMerged.set(l.id, l.id);
          else {
            toMerged.set(l.id, mergedLabelId(l.name));
            byName.set(l.name.toLowerCase(), l.id);
          }
        }
        return { list, toMerged, byName };
      });
      this.labels.set(m.key, p);
      p.catch(() => this.labels.delete(m.key));
    }
    return p;
  }

  async listLabels(): Promise<Label[]> {
    const settled = await Promise.allSettled(this.members.map((m) => this.labelState(m, true)));
    if (!settled.some((r) => r.status === 'fulfilled')) throw (settled[0] as PromiseRejectedResult).reason;
    const merged = new Map<string, Label>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const l of r.value.list) {
        const id = r.value.toMerged.get(l.id)!;
        const prev = merged.get(id);
        if (!prev) {
          merged.set(id, { ...l, id });
          continue;
        }
        const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
        merged.set(id, {
          ...prev,
          unreadCount: sum(prev.unreadCount, l.unreadCount),
          totalCount: sum(prev.totalCount, l.totalCount),
          color: prev.color ?? l.color,
          // Shown if any account shows it.
          hidden: prev.hidden && l.hidden ? true : undefined,
        });
      }
    }
    return [...merged.values()].map((l) => (l.hidden ? l : (({ hidden: _h, ...rest }) => rest)(l)));
  }

  private toMergedLabels(key: string, ids: LabelId[], state: LabelState | undefined): LabelId[] {
    return ids.map((id) => state?.toMerged.get(id) ?? (isBuiltIn(id) ? id : qualify(key, id)));
  }

  /** Names the account doesn't have yet are created when adding. */
  private async memberChange(m: MergedMember, change: LabelChange): Promise<LabelChange> {
    let state = await this.labelState(m).catch(() => undefined);
    const map = async (ids: LabelId[] | undefined, create: boolean) => {
      const out: LabelId[] = [];
      for (const id of ids ?? []) {
        const name = mergedLabelName(id);
        if (name === undefined) {
          const { key, raw } = splitId(id);
          if (!key || key === m.key) out.push(raw);
          continue;
        }
        let raw = state?.byName.get(name.toLowerCase());
        if (!raw && create) {
          const color = (await this.listLabelsCached()).find((l) => l.id === id)?.color;
          const made = await m.backend.createLabel({ name, ...(color ? { color } : {}) });
          state = await this.labelState(m, true);
          raw = made.id;
        }
        if (raw) out.push(raw);
      }
      return out;
    };
    return { add: await map(change.add, true), remove: await map(change.remove, false) };
  }

  private async listLabelsCached(): Promise<Label[]> {
    const states = await Promise.allSettled(this.members.map((m) => this.labelState(m)));
    return states.flatMap((r) => (r.status === 'fulfilled' ? r.value.list.map((l) => ({ ...l, id: r.value.toMerged.get(l.id)! })) : []));
  }

  async createLabel(label: Pick<Label, 'name' | 'color'>): Promise<Label> {
    const m = this.members[0]!;
    const made = await m.backend.createLabel(label);
    await this.labelState(m, true).catch(() => undefined);
    return { ...made, id: mergedLabelId(made.name) };
  }

  async updateLabel(id: string, patch: Partial<Pick<Label, 'name' | 'color' | 'hidden'>>): Promise<Label> {
    const name = mergedLabelName(id);
    const done = await this.eachWithLabel(id, (m, raw) => m.backend.updateLabel(raw, patch));
    if (!done.length) throw new BackendError(`No account has the label ${name ?? id}`, 'not-found');
    const first = done[0]!;
    return { ...first, id: name === undefined ? first.id : mergedLabelId(first.name) };
  }

  async deleteLabel(id: string): Promise<void> {
    await this.eachWithLabel(id, (m, raw) => m.backend.deleteLabel(raw));
  }

  private async eachWithLabel<T>(id: string, fn: (m: MergedMember, raw: string) => Promise<T>): Promise<T[]> {
    const name = mergedLabelName(id);
    const out: T[] = [];
    for (const m of this.members) {
      const state = await this.labelState(m).catch(() => undefined);
      const raw = name === undefined ? id : state?.byName.get(name.toLowerCase());
      if (!raw) continue;
      out.push(await fn(m, raw));
      this.labels.delete(m.key);
    }
    return out;
  }

  private summary(key: string, t: ThreadSummary, labels: LabelState | undefined): ThreadSummary {
    cap(this.known.set(t.id, key), KNOWN_LIMIT);
    return {
      ...t,
      id: qualify(key, t.id),
      labelIds: this.toMergedLabels(key, t.labelIds, labels),
      attachments: t.attachments.map((a) => ({ ...a, messageId: qualify(key, a.messageId) })),
    };
  }

  private message(key: string, m: Message, labels: LabelState | undefined): Message {
    return {
      ...m,
      id: qualify(key, m.id),
      threadId: qualify(key, m.threadId),
      labelIds: this.toMergedLabels(key, m.labelIds, labels),
      attachments: m.attachments.map((a) => ({ ...a, messageId: qualify(key, a.messageId) })),
    };
  }

  private async thread(key: string, t: Thread): Promise<Thread> {
    const labels = await this.labelState(this.byKey.get(key)!).catch(() => undefined);
    return { ...this.summary(key, t, labels), messages: t.messages.map((m) => this.message(key, m, labels)) };
  }

  /** Unqualified ids are looked up, then searched for. */
  private async locate(id: string, kind: 'thread' | 'other' = 'other'): Promise<{ m: MergedMember; raw: string }> {
    const { key, raw } = splitId(id);
    if (key) {
      const m = this.byKey.get(key);
      if (m) return { m, raw };
      throw new BackendError('That conversation belongs to an account that isn’t in this view.', 'not-found');
    }
    const known = this.known.get(raw);
    if (known) return { m: this.byKey.get(known)!, raw };
    if (kind === 'thread') {
      for (const m of this.members) {
        try {
          await m.backend.getThread(raw);
          cap(this.known.set(raw, m.key), KNOWN_LIMIT);
          return { m, raw };
        } catch {
          // Not this account's.
        }
      }
    }
    throw new BackendError('Couldn’t tell which account that belongs to.', 'not-found');
  }

  private async group(ids: string[]): Promise<Map<MergedMember, string[]>> {
    const out = new Map<MergedMember, string[]>();
    for (const id of ids) {
      const { m, raw } = await this.locate(id, 'thread');
      out.set(m, [...(out.get(m) ?? []), raw]);
    }
    return out;
  }

  private async each(ids: string[], fn: (m: MergedMember, raws: string[]) => Promise<void>): Promise<void> {
    const groups = await this.group(ids);
    await Promise.all([...groups].map(([m, raws]) => fn(m, raws)));
  }

  private pick(q: string): { q: string; members: MergedMember[] } {
    const words: string[] = [];
    const rest = q
      .replace(/(^|\s)account:("[^"]*"|\S+)/gi, (_, lead: string, value: string) => {
        words.push(value.replace(/"/g, '').trim().toLowerCase());
        return lead;
      })
      .replace(/\s+/g, ' ')
      .trim();
    if (!words.length) return { q, members: this.members };
    const aliases = this.options.aliases?.() ?? {};
    const matches = (m: MergedMember, w: string) => {
      const email = m.email.toLowerCase();
      if (!w) return false;
      if (email === w || email.startsWith(w) || m.key === w) return true;
      return (aliases[m.key] ?? []).some((a) => {
        const alias = a.toLowerCase();
        return alias === w || alias.startsWith(w) || alias.split(/\s+/).includes(w);
      });
    };
    return { q: rest, members: this.members.filter((m) => words.some((w) => matches(m, w))) };
  }

  private page(m: MergedMember, q: string, t: string | undefined, pageSize: number): Promise<ThreadPage> {
    const id = `${m.key}\n${q}\n${t ?? ''}\n${pageSize}`;
    let p = this.pages.get(id);
    if (!p) {
      p = m.backend.listThreads({ q, pageSize, ...(t ? { pageToken: t } : {}) });
      this.pages.set(id, p);
      p.catch(() => this.pages.delete(id));
      while (this.pages.size > PAGE_CACHE_LIMIT) this.pages.delete(this.pages.keys().next().value!);
    }
    return p;
  }

  async listThreads(query: ThreadQuery): Promise<ThreadPage> {
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { q, members } = this.pick(query.q);
    if (!members.length) return { threads: [], resultSizeEstimate: 0 };
    const fresh = !query.pageToken;
    const state: Record<string, Cursor> = fresh ? Object.fromEntries(members.map((m) => [m.key, { s: 0 }])) : decodeToken(query.pageToken!);
    if (fresh) {
      // A first page is always read again; later pages continue from what it saw.
      for (const id of [...this.pages.keys()]) {
        const [key, pq] = id.split('\n');
        if (pq === q && this.byKey.has(key!)) this.pages.delete(id);
      }
    }

    const unavailable: { email: string; message: string }[] = [];
    const errors: unknown[] = [];
    const heads = new Map<string, { page: ThreadPage; items: ThreadSummary[] }>();
    const fail = (m: MergedMember, err: unknown) => {
      state[m.key] = { ...state[m.key]!, failed: 1 };
      heads.delete(m.key);
      errors.push(err);
      unavailable.push({ email: m.email, message: (err as Error)?.message ?? String(err) });
    };
    const load = async (m: MergedMember) => {
      const c = state[m.key];
      if (!c || c.done || c.failed) return;
      try {
        const page = await this.page(m, q, c.t, pageSize);
        heads.set(m.key, { page, items: page.threads.slice(c.s) });
      } catch (err) {
        fail(m, err);
      }
    };
    await Promise.all(members.map(load));
    if (!heads.size && errors.length) throw errors[0];

    const labelStates = new Map<string, LabelState | undefined>();
    await Promise.all(
      members.map(async (m) => labelStates.set(m.key, await this.labelState(m).catch(() => undefined))),
    );

    const out: ThreadSummary[] = [];
    while (out.length < pageSize) {
      // An account whose page ran out may have newer mail on its next page than the others' heads.
      const refill = [...heads].filter(([, h]) => !h.items.length && h.page.nextPageToken);
      if (refill.length) {
        await Promise.all(
          refill.map(async ([key, h]) => {
            const m = this.byKey.get(key)!;
            state[key] = { t: h.page.nextPageToken, s: 0 };
            try {
              const page = await this.page(m, q, h.page.nextPageToken, pageSize);
              heads.set(key, { page, items: [...page.threads] });
            } catch (err) {
              fail(m, err);
            }
          }),
        );
        continue;
      }
      let best: string | undefined;
      for (const [key, h] of heads) {
        const top = h.items[0];
        if (top && (best === undefined || top.lastDate > heads.get(best)!.items[0]!.lastDate)) best = key;
      }
      if (best === undefined) break;
      const t = heads.get(best)!.items.shift()!;
      state[best]!.s += 1;
      out.push(this.summary(best, t, labelStates.get(best)));
    }

    let more = false;
    for (const [key, h] of heads) {
      if (h.items.length || h.page.nextPageToken) more = true;
      else state[key] = { ...state[key]!, done: 1 };
    }
    const estimates = [...heads.values()].map((h) => h.page.resultSizeEstimate);
    return {
      threads: out,
      ...(more ? { nextPageToken: encodeToken(state) } : {}),
      ...(fresh && estimates.length && estimates.every((e) => e !== undefined)
        ? { resultSizeEstimate: estimates.reduce((a, b) => a! + b!, 0) }
        : {}),
      ...(fresh && [...heads.values()].some((h) => h.page.resultSizeAtLeast) ? { resultSizeAtLeast: true } : {}),
      ...(unavailable.length ? { unavailable } : {}),
    };
  }

  async getThread(threadId: string): Promise<Thread> {
    const { m, raw } = await this.locate(threadId, 'thread');
    return this.thread(m.key, await m.backend.getThread(raw));
  }

  modifyThreads(threadIds: string[], change: LabelChange): Promise<void> {
    return this.each(threadIds, async (m, raws) => m.backend.modifyThreads(raws, await this.memberChange(m, change)));
  }

  trashThreads(threadIds: string[]) {
    return this.each(threadIds, (m, raws) => m.backend.trashThreads(raws));
  }

  untrashThreads(threadIds: string[]) {
    return this.each(threadIds, (m, raws) => m.backend.untrashThreads(raws));
  }

  deleteThreadsForever(threadIds: string[]) {
    return this.each(threadIds, (m, raws) => m.backend.deleteThreadsForever(raws));
  }

  /** Every account's folder; without this the app would only delete the loaded rows. */
  async emptyFolder(folder: 'trash' | 'spam'): Promise<number> {
    const lacking = this.members.find((m) => !m.backend.emptyFolder);
    if (lacking) throw new BackendError(`${lacking.email} can't empty ${folder === 'trash' ? 'Trash' : 'Spam'} from here.`, 'unsupported');
    const counts = await Promise.all(this.members.map((m) => m.backend.emptyFolder!(folder)));
    return counts.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  }

  snoozeThreads(threadIds: string[], until: number) {
    return this.each(threadIds, (m, raws) => m.backend.snoozeThreads(raws, until));
  }

  unsnoozeThreads(threadIds: string[]) {
    return this.each(threadIds, (m, raws) => m.backend.unsnoozeThreads(raws));
  }

  muteThreads(threadIds: string[], muted: boolean) {
    return this.each(threadIds, (m, raws) => m.backend.muteThreads(raws, muted));
  }

  /** The account owning its thread or draft, else the one whose address or alias is in From, else the first. */
  private async sender(message: OutgoingMessage): Promise<MergedMember> {
    for (const id of [message.threadId, message.draftId]) {
      if (!id) continue;
      const { key } = splitId(id);
      if (key && this.byKey.has(key)) return this.byKey.get(key)!;
    }
    const from = message.from?.email.toLowerCase();
    if (from) {
      const direct = this.members.find((m) => m.email.toLowerCase() === from);
      if (direct) return direct;
      for (const m of this.members) {
        const account = await this.account(m).catch(() => undefined);
        if (account?.sendAs?.some((a) => a.email.toLowerCase() === from)) return m;
      }
    }
    return this.members[0]!;
  }

  private outgoing(message: OutgoingMessage): OutgoingMessage {
    return {
      ...message,
      ...(message.threadId ? { threadId: splitId(message.threadId).raw } : {}),
      ...(message.draftId ? { draftId: splitId(message.draftId).raw } : {}),
    };
  }

  async send(message: OutgoingMessage): Promise<{ id: string; threadId: string }> {
    const m = await this.sender(message);
    if (message.sendAt !== undefined && !m.backend.capabilities.scheduleSend) {
      throw new BackendError(`To schedule from ${m.email}, switch to that account first.`, 'unsupported');
    }
    const sent = await m.backend.send(this.outgoing(message));
    cap(this.known.set(sent.threadId, m.key), KNOWN_LIMIT);
    return { id: qualify(m.key, sent.id), threadId: qualify(m.key, sent.threadId) };
  }

  async saveDraft(message: OutgoingMessage): Promise<Draft> {
    const m = await this.sender(message);
    const draft = await m.backend.saveDraft(this.outgoing(message));
    const labels = await this.labelState(m).catch(() => undefined);
    return { id: qualify(m.key, draft.id), message: this.message(m.key, draft.message, labels) };
  }

  async deleteDraft(draftId: string, threadId?: string): Promise<void> {
    const { m, raw } = await this.locate(draftId);
    await m.backend.deleteDraft(raw, threadId ? rawId(threadId) : undefined);
  }

  async cancelScheduled(threadId: string): Promise<void> {
    const { m, raw } = await this.locate(threadId, 'thread');
    if (!m.backend.cancelScheduled) throw new BackendError('This account can’t cancel scheduled mail', 'unsupported');
    await m.backend.cancelScheduled(raw);
  }

  async getAttachment(messageId: string, attachmentId: string) {
    const { m, raw } = await this.locate(messageId);
    return m.backend.getAttachment(raw, attachmentId);
  }

  async getThumbnail(messageId: string, attachmentId: string) {
    const { m, raw } = await this.locate(messageId);
    return m.backend.getThumbnail ? m.backend.getThumbnail(raw, attachmentId) : undefined;
  }

  async getRawMessage(messageId: string): Promise<string> {
    const { m, raw } = await this.locate(messageId);
    if (!m.backend.getRawMessage) throw new BackendError('This account can’t show the original message', 'unsupported');
    return m.backend.getRawMessage(raw);
  }

  async listHeaders(messageId: string): Promise<Partial<Message['headers']>> {
    const { m, raw } = await this.locate(messageId);
    return m.backend.listHeaders ? m.backend.listHeaders(raw) : {};
  }

  async unsubscribe(messageId: string): Promise<'one-click' | 'mailto' | 'link'> {
    const { m, raw } = await this.locate(messageId);
    if (!m.backend.unsubscribe) throw new BackendError('This account can’t unsubscribe from here', 'unsupported');
    return m.backend.unsubscribe(raw);
  }

  async searchContacts(prefix: string): Promise<Contact[]> {
    const settled = await Promise.allSettled(this.members.map((m) => m.backend.searchContacts(prefix)));
    if (!settled.some((r) => r.status === 'fulfilled')) throw (settled[0] as PromiseRejectedResult).reason;
    const seen = new Map<string, Contact>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const c of r.value) {
        const key = c.email.toLowerCase();
        const prev = seen.get(key);
        if (!prev) seen.set(key, c);
        else if (!prev.photoUrl && c.photoUrl) seen.set(key, { ...prev, photoUrl: c.photoUrl });
      }
    }
    return [...seen.values()];
  }

  async lookupPhotos(emails: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    let rest = emails;
    for (const m of this.members) {
      if (!rest.length || !m.backend.lookupPhotos) continue;
      try {
        Object.assign(out, await m.backend.lookupPhotos(rest));
        rest = rest.filter((e) => !(e.toLowerCase() in out));
      } catch {
        // The next account may know.
      }
    }
    return out;
  }

  /** So Stop reaches the account that answered. */
  private readonly geminiRuns = new Map<string, MergedMember>();
  /** Stopped before an account was picked; checked once it is, so the request never starts. */
  private readonly geminiStopped = new Set<string>();

  /** A question about the whole mailbox goes to the first account whose Gemini can run. */
  private async geminiMember(): Promise<MergedMember | undefined> {
    for (const m of this.members) {
      if (!m.backend.geminiStatus) continue;
      const status = await m.backend.geminiStatus().catch(() => undefined);
      if (status?.ready) return m;
    }
    return undefined;
  }

  async geminiStatus(): Promise<GeminiStatus> {
    const m = await this.geminiMember();
    if (m) return m.backend.geminiStatus!();
    const first = this.members.find((m) => m.backend.geminiStatus);
    return first ? first.backend.geminiStatus!() : { ready: false, block: 'connection' };
  }

  async gemini(request: GeminiRequest, requestId: string): Promise<GeminiResult> {
    const threadId = 'threadId' in request ? request.threadId : undefined;
    let m: MergedMember | undefined;
    let ask = request;
    if (threadId) {
      const found = await this.locate(threadId, 'thread');
      m = found.m;
      ask = { ...request, threadId: found.raw } as GeminiRequest;
    } else {
      m = await this.geminiMember();
    }
    if (!m?.backend.gemini) throw new BackendError('Gemini isn’t available for this account.', 'unsupported');
    if (threadId && m.backend.geminiStatus) {
      // Each account has its own plan: a conversation from one without Gemini says so quietly.
      const status = await m.backend.geminiStatus().catch(() => undefined);
      if (!status?.ready) throw new BackendError(`Gemini isn’t available for ${m.email}.`, 'unsupported');
    }
    if (this.geminiStopped.delete(requestId)) throw new BackendError('Stopped', 'unknown');
    this.geminiRuns.set(requestId, m);
    try {
      const result = await m.backend.gemini(ask, requestId);
      const q = (id: string) => qualify(m.key, id);
      if (result.kind === 'answer') return { ...result, sources: result.sources.map((src) => ({ ...src, threadId: q(src.threadId) })) };
      if (result.kind === 'briefing') {
        return {
          ...result,
          todos: result.todos.map((t) => ({ ...t, threadId: q(t.threadId) })),
          topics: result.topics.map((t) => ({
            ...t,
            threadIds: t.threadIds.map(q),
            ...(t.sources ? { sources: t.sources.map((src) => ({ ...src, threadId: q(src.threadId) })) } : {}),
          })),
        };
      }
      return result;
    } finally {
      this.geminiRuns.delete(requestId);
    }
  }

  async cancelGemini(requestId: string): Promise<void> {
    const m = this.geminiRuns.get(requestId);
    if (!m) {
      cap(this.geminiStopped.add(requestId), 200);
      return;
    }
    await m.backend.cancelGemini?.(requestId);
  }

  subscribe(listener: (event: BackendEvent) => void): () => void {
    const stops = this.members.map((m) => m.backend.subscribe?.(listener));
    return () => stops.forEach((stop) => stop?.());
  }

  async pollChanges(): Promise<MailChange[]> {
    const settled = await Promise.allSettled(this.members.map((m) => m.backend.pollChanges()));
    if (!settled.some((r) => r.status === 'fulfilled')) throw (settled[0] as PromiseRejectedResult).reason;
    const out: MailChange[] = [];
    settled.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const key = this.members[i]!.key;
      for (const c of r.value) {
        if (c.type === 'threads') out.push({ type: 'threads', threadIds: c.threadIds.map((id) => qualify(key, id)) });
        else {
          if (c.type === 'labels') this.labels.delete(key);
          out.push(c);
        }
      }
    });
    return out.some((c) => c.type === 'all') ? [{ type: 'all' }] : out;
  }
}
