/** Shared by every backend. Label ids follow the Gmail API, so system labels mean the same thing everywhere. */

export type SystemLabelId =
  | 'INBOX'
  | 'STARRED'
  | 'UNREAD'
  | 'IMPORTANT'
  | 'SENT'
  | 'DRAFT'
  | 'SPAM'
  | 'TRASH'
  | 'SNOOZED'
  | 'SCHEDULED'
  | 'CHAT'
  | 'CATEGORY_PERSONAL'
  | 'CATEGORY_SOCIAL'
  | 'CATEGORY_PROMOTIONS'
  | 'CATEGORY_UPDATES'
  | 'CATEGORY_FORUMS';

export type LabelId = SystemLabelId | (string & {});

export interface LabelColor {
  /** Hex. */
  background: string;
  /** Hex. */
  text: string;
}

export interface Label {
  id: LabelId;
  /** Nested labels use "/" as in Gmail ("Work/Projects"). */
  name: string;
  type: 'system' | 'user';
  color?: LabelColor;
  /** Threads with UNREAD in this label. */
  unreadCount?: number;
  /** Total threads in this label, when the backend knows it. */
  totalCount?: number;
  /** Gmail's "Show in label list: hide". */
  hidden?: boolean;
}

export interface Address {
  name?: string;
  email: string;
}

export interface Attachment {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  /** For inline images referenced by Content-ID. */
  contentId?: string;
  inline?: boolean;
  /** Shown directly (thumbnails, demo data). */
  previewUrl?: string;
}

export interface Message {
  id: string;
  threadId: string;
  labelIds: LabelId[];
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo?: Address[];
  /** Epoch ms. */
  date: number;
  subject: string;
  snippet: string;
  /** Sanitized by the renderer; backends pass raw HTML through. */
  bodyHtml?: string;
  bodyText?: string;
  attachments: Attachment[];
  headers: {
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    listUnsubscribe?: string;
    listUnsubscribePost?: string;
    listId?: string;
    /** Which of the sender's verified-logo records to read. */
    bimiSelector?: string;
  };
  isDraft?: boolean;
}

/** No bodies, just enough to draw a row. */
export interface ThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  labelIds: LabelId[];
  /** Deduplicated, newest last. */
  participants: Address[];
  /** So Sent can show "To: Ana". */
  recipients?: Address[];
  messageCount: number;
  draftCount: number;
  /** Epoch ms. */
  lastDate: number;
  hasAttachments: boolean;
  /** First few, for the chips under a row. */
  attachments: (Pick<Attachment, 'id' | 'filename' | 'mimeType' | 'messageId' | 'previewUrl'> & { size?: number })[];
  /** Epoch ms. */
  snoozedUntil?: number;
  /** Epoch ms. */
  scheduledFor?: number;
  /** As Gmail's size search measures them. */
  size?: number;
}

export interface Thread extends ThreadSummary {
  messages: Message[];
}

export interface ThreadQuery {
  /** Folder views are queries too ("in:inbox category:primary"). */
  q: string;
  pageToken?: string;
  pageSize?: number;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextPageToken?: string;
  /** Total result estimate, when known. */
  resultSizeEstimate?: number;
  /** Gmail stopped counting: at least `resultSizeEstimate`. */
  resultSizeAtLeast?: boolean;
  /** Merged scopes: accounts whose mail couldn't be read for this page. */
  unavailable?: { email: string; message: string }[];
}

export interface Account {
  email: string;
  name: string;
  photoUrl?: string;
  /** Gmail's /u/N index. */
  index: number;
  sendAs?: Address[];
  signature?: string;
  /** Every account in a merged scope (All inboxes or a circle); the top-level fields describe the first. */
  members?: AccountMember[];
}

interface AccountMember extends Pick<Account, 'email' | 'name' | 'photoUrl' | 'index' | 'sendAs' | 'signature'> {
  /** Prefix of this account's ids in the merged scope. */
  key: string;
}

export interface OutgoingMessage {
  /** Set when saving over an existing draft. */
  draftId?: string;
  threadId?: string;
  from?: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  /** Message-ID headers for threading replies. */
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
  /** Epoch ms. Only honored when the backend can schedule. */
  sendAt?: number;
}

export interface OutgoingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Base64 (not url-safe). */
  data: string;
}

export interface Draft {
  id: string;
  message: Message;
}

export interface LabelChange {
  add?: LabelId[];
  remove?: LabelId[];
}

export interface Contact {
  name?: string;
  email: string;
  photoUrl?: string;
}

/** The UI hides or explains what's missing. */
export interface BackendCapabilities {
  send: boolean;
  drafts: boolean;
  snooze: boolean;
  /** Google's servers send it. Off where only the browser could. */
  scheduleSend: boolean;
  mute: boolean;
  labelsEdit: boolean;
  filters: boolean;
  contacts: boolean;
  attachments: boolean;
  /** Session mode can't; Gmail's own page has to. */
  deleteForever: boolean;
  /** Can return a cheap "something changed" signal for polling. */
  changes: boolean;
  /** Thread data leaves out List-* headers; read them per message with listHeaders(). */
  listHeadersOnDemand?: boolean;
}

export type MailChange =
  | { type: 'threads'; threadIds: string[] }
  | { type: 'labels' }
  | { type: 'all' };

export interface Filter {
  id: string;
  criteria: {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
    negatedQuery?: string;
    hasAttachment?: boolean;
  };
  action: {
    addLabelIds?: LabelId[];
    removeLabelIds?: LabelId[];
    forward?: string;
  };
}
