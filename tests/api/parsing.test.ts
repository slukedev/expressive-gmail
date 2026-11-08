import { describe, expect, it } from 'vitest';
import { parseAddressList, formatAddress } from '../../src/app/data/api/address';
import { base64ToBytes, base64UrlToBase64, decodeBase64UrlText } from '../../src/app/data/api/base64';
import { parseBatchResponse } from '../../src/app/data/api/batch';
import { decodeWords, encodeWords } from '../../src/app/data/api/encoded-words';
import { htmlToText } from '../../src/app/data/api/html-text';
import { parseHeaderParams, parsePayload, toMessage } from '../../src/app/data/api/payload';
import { toThreadSummary } from '../../src/app/data/api/threads';
import { batchResponse, b64url, FULL_HTML, FULL_TEXT, fullPayload, metadataThread, NOT_FOUND } from './fixtures';

describe('base64url bodies', () => {
  it('decodes UTF-8 with emoji and CJK when padding is stripped and url-safe chars are used', () => {
    const text = 'Re: 会議 🗓️ · “quoted” ✓?>';
    const data = b64url(text);
    expect(data).not.toContain('=');
    expect(decodeBase64UrlText(data)).toBe(text);
  });

  it('decodes the url-safe alphabet: bytes that produce "-" and "_"', () => {
    // 0xfb 0xff 0xbf encodes to "-_-_" in base64url and "+/+/" in standard base64.
    expect(Array.from(base64ToBytes('-_-_'))).toEqual([0xfb, 0xff, 0xbf]);
    expect(base64UrlToBase64('-_-_')).toBe('+/+/');
  });

  it('ignores line breaks inside the data and restores padding for standard base64 output', () => {
    expect(base64UrlToBase64('SGVs\r\nbG8')).toBe('SGVsbG8=');
  });

  it('decodes using the charset of the part instead of assuming UTF-8', () => {
    // "café" in ISO-8859-1 is 63 61 66 e9.
    const latin1 = btoa('caf\xe9').replace(/=+$/, '');
    expect(decodeBase64UrlText(latin1, 'ISO-8859-1')).toBe('café');
    expect(decodeBase64UrlText(latin1, 'x-made-up-charset')).toBe('caf�');
  });

  it('turns invalid UTF-8 into replacement characters rather than throwing', () => {
    const broken = btoa('ok \xf0\x9f').replace(/=+$/, '');
    expect(decodeBase64UrlText(broken)).toBe('ok �');
  });
});

describe('address lists', () => {
  it('keeps commas inside quoted names and unescapes quotes', () => {
    expect(parseAddressList('"Doe, Jane" <jane@x.com>, "Bob \\"BJ\\" Lee" <bob@y.com>')).toEqual([
      { name: 'Doe, Jane', email: 'jane@x.com' },
      { name: 'Bob "BJ" Lee', email: 'bob@y.com' },
    ]);
  });

  it('flattens groups and drops empty groups', () => {
    expect(parseAddressList('Team: a@x.com, Ann <b@y.com>;, undisclosed-recipients:;, c@z.com')).toEqual([
      { email: 'a@x.com' },
      { name: 'Ann', email: 'b@y.com' },
      { email: 'c@z.com' },
    ]);
  });

  it('handles bare addresses, bracket-only addresses, comments and empty entries', () => {
    expect(parseAddressList(' <solo@x.com> ,, plain@x.com (Old Style Name),')).toEqual([
      { email: 'solo@x.com' },
      { name: 'Old Style Name', email: 'plain@x.com' },
    ]);
  });

  it('reunites an unquoted decoded name split by a comma', () => {
    // What a decoded =?UTF-8?Q?M=C3=BCller,_J=C3=BCrgen?= <jm@x.de> looks like.
    expect(parseAddressList('Müller, Jürgen <jm@x.de>, ann@y.com')).toEqual([
      { name: 'Müller, Jürgen', email: 'jm@x.de' },
      { email: 'ann@y.com' },
    ]);
  });

  it('does not treat a colon in a name as a group when there is no group terminator', () => {
    expect(parseAddressList('Re: Support <help@x.com>')).toEqual([{ name: 'Re: Support', email: 'help@x.com' }]);
  });

  it('survives an unclosed angle bracket and drops a name that repeats the address', () => {
    expect(parseAddressList('"a@x.com" <a@x.com>, Broken <b@y.com')).toEqual([
      { email: 'a@x.com' },
      { name: 'Broken', email: 'b@y.com' },
    ]);
  });

  it('formats names that need quoting or encoding so they parse back to the same address', () => {
    const tricky = [
      { name: 'Doe, Jane', email: 'jane@x.com' },
      { name: 'Ann "the" Admin', email: 'ann@x.com' },
      { name: 'Zoë 田中', email: 'zoe@x.jp' },
    ];
    for (const a of tricky) {
      const formatted = formatAddress(a);
      expect(formatted).toMatch(/^[\x20-\x7e]+$/);
      expect(parseAddressList(decodeWords(formatted))).toEqual([a]);
    }
  });
});

