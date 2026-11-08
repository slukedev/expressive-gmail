// Gmail's own date, size and people formatting, pinned to New York so DST edges are real.
vi.hoisted(() => {
  process.env.TZ = 'America/New_York';
});

import {
  addressList,
  dateGroup,
  displayName,
  fileSize,
  firstName,
  fullDate,
  isMe,
  listDate,
  messageDate,
  parseAddresses,
  participantsLine,
  plural,
  relative,
} from '../../src/app/lib/format';

// Intl puts a narrow no-break space before AM/PM; Gmail shows a plain space.
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

const ME = 'me@example.com';
const ana = { name: 'Ana Lopez', email: 'ana@example.com' };
const jordan = { name: 'Jordan Pike', email: 'jordan@example.net' };
const sam = { name: 'Sam Reyes', email: 'sam@example.org' };
const kim = { name: 'Kim Park', email: 'kim@example.org' };
const me = { name: 'Luke Example', email: ME };

describe('listDate (Gmail list column)', () => {
  const now = at(2026, 10, 13, 15, 30); // Tue Oct 13 2026, 3:30 PM

  it.each([
    ['earlier today', at(2026, 10, 13, 15, 1), '3:01 PM'],
    ['just after midnight', at(2026, 10, 13, 0, 5), '12:05 AM'],
    ['noon', at(2026, 10, 13, 12, 0), '12:00 PM'],
    ['yesterday late evening', at(2026, 10, 12, 23, 59), 'Oct 12'],
    ['earlier this year', at(2026, 10, 7, 9), 'Oct 7'],
    ['January 1 this year', at(2026, 1, 1, 0, 0), 'Jan 1'],
    ['last year', at(2025, 10, 7, 9), '10/7/25'],
    ['years back', at(2019, 3, 4, 9), '3/4/19'],
  ])('%s', (_label, t, expected) => {
    expect(norm(listDate(t, now))).toBe(expected);
  });

  it('switches to a numeric date across New Year even for mail three days old', () => {
    expect(norm(listDate(at(2025, 12, 30, 18), at(2026, 1, 2, 9)))).toBe('12/30/25');
  });

  it('uses the calendar day, not the last 24 hours, on the night DST ends', () => {
    // Nov 1 2026 is 25 hours long in New York.
    const now = at(2026, 11, 2, 0, 30);
    expect(norm(listDate(at(2026, 11, 1, 0, 45), now))).toBe('Nov 1');
    expect(norm(listDate(at(2026, 11, 2, 0, 10), now))).toBe('12:10 AM');
  });
});

describe('fullDate (tooltip)', () => {
  it.each([
    [at(2026, 10, 7, 9, 41), 'Wed, Oct 7, 2026, 9:41 AM'],
    [at(2025, 12, 31, 23, 59), 'Wed, Dec 31, 2025, 11:59 PM'],
    [at(2027, 1, 1, 0, 0), 'Fri, Jan 1, 2027, 12:00 AM'],
  ])('%s', (t, expected) => {
    expect(norm(fullDate(t))).toBe(expected);
  });
});

describe('relative', () => {
  const now = at(2026, 10, 13, 15, 0);
  it.each([
    [now - 60_000, '1 minute ago'],
    [now - 12 * 60_000, '12 minutes ago'],
    [now - 60 * 60_000, '1 hour ago'],
    [now - 2 * 3600_000 - 10 * 60_000, '2 hours ago'],
    [now - 24 * 3600_000 * 1, '1 day ago'],
    [now - 24 * 3600_000 * 5, '5 days ago'],
  ])('%i -> %s', (t, expected) => {
    expect(relative(t, now)).toBe(expected);
  });
});

describe('messageDate (message header)', () => {
  const now = at(2026, 10, 13, 15, 0);

  it('shows only the time for today, plus how long ago', () => {
    expect(norm(messageDate(at(2026, 10, 13, 12, 58), now))).toBe('12:58 PM (2 hours ago)');
  });

  it('shows date, time and days ago for older mail', () => {
    const s = norm(messageDate(at(2026, 10, 7, 15, 1), now));
    expect(s).toMatch(/Oct 7/);
    expect(s).toMatch(/3:01 PM/);
    expect(s).toMatch(/\(6 days ago\)$/);
  });
});

describe('fileSize', () => {
  it('shows bytes, whole KB and one decimal MB like Gmail attachment chips', () => {
    expect(fileSize(512)).toMatch(/^512 ?(B|bytes)$/);
    expect(fileSize(24 * 1024)).toBe('24 KB');
    expect(fileSize(Math.round(1.2 * 1024 * 1024))).toBe('1.2 MB');
  });

  it('never shows fractional KB or a leading zero MB', () => {
    expect(fileSize(1536 * 10 + 300)).toMatch(/^\d+ KB$/);
    expect(fileSize(900 * 1024)).not.toMatch(/^0\./);
  });
});

describe('isMe / displayName / firstName', () => {
  it('matches addresses case-insensitively and across aliases', () => {
    expect(isMe('Me@Example.COM', ME)).toBe(true);
    expect(isMe('work@example.net', [ME, 'work@example.net'])).toBe(true);
    expect(isMe('ana@example.com', [ME, 'work@example.net'])).toBe(false);
    expect(isMe('ana@example.com', undefined)).toBe(false);
  });

  it('calls yourself "me" whatever name your headers carry', () => {
    expect(displayName(me, ME)).toBe('me');
    expect(firstName(me, ME)).toBe('me');
    expect(displayName({ name: 'Work Luke', email: 'work@example.net' }, [ME, 'work@example.net'])).toBe('me');
  });

  it('uses the full name, then the first name, for other people', () => {
    expect(displayName(ana, ME)).toBe('Ana Lopez');
    expect(firstName(ana, ME)).toBe('Ana');
  });

  it('falls back to the address when there is no name', () => {
    expect(displayName({ email: 'billing@example.com' }, ME)).toContain('billing');
    expect(firstName({ email: 'billing@example.com' }, ME)).toContain('billing');
  });
});

