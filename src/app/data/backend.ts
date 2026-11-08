import type {
  Account,
  BackendCapabilities,
  Contact,
  Draft,
  Filter,
  Label,
  LabelChange,
  MailChange,
  Message,
  OutgoingMessage,
  Thread,
  ThreadPage,
  ThreadQuery,
} from './types';
import type { GeminiProgress, GeminiRequest, GeminiResult, GeminiStatus } from './gemini';

export type BackendKind = 'demo' | 'session' | 'api';

/** Every mail source implements this. Plain JSON in and out, so the session backend can live in the content script behind a port. */
export interface MailBackend {
  readonly kind: BackendKind;
  readonly capabilities: BackendCapabilities;

  getAccount(): Promise<Account>;
  listLabels(): Promise<Label[]>;
  listThreads(query: ThreadQuery): Promise<ThreadPage>;
  getThread(threadId: string): Promise<Thread>;

  modifyThreads(threadIds: string[], change: LabelChange): Promise<void>;
  trashThreads(threadIds: string[]): Promise<void>;
  untrashThreads(threadIds: string[]): Promise<void>;
  deleteThreadsForever(threadIds: string[]): Promise<void>;
  /** Beyond the pages the list has loaded. Resolves with the count when known. */
  emptyFolder?(folder: 'trash' | 'spam'): Promise<number | void>;

  /** `until` is epoch ms. */
  snoozeThreads(threadIds: string[], until: number): Promise<void>;
  unsnoozeThreads(threadIds: string[]): Promise<void>;
  muteThreads(threadIds: string[], muted: boolean): Promise<void>;

  send(message: OutgoingMessage): Promise<{ id: string; threadId: string }>;
  saveDraft(message: OutgoingMessage): Promise<Draft>;
  /** `threadId` helps backends that find drafts by their conversation (the session backend). */
  deleteDraft(draftId: string, threadId?: string): Promise<void>;
  /** Gmail's Cancel send: the scheduled message goes back to Drafts. */
  cancelScheduled?(threadId: string): Promise<void>;

  /** For Show original and Forward as attachment. */
  getRawMessage?(messageId: string): Promise<string>;

  /** Base64 (not url-safe). */
  getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; mimeType: string }>;
  /** Base64, or undefined when the source has none. */
  getThumbnail?(messageId: string, attachmentId: string): Promise<{ data: string; mimeType: string } | undefined>;

  createLabel(label: Pick<Label, 'name' | 'color'>): Promise<Label>;
  updateLabel(id: string, patch: Partial<Pick<Label, 'name' | 'color' | 'hidden'>>): Promise<Label>;
  deleteLabel(id: string): Promise<void>;

  listFilters?(): Promise<Filter[]>;
  createFilter?(filter: Omit<Filter, 'id'>): Promise<Filter>;
  deleteFilter?(id: string): Promise<void>;

  searchContacts(prefix: string): Promise<Contact[]>;
  /** Keyed by the lowercased address. Addresses with no known photo are left out; callers remember those as misses. */
  lookupPhotos?(emails: string[]): Promise<Record<string, string>>;

  /** The signed-in address before mail can be read (session mode learns it from Gmail's page well before its first sync), to pick that account's cached inbox. */
  accountHint?(): Promise<string | undefined>;

  /** Pushes changes the UI can't cheaply poll for. */
  subscribe?(listener: (event: BackendEvent) => void): () => void;

  /** What changed since the last call, or []. Backends without cheap change detection resolve with [{ type: 'all' }]. */
  pollChanges(): Promise<MailChange[]>;

  /** For when thread data leaves them out. */
  listHeaders?(messageId: string): Promise<Partial<Message['headers']>>;
  /** RFC 8058 one-click unsubscribe or mailto. */
  unsubscribe?(messageId: string): Promise<'one-click' | 'mailto' | 'link'>;

  /** Sources without Gemini leave this out. */
  geminiStatus?(): Promise<GeminiStatus>;
  /** Streams through `subscribe` as `gemini` events carrying `requestId`. */
  gemini?(request: GeminiRequest, requestId: string): Promise<GeminiResult>;
  /** It rejects with 'unknown' "Stopped". */
  cancelGemini?(requestId: string): Promise<void>;
}

/** `account`: the name or photo changed; read them again. */
export type BackendEvent = { type: 'account' } | GeminiProgress;

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unauthenticated'
      | 'not-found'
      | 'rate-limited'
      | 'unsupported'
      | 'network'
      | 'session-unavailable'
      | 'unknown',
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}
