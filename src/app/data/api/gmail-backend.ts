/**
 * MailBackend over the public Gmail REST API v1. Snooze and mute aren't in the public API, so they're emulated with hidden user labels
 * plus storage.local: snooze swaps INBOX for "Snoozed (Better Gmail)" and the background's alarm calls wakeSnoozed(); mute swaps INBOX
 * for "Muted (Better Gmail)" and pollChanges archives new replies. No schedule send: the API has no send-time field.
 */
import { cap } from '../../../shared/bounded';
import { BackendError, type MailBackend } from '../backend';
import type {
  Account,
  BackendCapabilities,
  Contact,
  Draft,
  Filter,
  Label,
  LabelChange,
  MailChange,
  OutgoingMessage,
  Thread,
  ThreadPage,
  ThreadQuery,
} from '../types';
import { parseAddressList } from './address';
import { base64DecodedSize, base64ToBytes, base64UrlToBase64, decodeBytes, encodeBase64UrlText } from './base64';
import type { BatchItem } from './batch';
import { ContactSearch } from './contacts';
import type {
  GmailDraft,
  GmailFilter,
  GmailHistoryList,
  GmailLabel,
  GmailMessage,
  GmailProfile,
  GmailSendAs,
  GmailThread,
  GmailThreadList,
} from './gmail-types';
import { errorFromResponse, GMAIL_API, GMAIL_BASE, HttpClient, unwrapBatch, type FetchLike, type HttpOptions, type TokenProvider } from './http';
import { toGmailColor, toLabel } from './labels';
import { buildMime } from './mime-build';
import { findPart, header, parsePayload, toMessage } from './payload';
import {
  browserLocalStore,
  HELPER_LABELS_STORAGE_KEY,
  MUTE_LABEL_NAME,
  MUTED_STORAGE_KEY,
  SNOOZE_LABEL_NAME,
  SNOOZE_STORAGE_KEY,
  type KeyValueStore,
} from './storage';
import { toThread, toThreadSummary, type SummaryContext } from './threads';
import { parseListUnsubscribe, parseMailto } from '../../lib/unsubscribe';

/** Attachments above this total go through the media upload endpoint. */
export const UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
const LIST_HEADERS = ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe'];
const MAX_PAGE = 50;

export interface ApiBackendOptions extends HttpOptions {
  storage?: KeyValueStore;
  now?: () => number;
  /** RFC 8058 one-click unsubscribe POST. Defaults to a credential-less no-cors fetch, which needs no host permission and never carries the Google token. */
  postOneClick?: (url: string) => Promise<void>;
}

type HelperKind = 'snoozed' | 'muted';
const HELPER_NAMES: Record<HelperKind, string> = { snoozed: SNOOZE_LABEL_NAME, muted: MUTE_LABEL_NAME };

const API_CAPABILITIES: BackendCapabilities = {
  send: true,
  drafts: true,
  snooze: true,
  scheduleSend: false,
  mute: true,
  labelsEdit: true,
  filters: true,
  contacts: true,
  attachments: true,
  deleteForever: true,
  changes: true,
};

const enc = encodeURIComponent;


function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function metadataPath(threadId: string, headers: string[]): string {
  return `/gmail/v1/users/me/threads/${enc(threadId)}?format=metadata&${headers.map((h) => `metadataHeaders=${enc(h)}`).join('&')}`;
}

export class GmailApiBackend implements MailBackend {
  readonly kind = 'api' as const;
  readonly capabilities = API_CAPABILITIES;

  private readonly http: HttpClient;
  private readonly storage: KeyValueStore;
  private readonly now: () => number;
  private readonly fetchImpl: FetchLike;
  private readonly postOneClickImpl?: (url: string) => Promise<void>;
  private readonly contacts: ContactSearch;
  private readonly helperIds: Partial<Record<HelperKind, string>> = {};
  private readonly attachmentTypes = new Map<string, string>();
  private historyId?: string;

  constructor(getToken: TokenProvider, options: ApiBackendOptions = {}) {
    this.http = new HttpClient(getToken, options);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.storage = options.storage ?? browserLocalStore();
    this.now = options.now ?? Date.now;
    this.postOneClickImpl = options.postOneClick;
    this.contacts = new ContactSearch(this.http, this.now);
  }