describe('RFC 2047 encoded words', () => {
  it('leaves ASCII alone and splits long non-ASCII text into words of at most 75 chars', () => {
    expect(encodeWords('Plain subject')).toBe('Plain subject');
    const long = '日本語の件名がとても長い場合でも正しく分割されることを確認する 🚀🚀🚀 テスト';
    const encoded = encodeWords(long);
    const words = encoded.split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      // Each word decodes on its own, so no UTF-8 sequence was cut in half.
      expect(decodeWords(w)).not.toContain('�');
    }
    expect(decodeWords(encoded)).toBe(long);
  });

  it('decodes Q encoding and keeps spaces between an encoded word and plain text', () => {
    expect(decodeWords('=?iso-8859-1?Q?caf=E9_cr=E8me?= and =?UTF-8?B?8J+Ngg==?= =?UTF-8?B?8J+NnA==?=')).toBe('café crème and 🍂🍜');
  });
});

describe('header parameters', () => {
  it('reads quoted params with semicolons and RFC 2231 continuations with a charset', () => {
    const parsed = parseHeaderParams(
      `attachment; filename*0*=UTF-8''%E6%97%A5%E6%9C%AC; filename*1*=%E8%AA%9E.pdf; note="a;b"`,
    );
    expect(parsed.value).toBe('attachment');
    expect(parsed.params.filename).toBe('日本語.pdf');
    expect(parsed.params.note).toBe('a;b');
  });
});

describe('Gmail payload parsing', () => {
  const parsed = parsePayload(fullPayload(), 'm1');

  it('finds text and html inside mixed > related > alternative', () => {
    expect(parsed.text?.text).toBe(FULL_TEXT);
    expect(parsed.html?.text).toBe(FULL_HTML);
  });

  it('collects files, marks the cid image inline, and does not mistake notes.txt or the forward for the body', () => {
    expect(parsed.attachments.map((a) => [a.filename, a.mimeType, a.id, a.inline ?? false, a.contentId])).toEqual([
      ['logo.png', 'image/png', 'ANGjdJ_logo', true, 'logo@bg'],
      ['Q4 report.pdf', 'application/pdf', 'ANGjdJ_pdf', false, undefined],
      ['notes.txt', 'text/plain', 'ANGjdJ_notes', false, undefined],
      ['message.eml', 'message/rfc822', 'ANGjdJ_fwd', false, undefined],
    ]);
  });

  it('reports a body that only has an attachmentId so it can be fetched', () => {
    const payload = {
      mimeType: 'text/html',
      headers: [{ name: 'Content-Type', value: 'text/html; charset=windows-1252' }],
      body: { attachmentId: 'BIG', size: 9_000_000 },
    };
    expect(parsePayload(payload, 'm').html).toEqual({ attachmentId: 'BIG', charset: 'windows-1252' });
  });

  it('builds a Message with parsed addresses and threading headers', () => {
    const msg = toMessage({ id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: '1727900000000', payload: fullPayload() });
    expect(msg.from).toEqual({ name: 'Müller, Jürgen', email: 'jm@example.de' });
    expect(msg.to).toEqual([
      { name: 'Sam', email: 'sam@example.org' },
      { name: 'Team: Core', email: 'core@example.org' },
    ]);
    expect(msg.cc).toEqual([]);
    expect(msg.replyTo).toEqual([{ name: 'Jürgen Müller', email: 'reply@example.de' }]);
    expect(msg.headers).toEqual({
      messageId: '<CAF=abc123@mail.gmail.com>',
      inReplyTo: '<prev@mail.gmail.com>',
      references: '<root@mail.gmail.com> <prev@mail.gmail.com>',
      listUnsubscribe: '<mailto:unsub@example.de?subject=stop>, <https://example.de/u/123>',
      listUnsubscribePost: 'List-Unsubscribe=One-Click',
      listId: 'Reports <reports.example.de>',
    });
    expect(msg.date).toBe(1727900000000);
  });
});

