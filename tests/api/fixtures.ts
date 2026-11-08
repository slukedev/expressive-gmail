/**
 * Gmail API JSON shaped like the responses in the official reference
 * (users.threads.get, users.messages.get, users.history.list, batch guide).
 * Bodies are real base64url of the text shown next to them.
 */
import type { GmailMessagePart, GmailThread } from '../../src/app/data/api/gmail-types';

export const b64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const h = (name: string, value: string) => ({ name, value });

export function metadataThread(): GmailThread {
  return {
    id: '18f2a0c1d2e3f4a5',
    historyId: '9081723',
    messages: [
      {
        id: '18f2a0c1d2e3f4a5',
        threadId: '18f2a0c1d2e3f4a5',
        labelIds: ['IMPORTANT', 'CATEGORY_PERSONAL', 'INBOX'],
        snippet: 'Hi Sam, here&#39;s the agenda for Thursday &amp; the notes',
        historyId: '9081500',
        internalDate: '1727780000000',
        sizeEstimate: 48211,
        payload: {
          partId: '',
          mimeType: 'multipart/mixed',
          filename: '',
          headers: [
            h('From', '"Doe, Jane" <jane@example.com>'),
            h('To', 'Sam <sam@example.org>'),
            h('Subject', 'Q4 planning'),
            h('Date', 'Tue, 1 Oct 2024 10:53:20 +0000'),
          ],
          body: { size: 0 },
        },
      },
      {
        id: '18f2a0c9aa000001',
        threadId: '18f2a0c1d2e3f4a5',
        labelIds: ['SENT'],
        snippet: 'Thanks, looks good',
        internalDate: '1727790000000',
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            h('From', 'Sam <sam@example.org>'),
            h('To', '"Doe, Jane" <jane@example.com>'),
            h('Subject', 'Re: Q4 planning'),
          ],
          body: { size: 0 },
        },
      },
      {
        id: '18f2a0c9aa000002',
        threadId: '18f2a0c1d2e3f4a5',
        labelIds: ['UNREAD', 'INBOX', 'CATEGORY_PERSONAL'],
        snippet: 'One more thing: the venue moved',
        internalDate: '1727800000000',
        payload: {
          mimeType: 'text/plain',
          headers: [
            h('From', 'jane@example.com'),
            h('To', 'sam@example.org'),
            h('Subject', 'Re: Q4 planning'),
          ],
          body: { size: 31 },
        },
      },
      {
        id: '18f2a0c9aa000003',
        threadId: '18f2a0c1d2e3f4a5',
        labelIds: ['DRAFT'],
        snippet: 'Draft reply',
        internalDate: '1727810000000',
        payload: {
          mimeType: 'text/plain',
          headers: [h('From', 'Sam <sam@example.org>'), h('Subject', 'Re: Q4 planning')],
          body: { size: 11 },
        },
      },
    ],
  };
}

/**
 * A newsletter-style message as format=full returns it:
 * multipart/mixed
 *   multipart/related
 *     multipart/alternative
 *       text/plain (UTF-8 with emoji and CJK)
 *       text/html
 *     image/png inline, Content-ID <logo@bg>
 *   application/pdf attachment (attachmentId)
 *   text/plain attachment "notes.txt" (must not become the body)
 *   message/rfc822 forwarded mail with its own text part
 */
export const FULL_TEXT = 'Hello 👋 世界, the report is attached.\nSee you Thursday.';
export const FULL_HTML = '<p>Hello 👋 <b>世界</b>, the report is attached.</p><img src="cid:logo@bg">';

