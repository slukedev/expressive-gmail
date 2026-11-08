/** The Gmail API v1 and People API v1 JSON this backend reads. Only fields we use; optional wherever the API may omit them. */

export interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePartBody {
  attachmentId?: string;
  size?: number;
  /** Base64url, present for small parts and text bodies. */
  data?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** Epoch ms as a decimal string. */
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
  raw?: string;
}

export interface GmailThread {
  id: string;
  snippet?: string;
  historyId?: string;
  messages?: GmailMessage[];
}

export interface GmailThreadList {
  threads?: { id: string; snippet?: string; historyId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailLabelColor {
  backgroundColor?: string;
  textColor?: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  color?: GmailLabelColor;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

interface GmailHistoryRecord {
  id: string;
  messages?: { id: string; threadId: string }[];
  messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: { message: { id: string; threadId: string; labelIds?: string[] }; labelIds: string[] }[];
  labelsRemoved?: { message: { id: string; threadId: string; labelIds?: string[] }; labelIds: string[] }[];
}

export interface GmailHistoryList {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId: string;
}

export interface GmailSendAs {
  sendAsEmail: string;
  displayName?: string;
  signature?: string;
  isDefault?: boolean;
  isPrimary?: boolean;
  verificationStatus?: string;
}

export interface GmailFilter {
  id: string;
  criteria?: {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
    negatedQuery?: string;
    hasAttachment?: boolean;
  };
  action?: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
    forward?: string;
  };
}

export interface GmailDraft {
  id: string;
  message: GmailMessage;
}

export interface GmailErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: { domain?: string; reason?: string; message?: string }[];
    details?: { '@type'?: string; reason?: string }[];
  };
}

export interface PeoplePerson {
  resourceName?: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  photos?: { url?: string; default?: boolean }[];
}

export interface PeopleSearchResponse {
  results?: { person?: PeoplePerson }[];
}