describe('participantsLine (thread senders)', () => {
  it('shows the full name for a single sender', () => {
    expect(participantsLine([ana], ME)).toBe('Ana Lopez');
  });

  it('shows "me" for a thread only you wrote in', () => {
    expect(participantsLine([me], ME)).toBe('me');
  });

  it('uses first names and "me" when several people wrote', () => {
    expect(participantsLine([ana, me, jordan], ME)).toBe('Ana, me, Jordan');
  });

  it('elides the middle of a long thread, keeping first and last', () => {
    const line = participantsLine([ana, jordan, sam, kim, { name: 'Lee Moss', email: 'lee@example.com' }, me], ME);
    expect(line.startsWith('Ana')).toBe(true);
    expect(line.endsWith('me')).toBe(true);
    expect(line).toContain('..');
    expect(line).not.toContain('Sam');
  });
});

describe('addressList', () => {
  it('names you "me" among other recipients', () => {
    const s = addressList([ana, me], ME);
    expect(s).toContain('me');
    expect(s).toContain('Ana');
    expect(s).not.toContain('Luke');
  });
});

describe('parseAddresses (compose fields)', () => {
  it('keeps a comma inside a quoted name', () => {
    expect(parseAddresses('"Lopez, Ana" <ana@example.com>, jordan@example.net')).toEqual([
      { name: 'Lopez, Ana', email: 'ana@example.com' },
      { email: 'jordan@example.net' },
    ]);
  });

  it('splits on semicolons the way Outlook pastes lists', () => {
    expect(parseAddresses('Ana Lopez <ana@example.com>; Sam Reyes <sam@example.org>;').map((a) => a.email)).toEqual([
      'ana@example.com',
      'sam@example.org',
    ]);
  });

  it('reads bare addresses, angle-only addresses and messy spacing', () => {
    expect(parseAddresses('  ana@example.com ,<sam@example.org>,,  Kim Park<kim@example.org>  ').map((a) => a.email)).toEqual([
      'ana@example.com',
      'sam@example.org',
      'kim@example.org',
    ]);
  });

  it('does not split on a semicolon inside quotes', () => {
    const list = parseAddresses('"Team; Ops" <ops@example.com>');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Team; Ops', email: 'ops@example.com' });
  });

  it('returns nothing for empty input', () => {
    expect(parseAddresses('')).toEqual([]);
    expect(parseAddresses(' , ; ')).toEqual([]);
  });
});

describe('plural', () => {
  it.each([
    [1, 'message', undefined, 'message'],
    [0, 'message', undefined, 'messages'],
    [2, 'reply', 'replies', 'replies'],
  ])('%i %s', (n, one, many, word) => {
    // Accept either "replies" or "2 replies"; the word choice is what matters.
    expect(plural(n, one, many)).toMatch(new RegExp(`^(${n} )?${word}$`));
  });
});

describe('dateGroup (Inbox by Gmail sections)', () => {
  const SUN = 0;
  const MON = 1;
  const wed = at(2026, 10, 14, 10); // Wed Oct 14 2026

  it.each([
    ['today', at(2026, 10, 14, 0, 1), 'Today'],
    ['yesterday', at(2026, 10, 13, 23, 59), 'Yesterday'],
    ['Monday this week', at(2026, 10, 12, 9), 'This week'],
    ['earlier this month', at(2026, 10, 2, 9), 'This month'],
    ['last month', at(2026, 9, 29, 9), 'September'],
    ['earlier this year', at(2026, 2, 3, 9), 'February'],
    ['last year', at(2025, 10, 20, 9), 'October 2025'],
  ])('%s', (_label, t, expected) => {
    expect(dateGroup(t, wed, MON)).toBe(expected);
  });

  it('puts Sunday in this week only when weeks start on Sunday', () => {
    const sunday = at(2026, 10, 11, 9);
    expect(dateGroup(sunday, wed, SUN)).toBe('This week');
    expect(dateGroup(sunday, wed, MON)).toBe('This month');
  });

  it('keeps Yesterday even when yesterday was in last week', () => {
    const monday = at(2026, 10, 12, 10);
    expect(dateGroup(at(2026, 10, 11, 20), monday, MON)).toBe('Yesterday');
  });

  it('on January 1, Dec 31 is Yesterday and earlier December carries the year', () => {
    const jan1 = at(2027, 1, 1, 9);
    expect(dateGroup(at(2026, 12, 31, 22), jan1, MON)).toBe('Yesterday');
    expect(dateGroup(at(2026, 12, 3, 9), jan1, MON)).toBe('December 2026');
  });

  it('counts the calendar day across the end of DST', () => {
    const now = at(2026, 11, 2, 9); // Mon Nov 2, after the 25 hour Nov 1
    expect(dateGroup(at(2026, 11, 1, 0, 30), now, MON)).toBe('Yesterday');
    expect(dateGroup(at(2026, 10, 31, 23, 30), now, MON)).toBe('October');
  });

  it('counts the calendar day across the start of DST', () => {
    const now = at(2026, 3, 9, 12); // Mon Mar 9, after the 23 hour Mar 8
    expect(dateGroup(at(2026, 3, 8, 0, 30), now, MON)).toBe('Yesterday');
    expect(dateGroup(at(2026, 3, 7, 23, 30), now, SUN)).toBe('This month');
  });
});
