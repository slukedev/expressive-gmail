// RFC 5322 address lists and RFC 2047 encoded words, as Gmail sends and receives them.
import {
  dedupeAddresses,
  formatAddress,
  formatAddressList,
  parseAddress,
  parseAddressList,
} from '../../src/app/data/api/address';
import { decodeWords, encodeWords, isAscii } from '../../src/app/data/api/encoded-words';

describe('parseAddressList', () => {
  it.each([
    ['"Doe, Jane" <jane@example.com>, bo@example.org', [{ name: 'Doe, Jane', email: 'jane@example.com' }, { email: 'bo@example.org' }]],
    ['"A \\"B\\" C" <abc@example.com>', [{ name: 'A "B" C', email: 'abc@example.com' }]],
    ['jane@example.com (Jane Doe)', [{ name: 'Jane Doe', email: 'jane@example.com' }]],
    ['<jane@example.com>', [{ email: 'jane@example.com' }]],
    ['undisclosed-recipients:;', []],
    ['Team: a@example.com, "B, Bee" <b@example.org>;, c@example.net', [
      { email: 'a@example.com' },
      { name: 'B, Bee', email: 'b@example.org' },
      { email: 'c@example.net' },
    ]],
    ['"Re: Ops" <ops@example.com>', [{ name: 'Re: Ops', email: 'ops@example.com' }]],
    ['Jane Doe\r\n <jane@example.com>,\r\n\tbo@example.org', [{ name: 'Jane Doe', email: 'jane@example.com' }, { email: 'bo@example.org' }]],
    ['"jane@example.com" <jane@example.com>', [{ email: 'jane@example.com' }]],
    [',, no-at-sign, ,a@example.com,', [{ email: 'a@example.com' }]],
  ])('%j', (input, expected) => {
    const got = parseAddressList(input).map((a) => (a.name === undefined ? { email: a.email } : a));
    expect(got).toEqual(expected);
  });

  it('joins an unquoted decoded name with a comma to its address', () => {
    expect(parseAddressList('Doe, Jane <jane@example.com>')).toEqual([{ name: 'Doe, Jane', email: 'jane@example.com' }]);
  });

  it('survives an unclosed bracket or quote', () => {
    expect(() => parseAddressList('Jane <jane@example.com')).not.toThrow();
    expect(parseAddressList('Jane <jane@example.com')[0]?.email).toBe('jane@example.com');
    expect(() => parseAddressList('"Jane <jane@example.com>')).not.toThrow();
  });

  it('handles null, undefined and empty', () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddress('')).toBeUndefined();
  });
});

describe('formatAddress', () => {
  it('leaves a bare address alone', () => {
    expect(formatAddress({ email: 'jane@example.com' })).toBe('jane@example.com');
  });

  it('quotes names with RFC 5322 specials and escapes quotes', () => {
    expect(formatAddress({ name: 'Doe, Jane', email: 'jane@example.com' })).toBe('"Doe, Jane" <jane@example.com>');
    expect(formatAddress({ name: 'A "B" C', email: 'abc@example.com' })).toBe('"A \\"B\\" C" <abc@example.com>');
  });

  it('encodes non-ASCII names as RFC 2047 words', () => {
    const s = formatAddress({ name: 'Élodie Müller', email: 'elodie@example.com' });
    expect(s).toMatch(/^=\?utf-8\?[bq]\?/i);
    expect(s.endsWith('<elodie@example.com>')).toBe(true);
    expect(isAscii(s)).toBe(true);
  });

  it.each([
    { name: 'Doe, Jane', email: 'jane@example.com' },
    { name: 'O\'Brien (Ops) "Lead"', email: 'ob@example.com' },
    { name: 'Team: Alpha; Beta', email: 'team@example.com' },
  ])('round-trips %j through parse', (a) => {
    expect(parseAddressList(formatAddressList([a, { email: 'x@example.org' }]))).toEqual([a, expect.objectContaining({ email: 'x@example.org' })]);
  });
});

describe('dedupeAddresses', () => {
  it('drops case-insensitive repeats and keeps the first', () => {
    expect(
      dedupeAddresses([
        { name: 'Jane', email: 'Jane@Example.com' },
        { email: 'bo@example.org' },
        { name: 'J. Doe', email: 'jane@example.com' },
      ]),
    ).toEqual([{ name: 'Jane', email: 'Jane@Example.com' }, { email: 'bo@example.org' }]);
  });
});

describe('decodeWords (RFC 2047 section 8 examples)', () => {
  it.each([
    ['=?ISO-8859-1?Q?a?=', 'a'],
    ['=?ISO-8859-1?Q?a?= b', 'a b'],
    ['=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?=', 'ab'],
    ['=?ISO-8859-1?Q?a?=  =?ISO-8859-1?Q?b?=', 'ab'],
    ['=?ISO-8859-1?Q?a?=\r\n    =?ISO-8859-1?Q?b?=', 'ab'],
    ['=?ISO-8859-1?Q?a_b?=', 'a b'],
    ['=?ISO-8859-1?Q?a?= =?ISO-8859-2?Q?_b?=', 'a b'],
    ['=?ISO-8859-1?Q?Andr=E9?= Pirard', 'André Pirard'],
    ['=?utf-8?q?caf=C3=A9?=', 'café'],
    ['=?UTF-8?B?w4lsb2RpZSBNw7xsbGVyIOaXpeacrCDwn5iA?=', 'Élodie Müller 日本 😀'],
    ['Re: =?UTF-8?B?w4lsb2RpZQ==?= and friends', 'Re: Élodie and friends'],
  ])('%j', (input, expected) => {
    expect(decodeWords(input)).toBe(expected);
  });

  it('falls back to UTF-8 for an unknown charset', () => {
    expect(decodeWords('=?x-made-up?B?w6k=?=')).toBe('é');
  });

  it('leaves a malformed word as literal text', () => {
    expect(decodeWords('=?UTF-8?B?w6k')).toBe('=?UTF-8?B?w6k');
  });
});

describe('encodeWords', () => {
  it('leaves ASCII readable', () => {
    expect(encodeWords('Quarterly report, final')).toBe('Quarterly report, final');
  });

  it.each([
    'Élodie Müller',
    '日本語のメールの件名がとても長い場合でも正しく分割されることを確認するためのテストです',
    '😀🎉👩‍👩‍👧‍👦 '.repeat(12),
    'Ünïcödé '.repeat(20),
  ])('round-trips with words of at most 75 characters: %j', (text) => {
    const enc = encodeWords(text);
    expect([...enc].every((c) => c.charCodeAt(0) <= 0x7f)).toBe(true);
    for (const word of enc.split(/\r\n /)) expect(word.length).toBeLessThanOrEqual(75);
    const dec = decodeWords(enc);
    expect(dec).toBe(text);
    expect(dec).not.toContain('�');
  });
});