  async getAccount(): Promise<Account> {
    const profile = await this.http.request<GmailProfile>(`${GMAIL_API}/profile`);
    this.historyId ??= profile.historyId;
    let sendAs: GmailSendAs[] = [];
    try {
      sendAs = (await this.http.request<{ sendAs?: GmailSendAs[] }>(`${GMAIL_API}/settings/sendAs`)).sendAs ?? [];
    } catch (err) {
      if (!(err instanceof BackendError) || err.code === 'unauthenticated') throw err;
    }
    const primary = sendAs.find((s) => s.isPrimary) ?? sendAs.find((s) => s.sendAsEmail === profile.emailAddress);
    const preferred = sendAs.find((s) => s.isDefault) ?? primary;
    const account: Account = {
      email: profile.emailAddress,
      name: primary?.displayName || profile.emailAddress.split('@')[0],
      index: 0,
    };
    const usable = sendAs.filter((s) => !s.verificationStatus || s.verificationStatus === 'accepted');
    if (usable.length) {
      account.sendAs = usable.map((s) => (s.displayName ? { name: s.displayName, email: s.sendAsEmail } : { email: s.sendAsEmail }));
    }
    if (preferred?.signature) account.signature = preferred.signature;
    return account;
  }

  async listLabels(): Promise<Label[]> {
    const list = await this.http.request<{ labels?: GmailLabel[] }>(`${GMAIL_API}/labels`);
    const labels = list.labels ?? [];
    const results = await this.http.batch(labels.map((l) => ({ method: 'GET', path: `/gmail/v1/users/me/labels/${enc(l.id)}` })));
    const helperNames = new Set(Object.values(HELPER_NAMES));
    return labels.map((l, i) => {
      const r = results[i];
      const full = r && r.status >= 200 && r.status < 300 ? (r.body as GmailLabel) : l;
      const label = toLabel(full);
      if (helperNames.has(l.name)) {
        label.hidden = true;
        const kind = (Object.keys(HELPER_NAMES) as HelperKind[]).find((k) => HELPER_NAMES[k] === l.name)!;
        this.helperIds[kind] = l.id;
      }
      return label;
    });
  }

  async createLabel(label: Pick<Label, 'name' | 'color'>): Promise<Label> {
    const created = await this.http.request<GmailLabel>(`${GMAIL_API}/labels`, {
      body: {
        name: label.name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        ...(label.color ? { color: toGmailColor(label.color) } : {}),
      },
    });
    return toLabel(created);
  }

