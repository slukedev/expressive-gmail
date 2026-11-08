// Gmail search operators: https://support.google.com/mail/answer/7190
import {
  EMPTY_ADVANCED,
  buildAdvancedQuery,
  getOperator,
  hasToken,
  setOperator,
  toggleToken,
  tokenize,
  type AdvancedSearch,
} from '../../src/app/features/search/query';

describe('tokenize', () => {
  it('keeps quoted phrases and their operators whole', () => {
    expect(tokenize('from:ana "dinner and movie tonight" -movie subject:"q3 report"')).toEqual([
      'from:ana',
      '"dinner and movie tonight"',
      '-movie',
      'subject:"q3 report"',
    ]);
  });

  it('keeps parenthesised groups whole', () => {
    expect(tokenize('subject:(dinner movie) has:attachment')).toEqual(['subject:(dinner movie)', 'has:attachment']);
  });

  it('ignores runs of whitespace', () => {
    expect(tokenize('  is:unread    label:work  ')).toEqual(['is:unread', 'label:work']);
  });
});

describe('getOperator', () => {
  it('reads an operator value', () => {
    expect(getOperator('dinner from:amy@example.com is:unread', 'from')).toBe('amy@example.com');
  });

  it.each([
    ['a negated operator is not a value', '-from:ana', 'from'],
    ['deliveredto: is not to:', 'deliveredto:me@example.com', 'to'],
    ['text inside a phrase is not an operator', '"from:ana is great"', 'from'],
    ['a plain word that starts like the operator', 'tofu recipes', 'to'],
  ])('%s', (_l, q, op) => {
    expect(getOperator(q, op)).toBeUndefined();
  });
});

describe('setOperator', () => {
  it('replaces an existing value rather than adding a second one', () => {
    const q = setOperator('lunch from:ana is:unread', 'from', 'jordan@example.net');
    expect(tokenize(q).filter((t) => t.startsWith('from:'))).toEqual(['from:jordan@example.net']);
    expect(tokenize(q)).toEqual(expect.arrayContaining(['lunch', 'is:unread']));
  });

  it('removes the operator when the value is null', () => {
    expect(tokenize(setOperator('lunch from:ana is:unread', 'from', null))).toEqual(['lunch', 'is:unread']);
  });

  it('groups a multi-word value so Gmail reads it as one value', () => {
    const q = setOperator('', 'subject', 'q3 report');
    expect(q).toMatch(/^subject:("q3 report"|\(q3 report\))$/);
    expect(getOperator(q, 'subject')?.replace(/^["(]|[")]$/g, '')).toBe('q3 report');
  });

  it('leaves a negated copy alone', () => {
    const q = setOperator('-from:ana', 'from', 'bo@example.com');
    expect(tokenize(q)).toEqual(expect.arrayContaining(['-from:ana', 'from:bo@example.com']));
  });
});

describe('toggleToken / hasToken', () => {
  it('adds and removes a token without touching the rest', () => {
    const on = toggleToken('from:ana', 'is:unread');
    expect(tokenize(on)).toEqual(['from:ana', 'is:unread']);
    expect(hasToken(on, (t) => t === 'is:unread')).toBe(true);
    const off = toggleToken(on, 'is:unread');
    expect(tokenize(off)).toEqual(['from:ana']);
  });

  it('does not see a token inside a quoted phrase', () => {
    expect(hasToken('"is:unread"', (t) => t === 'is:unread')).toBe(false);
  });
});

describe('buildAdvancedQuery (Show search options)', () => {
  const build = (a: Partial<AdvancedSearch>) => buildAdvancedQuery({ ...EMPTY_ADVANCED, ...a });

  it('is empty for an empty form', () => {
    expect(build({}).trim()).toBe('');
  });

  it('writes from, to and subject as operators', () => {
    const q = build({ from: 'amy@example.com', to: 'david@example.com', subject: 'dinner' });
    expect(q).toMatch(/from:\(?amy@example\.com\)?/);
    expect(q).toMatch(/to:\(?david@example\.com\)?/);
    expect(q).toMatch(/subject:\(?dinner\)?/);
  });

  it('groups multi-word fields so every word stays in that field', () => {
    const q = build({ from: 'Ana Lopez', subject: 'anniversary party' });
    expect(q).toMatch(/from:(\(Ana Lopez\)|"Ana Lopez")/);
    expect(q).toMatch(/subject:(\(anniversary party\)|"anniversary party")/);
  });

  it('puts "Has the words" in as typed', () => {
    expect(build({ words: 'dinner "and movie"' })).toContain('dinner "and movie"');
  });

  it('negates every "Doesn\'t have" word', () => {
    expect(build({ without: 'movie' })).toMatch(/(^|\s)-(movie|\{movie\})(\s|$)/);
    expect(build({ without: 'movie popcorn' })).toMatch(/-\{movie popcorn\}|-movie -popcorn|-\(movie popcorn\)/);
  });

  it.each([
    ['larger', '5', 'M', /(^|\s)larger:5M(\s|$)/i],
    ['smaller', '500', 'K', /(^|\s)smaller:500K(\s|$)/i],
  ] as const)('size %s %s%s', (sizeOp, size, sizeUnit, re) => {
    expect(build({ sizeOp, size, sizeUnit })).toMatch(re);
  });

  it('adds no size operator without an amount', () => {
    expect(build({ sizeOp: 'smaller', size: '', words: 'x' })).not.toMatch(/larger:|smaller:|size:/);
  });

  it('turns "Date within 1 day of" into an after/before window around that date', () => {
    const q = build({ within: '1d', date: '2026-10-07' });
    const after = q.match(/after:(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    const before = q.match(/before:(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    expect(after).not.toBeNull();
    expect(before).not.toBeNull();
    const day = (m: RegExpMatchArray) => Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
    const target = Date.UTC(2026, 9, 7) / 864e5;
    expect(day(after!)).toBeLessThanOrEqual(target - 1);
    expect(day(after!)).toBeGreaterThanOrEqual(target - 2);
    expect(day(before!)).toBeGreaterThanOrEqual(target + 1);
    expect(day(before!)).toBeLessThanOrEqual(target + 2);
  });

  it('crosses a year boundary for "within 1 week" of Jan 2', () => {
    const q = build({ within: '1w', date: '2027-01-02' });
    expect(q).toMatch(/after:2026\/(12)\/(2[4-6])/);
    expect(q).toMatch(/before:2027\/0?1\/(09|10|9)/);
  });

  it('adds no date operators when no date is picked', () => {
    expect(build({ within: '1w', date: '', words: 'x' })).not.toMatch(/after:|before:/);
  });

  it.each([
    ['all', null],
    ['in:inbox', 'in:inbox'],
    ['in:anywhere', 'in:anywhere'],
    ['is:unread', 'is:unread'],
  ])('search in %s', (scope, token) => {
    const toks = tokenize(build({ scope, words: 'invoice' }));
    if (token) expect(toks).toContain(token);
    else expect(toks).toEqual(['invoice']);
  });

  it('adds has:attachment and -in:chats', () => {
    const toks = tokenize(build({ hasAttachment: true, excludeChats: true }));
    expect(toks).toEqual(expect.arrayContaining(['has:attachment', '-in:chats']));
  });
});
