// List-Unsubscribe (RFC 2369) and mailto: URLs (RFC 6068).
import { findUnsubscribeLink, parseListUnsubscribe, parseMailto } from '../../src/app/lib/unsubscribe';

describe('parseListUnsubscribe', () => {
  it.each([
    ['<mailto:unsub@example.com?subject=unsubscribe>, <https://example.com/u/abc123>', { mailto: 'mailto:unsub@example.com?subject=unsubscribe', https: 'https://example.com/u/abc123' }],
    ['<https://example.com/u/abc123>,<mailto:unsub@example.com>', { mailto: 'mailto:unsub@example.com', https: 'https://example.com/u/abc123' }],
    ['<https://example.com/u?list=1&id=2>', { https: 'https://example.com/u?list=1&id=2' }],
    ['<mailto:list-request@example.org?body=unsubscribe%20weekly>', { mailto: 'mailto:list-request@example.org?body=unsubscribe%20weekly' }],
  ])('%j', (value, expected) => {
    expect(parseListUnsubscribe(value)).toEqual(expected);
  });

  it('copes with header folding inside the list', () => {
    const v = '<mailto:unsub@example.com>,\r\n <https://example.com/very/long/unsubscribe/link?id=1>';
    expect(parseListUnsubscribe(v)).toEqual({ mailto: 'mailto:unsub@example.com', https: 'https://example.com/very/long/unsubscribe/link?id=1' });
  });

  it('takes the first of each kind', () => {
    const v = '<https://a.example.com/u>, <https://b.example.com/u>, <mailto:one@example.com>, <mailto:two@example.com>';
    expect(parseListUnsubscribe(v)).toEqual({ https: 'https://a.example.com/u', mailto: 'mailto:one@example.com' });
  });

  it('keeps a plain http link apart, since one-click needs https', () => {
    expect(parseListUnsubscribe('<http://example.com/u>')).toEqual({ http: 'http://example.com/u' });
  });

  it('drops whitespace a sender folded into the middle of a URL', () => {
    expect(parseListUnsubscribe('<https://example.com/u?id=1\r\n\t&t=2>').https).toBe('https://example.com/u?id=1&t=2');
  });

  it.each([undefined, '', 'NO', '<>', 'not a header'])('finds nothing in %j', (v) => {
    expect(parseListUnsubscribe(v)).toEqual({});
  });
});

describe('parseMailto', () => {
  it('reads recipient, subject and body', () => {
    expect(parseMailto('mailto:unsub@example.com?subject=Unsubscribe%20me&body=Please%20remove%20me%0D%0AThanks')).toEqual({
      to: ['unsub@example.com'],
      subject: 'Unsubscribe me',
      body: 'Please remove me\r\nThanks',
    });
  });

  it('reads several recipients and a to= field', () => {
    expect(parseMailto('mailto:a@example.com,b@example.com?to=c@example.com').to).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
  });

  it('decodes a percent-encoded address and keeps a literal plus', () => {
    expect(parseMailto('mailto:list%2Bunsub%40example.com').to).toEqual(['list+unsub@example.com']);
    expect(parseMailto('mailto:list+unsub@example.com').to).toEqual(['list+unsub@example.com']);
  });

  it('treats the scheme and field names case-insensitively', () => {
    expect(parseMailto('MAILTO:unsub@example.com?Subject=Stop')).toMatchObject({ to: ['unsub@example.com'], subject: 'Stop' });
  });
});

describe('findUnsubscribeLink', () => {
  it('prefers a link whose text says unsubscribe over one whose URL does', () => {
    const html = '<a href="https://example.com/track/unsubscribe-ish?x=1">View online</a><a href=\'https://example.com/p?a=1&amp;b=2\'>Manage your <b>email preferences</b></a>';
    expect(findUnsubscribeLink(html)).toBe('https://example.com/p?a=1&b=2');
  });

  it.each([
    ['Se désabonner', 'fr'],
    ['Newsletter abbestellen', 'de'],
    ['Darse de baja', 'es'],
    ['Disiscriviti', 'it'],
    ['Uitschrijven', 'nl'],
    ['配信停止', 'ja'],
    ['Opt-out', 'en'],
  ])('finds "%s" (%s)', (label) => {
    expect(findUnsubscribeLink(`<a href="https://example.com/x">${label}</a>`)).toBe('https://example.com/x');
  });

  it('falls back to a URL whose path says unsubscribe', () => {
    expect(findUnsubscribeLink('<a href="https://example.com/unsubscribe?u=9">here</a>')).toBe('https://example.com/unsubscribe?u=9');
  });

  it('reads plain-text mail', () => {
    expect(findUnsubscribeLink(undefined, 'Hi\nTo unsubscribe visit https://example.com/u/9.\n')).toBe('https://example.com/u/9');
  });

  it('ignores mailto and javascript links and ordinary mail', () => {
    expect(findUnsubscribeLink('<a href="mailto:x@example.com">Unsubscribe</a><a href="javascript:void 0">Unsubscribe</a>')).toBeUndefined();
    expect(findUnsubscribeLink('<a href="https://example.com/adopt-outdoor-cats">Adopt</a> <p>See you Tuesday</p>')).toBeUndefined();
  });
});