export function fullPayload(): GmailMessagePart {
  return {
    partId: '',
    mimeType: 'multipart/mixed',
    filename: '',
    headers: [
      h('From', '"Müller, Jürgen" <jm@example.de>'),
      h('To', 'Sam <sam@example.org>, "Team: Core" <core@example.org>'),
      h('Cc', 'undisclosed-recipients:;'),
      h('Reply-To', 'Jürgen Müller <reply@example.de>'),
      h('Subject', 'Quarterly report 📈'),
      h('Message-Id', '<CAF=abc123@mail.gmail.com>'),
      h('In-Reply-To', '<prev@mail.gmail.com>'),
      h('References', '<root@mail.gmail.com> <prev@mail.gmail.com>'),
      h('List-Unsubscribe', '<mailto:unsub@example.de?subject=stop>, <https://example.de/u/123>'),
      h('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'),
      h('List-ID', 'Reports <reports.example.de>'),
      h('Content-Type', 'multipart/mixed; boundary="000000000000a1"'),
    ],
    body: { size: 0 },
    parts: [
      {
        partId: '0',
        mimeType: 'multipart/related',
        filename: '',
        headers: [h('Content-Type', 'multipart/related; boundary="000000000000a2"')],
        body: { size: 0 },
        parts: [
          {
            partId: '0.0',
            mimeType: 'multipart/alternative',
            filename: '',
            headers: [h('Content-Type', 'multipart/alternative; boundary="000000000000a3"')],
            body: { size: 0 },
            parts: [
              {
                partId: '0.0.0',
                mimeType: 'text/plain',
                filename: '',
                headers: [h('Content-Type', 'text/plain; charset="UTF-8"'), h('Content-Transfer-Encoding', 'quoted-printable')],
                body: { size: 60, data: b64url(FULL_TEXT) },
              },
              {
                partId: '0.0.1',
                mimeType: 'text/html',
                filename: '',
                headers: [h('Content-Type', 'text/html; charset="UTF-8"')],
                body: { size: 90, data: b64url(FULL_HTML) },
              },
            ],
          },
          {
            partId: '0.1',
            mimeType: 'image/png',
            filename: 'logo.png',
            headers: [
              h('Content-Type', 'image/png; name="logo.png"'),
              h('Content-Disposition', 'inline; filename="logo.png"'),
              h('Content-ID', '<logo@bg>'),
              h('X-Attachment-Id', 'logo@bg'),
            ],
            body: { attachmentId: 'ANGjdJ_logo', size: 2048 },
          },
        ],
      },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'Q4 report.pdf',
        headers: [
          h('Content-Type', 'application/pdf; name="Q4 report.pdf"'),
          h('Content-Disposition', 'attachment; filename="Q4 report.pdf"'),
        ],
        body: { attachmentId: 'ANGjdJ_pdf', size: 183424 },
      },
      {
        partId: '2',
        mimeType: 'text/plain',
        filename: 'notes.txt',
        headers: [h('Content-Type', 'text/plain; charset=UTF-8; name="notes.txt"'), h('Content-Disposition', 'attachment; filename="notes.txt"')],
        body: { attachmentId: 'ANGjdJ_notes', size: 12 },
      },
      {
        partId: '3',
        mimeType: 'message/rfc822',
        filename: '',
        headers: [h('Content-Type', 'message/rfc822')],
        body: { attachmentId: 'ANGjdJ_fwd', size: 900 },
        parts: [
          {
            partId: '3.0',
            mimeType: 'text/plain',
            filename: '',
            headers: [h('Content-Type', 'text/plain; charset=UTF-8')],
            body: { size: 20, data: b64url('forwarded body text') },
          },
        ],
      },
    ],
  };
}

export function fullThread(): GmailThread {
  return {
    id: '18f2b000000000aa',
    historyId: '9082000',
    messages: [
      {
        id: '18f2b000000000aa',
        threadId: '18f2b000000000aa',
        labelIds: ['INBOX', 'UNREAD', 'Label_42'],
        snippet: 'Hello 👋 世界, the report is attached.',
        internalDate: '1727900000000',
        payload: fullPayload(),
      },
    ],
  };
}

/** Builds a multipart/mixed batch response in the shape of the batch guide's example. */
export function batchResponse(
  boundary: string,
  parts: { contentId: string; status: string; body: unknown }[],
  eol = '\r\n',
): string {
  const out: string[] = [];
  for (const p of parts) {
    out.push(
      `--${boundary}`,
      'Content-Type: application/http',
      `Content-ID: <${p.contentId}>`,
      '',
      `HTTP/1.1 ${p.status}`,
      'Content-Type: application/json; charset=UTF-8',
      'Vary: Origin',
      'Vary: X-Origin',
      '',
      typeof p.body === 'string' ? p.body : JSON.stringify(p.body, null, 1),
    );
  }
  out.push(`--${boundary}--`, '');
  return out.join(eol);
}

export const NOT_FOUND = {
  error: { code: 404, message: 'Requested entity was not found.', errors: [{ message: 'Requested entity was not found.', domain: 'global', reason: 'notFound' }], status: 'NOT_FOUND' },
};

export const RATE_LIMITED = {
  error: {
    code: 429,
    message: 'User-rate limit exceeded.  Retry after 2024-10-01T11:00:00.000Z',
    errors: [{ message: 'User-rate limit exceeded.', domain: 'usageLimits', reason: 'rateLimitExceeded' }],
    status: 'RESOURCE_EXHAUSTED',
  },
};

export const SCOPE_INSUFFICIENT = {
  error: {
    code: 403,
    message: 'Request had insufficient authentication scopes.',
    status: 'PERMISSION_DENIED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
        domain: 'googleapis.com',
      },
    ],
  },
};
