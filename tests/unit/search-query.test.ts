import { buildAdvancedQuery, EMPTY_ADVANCED, getOperator, setOperator, toggleToken, tokenize, type AdvancedSearch } from '../../src/app/features/search/query';

describe('tokenize', () => {
  it.each([
    ['from:ana is:unread', ['from:ana', 'is:unread']],
    ['  from:ana    report  ', ['from:ana', 'report']],
    ['subject:"q3 budget review" from:ana', ['subject:"q3 budget review"', 'from:ana']],
    ['-from:"Ana Lopez" -is:read', ['-from:"Ana Lopez"', '-is:read']],
    ['from:(ana OR bo) has:attachment', ['from:(ana OR bo)', 'has:attachment']],
    ['-label:(Work Personal) "exact phrase here" tail', ['-label:(Work Personal)', '"exact phrase here"', 'tail']],
    ['café 日本 from:josé', ['café', '日本', 'from:josé']],
    ['', []],
  ])('%j', (q, tokens) => {
    expect(tokenize(q)).toEqual(tokens);
  });
});

describe('setOperator', () => {
  it.each<[string, string, string, string | null, string]>([
    ['adds to an empty query', '', 'from', 'ana', 'from:ana'],
    ['replaces and moves to the end', 'from:bo report', 'from', 'ana', 'report from:ana'],
    ['quotes a value with spaces', 'report', 'subject', 'q3 budget', 'report subject:"q3 budget"'],
    ['replaces a quoted value', 'subject:"old thing" is:unread', 'subject', 'new', 'is:unread subject:new'],
    ['replaces a parenthesized group', 'from:(ana OR bo) x', 'from', 'kim', 'x from:kim'],
    ['matches the operator in any case', 'FROM:bo x', 'from', 'ana', 'x from:ana'],
    ['removes every copy with null', 'from:ana x from:bo', 'from', null, 'x'],
    ['removes with an empty string', 'is:unread from:ana', 'from', '', 'is:unread'],
    ['leaves a negated operator alone', '-from:ana x', 'from', 'bo', '-from:ana x from:bo'],
    ['does not touch a longer operator sharing the prefix', 'tox:1 to:ana', 'to', null, 'tox:1'],
  ])('%s', (_name, q, op, value, expected) => {
    expect(setOperator(q, op, value)).toBe(expected);
  });
});

describe('toggleToken', () => {
  it.each([
    ['adds a missing token', 'from:ana', 'is:unread', 'from:ana is:unread'],
    ['removes a present token', 'is:unread from:ana', 'is:unread', 'from:ana'],
    ['removes regardless of case', 'IS:Unread from:ana', 'is:unread', 'from:ana'],
    ['removes only the first copy', 'is:unread x is:unread', 'is:unread', 'x is:unread'],
    ['adds to an empty query', '', 'has:attachment', 'has:attachment'],
  ])('%s', (_name, q, token, expected) => {
    expect(toggleToken(q, token)).toBe(expected);
  });
});

describe('getOperator', () => {
  it.each<[string, string, string | undefined]>([
    ['from:ana is:unread', 'from', 'ana'],
    ['subject:"q3 budget" x', 'subject', 'q3 budget'],
    ['From:Ana', 'from', 'Ana'],
    ['-from:ana', 'from', undefined],
    ['report', 'from', undefined],
    ['from:ana from:bo', 'from', 'ana'],
  ])('%j %s', (q, op, expected) => {
    expect(getOperator(q, op)).toBe(expected);
  });

  it('reads back what setOperator wrote', () => {
    const q = setOperator('is:unread', 'subject', 'q3 budget plan');
    expect(getOperator(setOperator(q, 'from', 'ana'), 'subject')).toBe('q3 budget plan');
  });
});

describe('buildAdvancedQuery', () => {
  const build = (over: Partial<AdvancedSearch>) => buildAdvancedQuery({ ...EMPTY_ADVANCED, ...over });

  it('is empty for the empty form', () => {
    expect(build({})).toBe('');
  });

  it.each<[string, Partial<AdvancedSearch>, string]>([
    ['single from', { from: ' ana@x.com ' }, 'from:ana@x.com'],
    ['from with spaces is grouped', { from: 'Ana Lopez' }, 'from:(Ana Lopez)'],
    ['to and subject', { to: 'bo', subject: 'q3 budget' }, 'to:bo subject:(q3 budget)'],
    ['words and excluded words', { words: 'invoice paid', without: 'draft spam' }, 'invoice paid -{draft spam}'],
    ['larger than megabytes', { size: '5', sizeOp: 'larger', sizeUnit: 'M' }, 'larger:5M'],
    ['smaller than kilobytes', { size: ' 200 ', sizeOp: 'smaller', sizeUnit: 'K' }, 'smaller:200K'],
    ['scope other than all mail', { scope: 'in:sent' }, 'in:sent'],
    ['attachment and no chats', { hasAttachment: true, excludeChats: true }, 'has:attachment -in:chats'],
    ['whitespace-only fields are ignored', { from: '  ', subject: '\t', size: ' ' }, ''],
  ])('%s', (_name, over, expected) => {
    expect(build(over)).toBe(expected);
  });

  it('orders every part like Gmail', () => {
    expect(build({ from: 'ana', to: 'bo', subject: 'hi', words: 'w', without: 'x', size: '1', scope: 'is:unread', hasAttachment: true })).toBe(
      'from:ana to:bo subject:hi w -{x} larger:1M is:unread has:attachment',
    );
  });

  describe('date window', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTz;
    });

    // The date input yields "YYYY-MM-DD"; the window is that calendar day plus and minus `within`.
    const window = (tz: string, over: Partial<AdvancedSearch>) => {
      process.env.TZ = tz;
      return build(over);
    };

    it.each<[string, string, string]>([
      ['1d', '2026-10-08', 'after:2026/10/7 before:2026/10/10'],
      ['1w', '2026-10-08', 'after:2026/10/1 before:2026/10/16'],
      ['1d', '2026-01-01', 'after:2025/12/31 before:2026/1/3'],
      ['bogus', '2026-10-08', 'after:2026/10/7 before:2026/10/10'],
    ])('within %s of %s east of UTC', (within, date, expected) => {
      expect(window('Asia/Tokyo', { within, date })).toBe(expected);
    });

    it('within 1d of 2026-10-08 west of UTC', () => {
      expect(window('America/Los_Angeles', { within: '1d', date: '2026-10-08' })).toBe('after:2026/10/7 before:2026/10/10');
    });
  });
});
