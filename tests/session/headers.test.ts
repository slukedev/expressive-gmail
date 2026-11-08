import { SessionBackend } from '../../src/session/backend';
import { headSource, headersComplete, listHeadersFrom, originalSourceUrl, parseHeaderBlock, rawSourceFrom } from '../../src/session/headers';
import { parseListUnsubscribe, parseMailto } from '../../src/app/lib/unsubscribe';
import { FakeTokens, fakeFetch, rejection, status, type Call } from './helpers';

const RAW = [
  'Delivered-To: ada@example.com',
  'From: Stride & Co. <news@stride.example>',
  'List-Unsubscribe: <https://stride.example/u?id=7&t=a>,',
  ' <mailto:unsub@stride.example?subject=unsubscribe>',
  'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  'List-ID: Stride news <news.stride.example>',
  'Subject: Fall sale',
  '',
  'List-Unsubscribe: <https://evil.example/body-is-not-a-header>',
].join('\r\n');

// Gmail's "Show original" page: the source HTML-escaped inside a <pre>.
const PAGE = `<!DOCTYPE html><html><body><div class="raw_message"><pre class="raw_message_text" id="raw_message_text">${RAW.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div></body></html>`;

describe('list headers from the original source', () => {
  it('reads folded List-* headers from the HTML page and ignores the body', () => {
    expect(listHeadersFrom(PAGE)).toEqual({
      listUnsubscribe: '<https://stride.example/u?id=7&t=a>, <mailto:unsub@stride.example?subject=unsubscribe>',
      listUnsubscribePost: 'List-Unsubscribe=One-Click',
      listId: 'Stride news <news.stride.example>',
    });
  });

  it('accepts a plain-text source, and gives up on an HTML page with no source in it', () => {
    expect(rawSourceFrom(RAW)).toBe(RAW);
    expect(listHeadersFrom(RAW).listUnsubscribe).toContain('https://stride.example/u?id=7&t=a');
    // A sign-in page is not "this sender has no header": it must fail, not come back empty.
    expect(() => listHeadersFrom('<!doctype html><html><body>Sign in to continue</body></html>')).toThrow();
  });

  it('keeps the first of repeated headers and matches names in any case', () => {
    const h = parseHeaderBlock('received: a\nReceived: b\nLIST-ID: <x.example>\n\nbody');
    expect(h.get('received')).toBe('a');
    expect(h.get('list-id')).toBe('<x.example>');
  });
});

describe('SessionBackend.listHeaders', () => {
  const make = (fetchImpl: typeof fetch) => new SessionBackend({ tokens: new FakeTokens(), fetch: fetchImpl, sleep: async () => {} });

  it('fetches Show original for that message in the signed-in account, once per message', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(PAGE, { headers: { 'content-type': 'text/html' } }));
    const b = make(fetch);
    const first = await b.listHeaders('msg-f:1846473264892611537');
    const again = await b.listHeaders('msg-f:1846473264892611537');
    expect(again).toEqual(first);
    expect(first.listUnsubscribePost).toBe('List-Unsubscribe=One-Click');
    expect(calls).toHaveLength(1);
    const url = new URL((calls[0] as Call).url);
    expect(url.pathname).toBe('/mail/u/1/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ui: '2', ik: 'abc123', view: 'om', permmsgid: 'msg-f:1846473264892611537' });
    expect((calls[0] as Call).init.credentials).toBe('include');
  });

  it("doesn't cache a failure, so the next try asks again", async () => {
    const { fetch, calls } = fakeFetch(status(500), () => new Response(PAGE));
    const b = make(fetch);
    await rejection(b.listHeaders('msg-f:1'));
    expect((await b.listHeaders('msg-f:1')).listId).toBe('Stride news <news.stride.example>');
    expect(calls).toHaveLength(2);
  });
});

describe('SessionBackend.listHeaders on a large message', () => {
  it('stops reading once the headers are in, instead of downloading the attachments too', async () => {
    const head = PAGE.slice(0, PAGE.indexOf('</pre>'));
    const chunk = new TextEncoder().encode('QUJD'.repeat(16_384));
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(head));
      },
      pull(controller) {
        pulled++;
        // About 25 MB of attachment if read to the end.
        if (pulled > 400) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { fetch } = fakeFetch(() => new Response(body, { headers: { 'content-type': 'text/html' } }));
    const b = new SessionBackend({ tokens: new FakeTokens(), fetch, sleep: async () => {} });
    const headers = await b.listHeaders('msg-f:7');
    expect(headers.listId).toBe('Stride news <news.stride.example>');
    expect(pulled).toBeLessThan(10);
  });
});


/** Streams `parts` as separate chunks and counts how many were pulled. */
function chunked(parts: string[]) {
  let pulled = 0;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = parts[pulled++];
      if (next === undefined) controller.close();
      else controller.enqueue(enc.encode(next));
    },
  });
  return { response: new Response(body), pulled: () => pulled };
}