describe('thread summaries from metadata', () => {
  it('dedupes senders, separates drafts, decodes the snippet and uses the newest real message', () => {
    const s = toThreadSummary(metadataThread());
    expect(s.participants).toEqual([
      { name: 'Doe, Jane', email: 'jane@example.com' },
      { name: 'Sam', email: 'sam@example.org' },
    ]);
    expect(s.messageCount).toBe(3);
    expect(s.draftCount).toBe(1);
    expect(s.lastDate).toBe(1727800000000);
    expect(s.subject).toBe('Q4 planning');
    expect(s.snippet).toBe('One more thing: the venue moved');
    expect(new Set(s.labelIds)).toEqual(new Set(['IMPORTANT', 'CATEGORY_PERSONAL', 'INBOX', 'SENT', 'UNREAD', 'DRAFT']));
    // Metadata has no parts; the multipart/mixed root is the attachment hint.
    expect(s.hasAttachments).toBe(true);
    expect(s.attachments).toEqual([]);
  });

  it('renames the snooze helper label and adds the wake time', () => {
    const thread = metadataThread();
    thread.messages![0].labelIds = ['Label_99'];
    const s = toThreadSummary(thread, { labelAliases: { Label_99: 'SNOOZED' }, snoozed: { [thread.id]: 42 } });
    expect(s.labelIds).toContain('SNOOZED');
    expect(s.labelIds).not.toContain('Label_99');
    expect(s.snoozedUntil).toBe(42);
  });
});

describe('batch responses', () => {
  it('matches parts by Content-ID even out of order, and keeps a failed part as its status', () => {
    const body = batchResponse('batch_abc', [
      { contentId: 'response-item2', status: '200 OK', body: { id: 'c' } },
      { contentId: 'response-item0', status: '200 OK', body: { id: 'a' } },
      { contentId: 'response-item1', status: '404 Not Found', body: NOT_FOUND },
    ]);
    const results = parseBatchResponse('multipart/mixed; boundary=batch_abc', body, 3);
    expect(results.map((r) => r.status)).toEqual([200, 404, 200]);
    expect((results[0].body as { id: string }).id).toBe('a');
    expect((results[2].body as { id: string }).id).toBe('c');
    expect((results[1].body as typeof NOT_FOUND).error.status).toBe('NOT_FOUND');
  });

  it('accepts LF line endings, a quoted boundary, a preamble and an empty 204 body', () => {
    const body =
      'preamble text\n' +
      batchResponse(
        'b-1',
        [
          { contentId: 'response-item0', status: '204 No Content', body: '' },
          { contentId: 'response-item1', status: '200', body: { ok: true } },
        ],
        '\n',
      );
    const results = parseBatchResponse('multipart/mixed; boundary="b-1"', body, 2);
    expect(results[0]).toMatchObject({ status: 204, body: undefined });
    expect(results[1]).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('reports parts missing from the response as status 0', () => {
    const body = batchResponse('x', [{ contentId: 'response-item0', status: '200 OK', body: {} }]);
    expect(parseBatchResponse('multipart/mixed; boundary=x', body, 2).map((r) => r.status)).toEqual([200, 0]);
  });
});

describe('html to text fallback', () => {
  it('keeps structure, link targets and entities, and drops style and script', () => {
    const html =
      '<style>p{color:red}</style><p>Hi &amp; welcome,</p><ul><li>One</li><li>Two</li></ul>' +
      '<p>Read <a href="https://x.com/a?b=1&amp;c=2">the doc</a> or <a href="https://x.com">https://x.com</a>.<br>Bye&nbsp;now</p>' +
      '<script>alert(1)</script><p>&lt;b&gt; is literal</p>';
    expect(htmlToText(html)).toBe(
      'Hi & welcome,\n\n- One\n- Two\n\nRead the doc (https://x.com/a?b=1&c=2) or https://x.com.\nBye now\n\n<b> is literal',
    );
  });
});