  async updateLabel(id: string, patch: Partial<Pick<Label, 'name' | 'color' | 'hidden'>>): Promise<Label> {
    const body: Partial<GmailLabel> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.color) body.color = toGmailColor(patch.color);
    if (patch.hidden !== undefined) body.labelListVisibility = patch.hidden ? 'labelHide' : 'labelShow';
    const updated = await this.http.request<GmailLabel>(`${GMAIL_API}/labels/${enc(id)}`, { method: 'PATCH', body });
    return toLabel(updated);
  }

  async deleteLabel(id: string): Promise<void> {
    await this.http.request(`${GMAIL_API}/labels/${enc(id)}`, { method: 'DELETE' });
  }

  private async helperLabelId(kind: HelperKind, create: boolean): Promise<string | undefined> {
    if (this.helperIds[kind]) return this.helperIds[kind];
    const cached = (await this.storage.get<Partial<Record<HelperKind, string>>>(HELPER_LABELS_STORAGE_KEY)) ?? {};
    if (cached[kind]) return (this.helperIds[kind] = cached[kind]);
    const list = await this.http.request<{ labels?: GmailLabel[] }>(`${GMAIL_API}/labels`);
    let id = list.labels?.find((l) => l.name === HELPER_NAMES[kind])?.id;
    if (!id && create) {
      const created = await this.http.request<GmailLabel>(`${GMAIL_API}/labels`, {
        body: { name: HELPER_NAMES[kind], labelListVisibility: 'labelHide', messageListVisibility: 'hide' },
      });
      id = created.id;
    }
    if (id) {
      this.helperIds[kind] = id;
      await this.storage.set(HELPER_LABELS_STORAGE_KEY, { ...cached, [kind]: id });
    }
    return id;
  }

  private async forgetHelper(kind: HelperKind): Promise<void> {
    delete this.helperIds[kind];
    const cached = (await this.storage.get<Partial<Record<HelperKind, string>>>(HELPER_LABELS_STORAGE_KEY)) ?? {};
    delete cached[kind];
    await this.storage.set(HELPER_LABELS_STORAGE_KEY, cached);
  }

  /** If the cached id is stale (label deleted), look it up again once. */
  private async modifyWithHelper(
    kind: HelperKind,
    threadIds: string[],
    build: (labelId: string) => LabelChange,
  ): Promise<void> {
    const id = await this.helperLabelId(kind, true);
    try {
      await this.modifyThreads(threadIds, build(id!));
    } catch (err) {
      if (!(err instanceof BackendError) || err.retryable || err.code === 'unauthenticated') throw err;
      await this.forgetHelper(kind);
      const fresh = await this.helperLabelId(kind, true);
      await this.modifyThreads(threadIds, build(fresh!));
    }
  }

  private async summaryContext(): Promise<SummaryContext> {
    const snoozed = (await this.storage.get<Record<string, number>>(SNOOZE_STORAGE_KEY)) ?? {};
    const cached = (await this.storage.get<Partial<Record<HelperKind, string>>>(HELPER_LABELS_STORAGE_KEY)) ?? {};
    const snoozeId = this.helperIds.snoozed ?? cached.snoozed;
    return { snoozed, labelAliases: snoozeId ? { [snoozeId]: 'SNOOZED' } : undefined };
  }

  /** in:snoozed / is:snoozed / label:snoozed and is:muted become labelIds. Null when the helper label doesn't exist yet (nothing can match). */
  private async rewriteQuery(q: string): Promise<{ q: string; labelIds: string[] } | null> {
    const labelIds: string[] = [];
    let out = q;
    const rules: [RegExp, HelperKind][] = [
      [/(^|\s)(in|is|label):snoozed(?=\s|$)/gi, 'snoozed'],
      [/(^|\s)is:muted(?=\s|$)/gi, 'muted'],
    ];
    for (const [re, kind] of rules) {
      if (!re.test(out)) continue;
      out = out.replace(re, '$1').trim();
      const id = await this.helperLabelId(kind, false);
      if (!id) return null;
      labelIds.push(id);
    }
    return { q: out.replace(/\s+/g, ' ').trim(), labelIds };
  }

  async listThreads(query: ThreadQuery): Promise<ThreadPage> {
    const rewritten = await this.rewriteQuery(query.q ?? '');
    if (!rewritten) return { threads: [], resultSizeEstimate: 0 };
    const list = await this.http.request<GmailThreadList>(`${GMAIL_API}/threads`, {
      query: {
        q: rewritten.q || undefined,
        labelIds: rewritten.labelIds.length ? rewritten.labelIds : undefined,
        pageToken: query.pageToken,
        maxResults: Math.min(Math.max(query.pageSize ?? MAX_PAGE, 1), MAX_PAGE),
      },
    });
    const entries = list.threads ?? [];
    const page: ThreadPage = { threads: [] };
    if (list.nextPageToken) page.nextPageToken = list.nextPageToken;
    if (list.resultSizeEstimate !== undefined) page.resultSizeEstimate = list.resultSizeEstimate;
    if (!entries.length) return page;

    const results = await this.http.batch(entries.map((t) => ({ method: 'GET', path: metadataPath(t.id, LIST_HEADERS) })));
    const ctx = await this.summaryContext();
    let firstError: BackendError | undefined;
    results.forEach((r, i) => {
      if (r.status >= 200 && r.status < 300 && r.body) {
        page.threads.push(toThreadSummary(r.body as GmailThread, { ...ctx, listSnippet: entries[i].snippet }));
      } else if (r.status !== 404) {
        // A thread deleted between list and get is skipped; other failures are only fatal when nothing could be loaded.
        firstError ??= r.status === 0
          ? new BackendError('Batch part missing from response', 'unknown', true)
          : errorFromResponse(r.status, r.body, r.text);
      }
    });
    if (!page.threads.length && firstError) throw firstError;
    return page;
  }

  async getThread(threadId: string): Promise<Thread> {
    const thread = await this.http.request<GmailThread>(`${GMAIL_API}/threads/${enc(threadId)}`, {
      query: { format: 'full' },
    });
    const messages = await Promise.all(
      (thread.messages ?? []).map(async (m) => {
        const parsed = parsePayload(m.payload, m.id);
        for (const a of parsed.attachments) this.attachmentTypes.set(`${m.id}/${a.id}`, a.mimeType);
        cap(this.attachmentTypes, 5000);
        const bodies: { html?: string; text?: string } = {};
        // Very large bodies come back as attachment ids instead of data.
        for (const kind of ['html', 'text'] as const) {
          const ref = parsed[kind];
          if (ref?.attachmentId) {
            const { data } = await this.fetchAttachmentData(m.id, ref.attachmentId);
            bodies[kind] = decodeBytes(base64ToBytes(data), ref.charset);
          }
        }
        return toMessage(m, bodies);
      }),
    );
    return toThread(thread, messages, await this.summaryContext());
  }

  async modifyThreads(threadIds: string[], change: LabelChange): Promise<void> {
    const body = { addLabelIds: change.add ?? [], removeLabelIds: change.remove ?? [] };
    if (!body.addLabelIds.length && !body.removeLabelIds.length) return;
    await this.perThread(threadIds, (id) => ({ method: 'POST', path: `/gmail/v1/users/me/threads/${enc(id)}/modify`, body }));
  }

  async trashThreads(threadIds: string[]): Promise<void> {
    await this.perThread(threadIds, (id) => ({ method: 'POST', path: `/gmail/v1/users/me/threads/${enc(id)}/trash` }));
  }

  async untrashThreads(threadIds: string[]): Promise<void> {
    await this.perThread(threadIds, (id) => ({ method: 'POST', path: `/gmail/v1/users/me/threads/${enc(id)}/untrash` }));
  }

  async deleteThreadsForever(threadIds: string[]): Promise<void> {
    try {
      await this.perThread(threadIds, (id) => ({ method: 'DELETE', path: `/gmail/v1/users/me/threads/${enc(id)}` }));
    } catch (err) {
      if (err instanceof BackendError && err.code === 'unsupported') {
        throw new BackendError(
          'Deleting forever needs the full https://mail.google.com/ scope, which Expressive Gmail does not request. Empty the trash in Gmail instead.',
          'unsupported',
        );
      }
      throw err;
    }
  }

  /** A direct request for a single id, a batch for more. */
  private async perThread(threadIds: string[], item: (id: string) => BatchItem): Promise<void> {
    if (!threadIds.length) return;
    if (threadIds.length === 1) {
      const it = item(threadIds[0]);
      await this.http.request(`${GMAIL_BASE}${it.path}`, { method: it.method, body: it.body ?? (it.method === 'POST' ? {} : undefined) });
      return;
    }
    unwrapBatch(await this.http.batch(threadIds.map(item)));
  }

  async snoozeThreads(threadIds: string[], until: number): Promise<void> {
    if (!threadIds.length) return;
    await this.modifyWithHelper('snoozed', threadIds, (label) => ({ add: [label], remove: ['INBOX'] }));
    const map = (await this.storage.get<Record<string, number>>(SNOOZE_STORAGE_KEY)) ?? {};
    for (const id of threadIds) map[id] = until;
    await this.storage.set(SNOOZE_STORAGE_KEY, map);
  }

  async unsnoozeThreads(threadIds: string[]): Promise<void> {
    if (!threadIds.length) return;
    const label = await this.helperLabelId('snoozed', false);
    await this.modifyThreads(threadIds, { add: ['INBOX'], remove: label ? [label] : [] });
    const map = (await this.storage.get<Record<string, number>>(SNOOZE_STORAGE_KEY)) ?? {};
    for (const id of threadIds) delete map[id];
    await this.storage.set(SNOOZE_STORAGE_KEY, map);
  }

  /** Returns the woken thread ids. */
  async wakeDue(): Promise<string[]> {
    const map = (await this.storage.get<Record<string, number>>(SNOOZE_STORAGE_KEY)) ?? {};
    const now = this.now();
    const due = Object.keys(map).filter((id) => map[id] <= now);
    if (!due.length) return [];
    const label = await this.helperLabelId('snoozed', false);
    const body = { addLabelIds: ['INBOX', 'UNREAD'], removeLabelIds: label ? [label] : [] };
    const results = await this.http.batch(
      due.map((id) => ({ method: 'POST', path: `/gmail/v1/users/me/threads/${enc(id)}/modify`, body })),
    );
    const woken: string[] = [];
    // Read again: a tab may have snoozed something while the batch was out.
    const next = { ...((await this.storage.get<Record<string, number>>(SNOOZE_STORAGE_KEY)) ?? {}) };
    results.forEach((r, i) => {
      const ok = r.status >= 200 && r.status < 300;
      // A thread deleted meanwhile (404) is dropped too, or it would retry forever.
      if ((ok || r.status === 404) && next[due[i]] === map[due[i]]) delete next[due[i]];
      if (ok) woken.push(due[i]);
    });
    await this.storage.set(SNOOZE_STORAGE_KEY, next);
    return woken;
  }

  async muteThreads(threadIds: string[], muted: boolean): Promise<void> {
    if (!threadIds.length) return;
    const list = new Set((await this.storage.get<string[]>(MUTED_STORAGE_KEY)) ?? []);
    if (muted) {
      await this.modifyWithHelper('muted', threadIds, (label) => ({ add: [label], remove: ['INBOX'] }));
      for (const id of threadIds) list.add(id);
    } else {
      const label = await this.helperLabelId('muted', false);
      if (label) await this.modifyThreads(threadIds, { remove: [label] });
      for (const id of threadIds) list.delete(id);
    }
    await this.storage.set(MUTED_STORAGE_KEY, [...list]);
  }

  private async postRaw(
    path: string,
    method: 'POST' | 'PUT',
    raw: string,
    metadata: Record<string, unknown>,
    attachmentBytes: number,
  ): Promise<unknown> {
    if (attachmentBytes <= UPLOAD_THRESHOLD_BYTES) {
      const body = 'message' in metadata
        ? { ...metadata, message: { ...(metadata.message as object), raw: encodeBase64UrlText(raw) } }
        : { ...metadata, raw: encodeBase64UrlText(raw) };
      return this.http.request(`${GMAIL_API}${path}`, { method, body });
    }
    // Media upload: multipart/related with JSON metadata and the message/rfc822 part.
    const boundaryValue = `bg_upload_${Math.random().toString(36).slice(2)}`;
    const rawBody = [
      `--${boundaryValue}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundaryValue}`,
      'Content-Type: message/rfc822',
      '',
      raw,
      `--${boundaryValue}--`,
      '',
    ].join('\r\n');
    return this.http.request(`${GMAIL_BASE}/upload/gmail/v1/users/me${path}`, {
      method,
      rawBody,
      contentType: `multipart/related; boundary=${boundaryValue}`,
      query: { uploadType: 'multipart' },
    });
  }

  private attachmentBytes(message: OutgoingMessage): number {
    return message.attachments.reduce((sum, a) => sum + (a.data ? base64DecodedSize(a.data) : a.size), 0);
  }

  /** Threads list drafts by message id; the drafts API wants the draft's own id. Draft ids start with "r" and message ids are hex. */
  private async draftIdFor(id: string | undefined): Promise<string | undefined> {
    if (!id || !/^[0-9a-f]+$/i.test(id)) return id;
    const list = await this.http.request<{ drafts?: { id: string; message: { id: string } }[] }>(`${GMAIL_API}/drafts`, {
      query: { maxResults: '500' },
    });
    return list.drafts?.find((d) => d.message.id === id)?.id ?? id;
  }

  async send(message: OutgoingMessage): Promise<{ id: string; threadId: string }> {
    message = { ...message, draftId: await this.draftIdFor(message.draftId) };
    if (message.sendAt && message.sendAt > this.now() + 60_000) {
      throw new BackendError('Schedule send is not available with the Gmail API backend.', 'unsupported');
    }
    const raw = buildMime(message);
    const size = this.attachmentBytes(message);
    const thread = message.threadId ? { threadId: message.threadId } : {};
    const sent = message.draftId
      ? await this.postRaw('/drafts/send', 'POST', raw, { id: message.draftId, message: thread }, size)
      : await this.postRaw('/messages/send', 'POST', raw, thread, size);
    const m = sent as GmailMessage;
    return { id: m.id, threadId: m.threadId };
  }

  async saveDraft(message: OutgoingMessage): Promise<Draft> {
    message = { ...message, draftId: await this.draftIdFor(message.draftId) };
    const raw = buildMime(message);
    const size = this.attachmentBytes(message);
    const thread = message.threadId ? { threadId: message.threadId } : {};
    const draft = (message.draftId
      ? await this.postRaw(`/drafts/${enc(message.draftId)}`, 'PUT', raw, { id: message.draftId, message: thread }, size)
      : await this.postRaw('/drafts', 'POST', raw, { message: thread }, size)) as GmailDraft;
    const full = await this.http.request<GmailMessage>(`${GMAIL_API}/messages/${enc(draft.message.id)}`, {
      query: { format: 'full' },
    });
    return { id: draft.id, message: toMessage(full) };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const id = (await this.draftIdFor(draftId)) ?? draftId;
    await this.http.request(`${GMAIL_API}/drafts/${enc(id)}`, { method: 'DELETE' });
  }

  async getRawMessage(messageId: string): Promise<string> {
    const m = await this.http.request<{ raw?: string }>(`${GMAIL_API}/messages/${enc(messageId)}`, { query: { format: 'raw' } });
    if (!m.raw) throw new BackendError('Gmail sent no source for this message', 'not-found');
    return decodeBytes(base64ToBytes(m.raw));
  }

  private async fetchAttachmentData(messageId: string, attachmentId: string): Promise<{ data: string }> {
    const res = await this.http.request<{ data?: string; size?: number }>(
      `${GMAIL_API}/messages/${enc(messageId)}/attachments/${enc(attachmentId)}`,
    );
    return { data: res.data ?? '' };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; mimeType: string }> {
    if (attachmentId.startsWith('part:')) {
      // Tiny parts carry their data inline and have no attachment id.
      const msg = await this.http.request<GmailMessage>(`${GMAIL_API}/messages/${enc(messageId)}`, { query: { format: 'full' } });
      const part = findPart(msg.payload, attachmentId.slice(5));
      if (!part?.body?.data) throw new BackendError('Attachment not found', 'not-found');
      return { data: base64UrlToBase64(part.body.data), mimeType: part.mimeType || 'application/octet-stream' };
    }
    const { data } = await this.fetchAttachmentData(messageId, attachmentId);
    return {
      data: base64UrlToBase64(data),
      mimeType: this.attachmentTypes.get(`${messageId}/${attachmentId}`) ?? 'application/octet-stream',
    };
  }

  async listFilters(): Promise<Filter[]> {
    const res = await this.http.request<{ filter?: GmailFilter[] }>(`${GMAIL_API}/settings/filters`);
    return (res?.filter ?? []).map((f) => ({ id: f.id, criteria: { ...f.criteria }, action: { ...f.action } }));
  }

  async createFilter(filter: Omit<Filter, 'id'>): Promise<Filter> {
    const created = await this.http.request<GmailFilter>(`${GMAIL_API}/settings/filters`, {
      body: { criteria: filter.criteria, action: filter.action },
    });
    return { id: created.id, criteria: { ...created.criteria }, action: { ...created.action } };
  }

  async deleteFilter(id: string): Promise<void> {
    await this.http.request(`${GMAIL_API}/settings/filters/${enc(id)}`, { method: 'DELETE' });
  }

  searchContacts(prefix: string): Promise<Contact[]> {
    return this.contacts.search(prefix);
  }

  lookupPhotos(emails: string[]): Promise<Record<string, string>> {
    return this.contacts.photos(emails);
  }

  async pollChanges(): Promise<MailChange[]> {
    if (!this.historyId) {
      this.historyId = (await this.http.request<GmailProfile>(`${GMAIL_API}/profile`)).historyId;
      return [];
    }
    const threadIds = new Set<string>();
    const inboxAdds: { threadId: string }[] = [];
    let pageToken: string | undefined;
    let latest = this.historyId;
    try {
      do {
        const res: GmailHistoryList = await this.http.request<GmailHistoryList>(`${GMAIL_API}/history`, {
          query: { startHistoryId: this.historyId, pageToken, maxResults: 500 },
        });
        for (const record of res.history ?? []) {
          for (const m of record.messages ?? []) threadIds.add(m.threadId);
          for (const a of record.messagesAdded ?? []) {
            threadIds.add(a.message.threadId);
            if ((a.message.labelIds ?? []).includes('INBOX')) inboxAdds.push({ threadId: a.message.threadId });
          }
          for (const d of record.messagesDeleted ?? []) threadIds.add(d.message.threadId);
          for (const l of record.labelsAdded ?? []) threadIds.add(l.message.threadId);
          for (const l of record.labelsRemoved ?? []) threadIds.add(l.message.threadId);
        }
        if (res.historyId) latest = res.historyId;
        pageToken = res.nextPageToken;
      } while (pageToken);
    } catch (err) {
      if (err instanceof BackendError && err.code === 'not-found') {
        // startHistoryId is too old (history is kept for about a week): resync.
        this.historyId = (await this.http.request<GmailProfile>(`${GMAIL_API}/profile`)).historyId;
        return [{ type: 'all' }];
      }
      throw err;
    }
    this.historyId = latest;
    if (!threadIds.size) return [];

    // Emulated mute: a new reply put a muted thread back in the inbox.
    const muted = new Set((await this.storage.get<string[]>(MUTED_STORAGE_KEY)) ?? []);
    const rearchive = [...new Set(inboxAdds.map((a) => a.threadId).filter((id) => muted.has(id)))];
    if (rearchive.length) await this.modifyThreads(rearchive, { remove: ['INBOX'] }).catch(() => undefined);

    return [{ type: 'threads', threadIds: [...threadIds] }, { type: 'labels' }];
  }

  private async postOneClick(url: string): Promise<void> {
    if (this.postOneClickImpl) return this.postOneClickImpl(url);
    await this.fetchImpl(url, {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
  }

  async unsubscribe(messageId: string): Promise<'one-click' | 'mailto' | 'link'> {
    const msg = await this.http.request<GmailMessage>(`${GMAIL_API}/messages/${enc(messageId)}`, {
      query: { format: 'metadata', metadataHeaders: ['List-Unsubscribe', 'List-Unsubscribe-Post'] },
    });
    const headers = msg.payload?.headers;
    const targets = parseListUnsubscribe(header(headers, 'List-Unsubscribe'));
    const post = header(headers, 'List-Unsubscribe-Post') ?? '';
    if (targets.https && /List-Unsubscribe\s*=\s*One-Click/i.test(post)) {
      try {
        await this.postOneClick(targets.https);
        return 'one-click';
      } catch {
        // Fall through to mailto or the link.
      }
    }
    if (targets.mailto) {
      const mail = parseMailto(targets.mailto);
      if (mail.to.length) {
        await this.send({
          to: mail.to.flatMap((t) => parseAddressList(t)),
          cc: [],
          bcc: [],
          subject: mail.subject || 'unsubscribe',
          html: escapeHtml(mail.body || 'unsubscribe'),
          attachments: [],
        });
        return 'mailto';
      }
    }
    return 'link';
  }
}

export function createApiBackend(getToken: TokenProvider, options: ApiBackendOptions = {}): MailBackend {
  return new GmailApiBackend(getToken, options);
}

/** Called by the background's SNOOZE_ALARM. Puts INBOX and UNREAD back on threads whose emulated snooze is due. */
export async function wakeSnoozed(getToken: TokenProvider, options: ApiBackendOptions = {}): Promise<string[]> {
  const storage = options.storage ?? browserLocalStore();
  const map = (await storage.get<Record<string, number>>(SNOOZE_STORAGE_KEY)) ?? {};
  const now = (options.now ?? Date.now)();
  // Skip the token request when nothing is due.
  if (!Object.values(map).some((t) => t <= now)) return [];
  return new GmailApiBackend(getToken, { ...options, storage }).wakeDue();
}

export const SNOOZE_ALARM = 'bg.api.wakeSnoozed';