// Shaped like a Nextdoor digest: folded across CRLF + tab, mixed-case names, two URLs and a mailto.
const NEXTDOOR = [
  'Delivered-To: ada@example.com',
  'Received: by 2002:a05:6a10:1234 with SMTP id abc;',
  '        Mon, 12 Oct 2026 07:01:02 -0700 (PDT)',
  'Return-Path: <bounce-ab12@rs.email.nextdoor.example>',
  'From: Nextdoor Local News <reply@rs.email.nextdoor.example>',
  'Subject: =?UTF-8?Q?Today=E2=80=99s_local_news?=',
  'list-unsubscribe: <https://nextdoor.example/unsubscribe/one_click/?t=AbC&amp=1>,',
  '\t<mailto:unsubscribe-ab12@rs.email.nextdoor.example?subject=Unsubscribe%20ab12>',
  'LIST-UNSUBSCRIBE-POST: List-Unsubscribe=One-Click',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'List-Unsubscribe: <https://evil.example/in-the-body>',
].join('\r\n');

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('reading Show original the way real Gmail serves it', () => {
  it('reads folded, mixed-case List-* headers and keeps every URL', () => {
    const h = listHeadersFrom(NEXTDOOR);
    expect(h.listUnsubscribePost).toBe('List-Unsubscribe=One-Click');
    expect(parseListUnsubscribe(h.listUnsubscribe)).toEqual({
      https: 'https://nextdoor.example/unsubscribe/one_click/?t=AbC&amp=1',
      mailto: 'mailto:unsubscribe-ab12@rs.email.nextdoor.example?subject=Unsubscribe%20ab12',
    });
    expect(parseMailto(parseListUnsubscribe(h.listUnsubscribe).mailto!)).toEqual({
      to: ['unsubscribe-ab12@rs.email.nextdoor.example'],
      subject: 'Unsubscribe ab12',
      body: undefined,
    });
  });

  it('finds the source in a page without a doctype, with a summary table and linkified URLs', () => {
    const linked = escape(NEXTDOOR).replace(
      'https://nextdoor.example/unsubscribe/one_click/?t=AbC&amp;amp=1',
      '<a href="https://nextdoor.example/x">https://nextdoor.example/unsubscribe/one_click/?t=AbC&amp;amp=1</a>',
    );
    const page = `<html><head><style>pre{white-space:pre-wrap}</style></head><body>\n\n<table><tr><td>Message ID</td><td>&lt;id@example.com&gt;</td></tr></table>\n<pre class="raw_message_text" id="raw_message_text">\n${linked}</pre></body></html>`;
    expect(parseListUnsubscribe(listHeadersFrom(page).listUnsubscribe).https).toBe('https://nextdoor.example/unsubscribe/one_click/?t=AbC&amp=1');
  });

  it('does not treat blank lines in the page before the source as the end of the headers', () => {
    const before = '<meta charset="utf-8">\n\n<title>Original Message</title>\n\n<div>';
    expect(headersComplete(before)).toBe(false);
    expect(headersComplete(`${before}<pre id="raw_message_text">Delivered-To: a@example.com\r\nFrom: b@example.com`)).toBe(false);
    expect(headersComplete(`${before}<pre id="raw_message_text">Delivered-To: a@example.com\r\nFrom: b@example.com\r\n\r\n`)).toBe(true);
  });

  it('stops after the chunk that completes the headers, across chunk splits mid-tag and mid-character', async () => {
    const page = `<!DOCTYPE html><html><body>\n\n<pre class="raw_message_text" id="raw_message_text">${escape(NEXTDOOR)}\r\n\r\n${'QUJD'.repeat(1000)}</pre></body></html>`;
    const cut = page.indexOf('raw_message_text" id');
    const end = page.indexOf('--b1');
    // "\u2019" in the summary forces a multi-byte character across a boundary.
    const parts = [page.slice(0, cut - 3) + '\u2019', page.slice(cut - 3, cut + 5), page.slice(cut + 5, end), page.slice(end, end + 100), 'never read', 'never read'];
    const { response, pulled } = chunked(parts);
    const text = await headSource(response);
    expect(pulled()).toBe(3);
    expect(listHeadersFrom(text).listUnsubscribePost).toBe('List-Unsubscribe=One-Click');
  });

  it('reads to the end when the response is short, and decodes the final bytes', async () => {
    const { response } = chunked([NEXTDOOR.slice(0, 40), NEXTDOOR.slice(40)]);
    expect(await headSource(response)).toBe(NEXTDOOR);
  });

  it('builds the Show original URL for sync ids and converts a legacy hex id', () => {
    const sync = new URL(originalSourceUrl('https://mail.google.com', 0, 'ik1', 'msg-a:r-123'));
    expect(sync.searchParams.get('permmsgid')).toBe('msg-a:r-123');
    const hex = new URL(originalSourceUrl('https://mail.google.com', 3, 'ik1', '18f2a3b4c5d6e7f8'));
    expect(hex.pathname).toBe('/mail/u/3/');
    expect(hex.searchParams.get('permmsgid')).toBe(`msg-f:${BigInt('0x18f2a3b4c5d6e7f8')}`);
  });
});

describe('SessionBackend.listHeaders when Gmail sends something else', () => {
  it('rejects (and retries next time) instead of caching "no header" for a sign-in page', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response('<html><body>\n\nSign in</body></html>'),
      () => new Response(NEXTDOOR),
    );
    const b = new SessionBackend({ tokens: new FakeTokens(), fetch, sleep: async () => {} });
    await rejection(b.listHeaders('msg-f:9'));
    expect((await b.listHeaders('msg-f:9')).listUnsubscribePost).toBe('List-Unsubscribe=One-Click');
    expect(calls).toHaveLength(2);
  });
});
