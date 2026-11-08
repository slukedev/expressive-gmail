import { dateGroup, displayName, fileSize, firstName, listDate, messageDate, parseAddresses, participantsLine, relative } from '../../src/app/lib/format';
import type { Address } from '../../src/app/data/types';

// Expected strings are en-US (the locale vitest runs in). Newer ICU puts a
// narrow no-break space before AM/PM, so compare with plain spaces.
const norm = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');

/** Thursday, October 8 2026, 10:00 local. */
const NOW = new Date(2026, 9, 8, 10, 0).getTime();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('listDate', () => {
  it.each([
    ['earlier today shows the time', new Date(2026, 9, 8, 9, 5), '9:05 AM'],
    ['just after midnight today is still today', new Date(2026, 9, 8, 0, 0), '12:00 AM'],
    ['one minute before midnight yesterday is a date', new Date(2026, 9, 7, 23, 59), 'Oct 7'],
    ['January 1 of this year', new Date(2026, 0, 1, 12, 0), 'Jan 1'],
    ['December 31 of last year uses the numeric short year', new Date(2025, 11, 31, 23, 0), '12/31/25'],
    ['a decade ago', new Date(2016, 1, 29, 8, 0), '2/29/16'],
  ])('%s', (_name, date, expected) => {
    expect(norm(listDate(date.getTime(), NOW))).toBe(expected);
  });
});

describe('relative', () => {
  it.each([
    ['30 seconds ago', NOW - 30 * SEC, 'just now'],
    ['30 seconds ahead', NOW + 30 * SEC, 'just now'],
    ['50 seconds ago rounds to a minute', NOW - 50 * SEC, '1 minute ago'],
    ['12 minutes ago', NOW - 12 * MIN, '12 minutes ago'],
    ['2 hours ago', NOW - 2 * HOUR, '2 hours ago'],
    ['3 hours ahead', NOW + 3 * HOUR, 'in 3 hours'],
    ['one day ago', NOW - DAY, '1 day ago'],
    ['five days ago', NOW - 5 * DAY, '5 days ago'],
    ['two months ago', NOW - 61 * DAY, '2 months ago'],
    ['over a year ago', NOW - 400 * DAY, 'last year'],
  ])('%s', (_name, t, expected) => {
    expect(relative(t, NOW)).toBe(expected);
  });

  it('59 minutes 40 seconds ago reads as an hour, not "60 minutes ago"', () => {
    expect(relative(NOW - (59 * MIN + 40 * SEC), NOW)).toBe('1 hour ago');
  });
});

describe('messageDate', () => {
  it('today shows only the time with the relative part', () => {
    expect(norm(messageDate(new Date(2026, 9, 8, 9, 5).getTime(), NOW))).toBe('9:05 AM (55 minutes ago)');
  });

  it('an earlier day shows the full date and time with the relative part', () => {
    expect(norm(messageDate(new Date(2026, 9, 3, 16, 12).getTime(), NOW))).toBe('Oct 3, 2026, 4:12 PM (5 days ago)');
  });
});

describe('fileSize', () => {
  const KB = 1024;
  const MB = 1024 * KB;
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '2 KB'],
    [500 * KB, '500 KB'],
    [MB, '1.0 MB'],
    [Math.round(9.9 * MB), '9.9 MB'],
    [10 * MB, '10 MB'],
    [Math.round(12.6 * MB), '13 MB'],
  ])('%d bytes is %s', (bytes, expected) => {
    expect(fileSize(bytes)).toBe(expected);
  });

  it('a size that rounds up to 1024 KB is shown in MB', () => {
    expect(fileSize(MB - 1)).toBe('1.0 MB');
  });

  it('a size just under 10 MB matches how 10 MB is shown', () => {
    expect(fileSize(10 * MB - 1)).toBe('10 MB');
  });
});

describe('displayName and firstName', () => {
  const ME = 'alex.rivera@example.com';
  it.each<[string, Address, string, string]>([
    ['named sender', { name: 'Ana Lopez', email: 'ana@x.com' }, 'Ana Lopez', 'Ana'],
    ['unnamed sender falls back to the local part', { email: 'bo.chen@y.com' }, 'bo.chen', 'bo.chen'],
    ['my own address in another case is "me"', { name: 'Alex Rivera', email: 'Alex.Rivera@Example.com' }, 'me', 'me'],
    ['extra whitespace between names', { name: 'Mary   Ann Smith', email: 'm@x.com' }, 'Mary   Ann Smith', 'Mary'],
  ])('%s', (_name, address, display, first) => {
    expect(displayName(address, ME)).toBe(display);
    expect(firstName(address, ME)).toBe(first);
  });

  it('without my email nobody is "me"', () => {
    expect(displayName({ name: 'Alex Rivera', email: ME })).toBe('Alex Rivera');
  });
});

describe('participantsLine', () => {
  const ME = 'me@example.com';
  const ana = { name: 'Ana Lopez', email: 'ana@x.com' };
  const bo = { email: 'bo@y.com' };
  const me = { name: 'Me Myself', email: 'ME@example.com' };
  const jordan = { name: 'Jordan Lee', email: 'jordan@z.com' };
  const kim = { name: 'Kim Park', email: 'kim@z.com' };

  it.each<[string, Address[], string]>([
    ['nobody', [], '(no sender)'],
    ['a single sender shows the full name', [ana], 'Ana Lopez'],
    ['a single sender who is me', [me], 'me'],
    ['two senders show first names', [ana, bo], 'Ana, bo'],
    ['three senders with me in the middle', [ana, me, jordan], 'Ana, me, Jordan'],
    ['four senders keep the first and the last two', [ana, bo, me, jordan], 'Ana .. me, Jordan'],
    ['five senders', [ana, bo, jordan, kim, me], 'Ana .. Kim, me'],
  ])('%s', (_name, list, expected) => {
    expect(participantsLine(list, ME)).toBe(expected);
  });
});

describe('parseAddresses', () => {
  it('reads a named address and a bare address', () => {
    expect(parseAddresses('Ana Lopez <ana@x.com>, bo@y.com')).toEqual([{ name: 'Ana Lopez', email: 'ana@x.com' }, { email: 'bo@y.com' }]);
  });

  it('reads a quoted name and an angle address without a name', () => {
    expect(parseAddresses('"Kim Park" <kim@z.com>, <lee@z.com>,cho@z.com')).toEqual([
      { name: 'Kim Park', email: 'kim@z.com' },
      { name: undefined, email: 'lee@z.com' },
      { email: 'cho@z.com' },
    ]);
  });

  it('Outlook-style semicolon separators do not leak into names', () => {
    expect(parseAddresses('"Kim Park" <kim@z.com>; <lee@z.com>')).toEqual([
      { name: 'Kim Park', email: 'kim@z.com' },
      { name: undefined, email: 'lee@z.com' },
    ]);
  });

  it.each(['', 'hello world', 'not an email, <>, @@', 'ana@, @x.com'])('finds nothing in %j', (input) => {
    expect(parseAddresses(input)).toEqual([]);
  });

  it('keeps a quoted name that contains a comma', () => {
    expect(parseAddresses('"Lopez, Ana" <ana@x.com>, bo@y.com')).toEqual([{ name: 'Lopez, Ana', email: 'ana@x.com' }, { email: 'bo@y.com' }]);
  });
});

describe('dateGroup', () => {
  // NOW is a Thursday. With weeks starting Monday, this week began Oct 5; with Sunday, Oct 4.
  it.each([
    ['a minute after midnight today', new Date(2026, 9, 8, 0, 1), 1, 'Today'],
    ['a minute before midnight last night', new Date(2026, 9, 7, 23, 59), 1, 'Yesterday'],
    ['Monday, the first day of a Monday week', new Date(2026, 9, 5, 8, 0), 1, 'This week'],
    ['Sunday, the day before a Monday week starts', new Date(2026, 9, 4, 20, 0), 1, 'This month'],
    ['the same Sunday when weeks start on Sunday', new Date(2026, 9, 4, 20, 0), 0, 'This week'],
    ['the first of the month', new Date(2026, 9, 1, 9, 0), 1, 'This month'],
    ['the last day of last month', new Date(2026, 8, 30, 23, 0), 1, 'September'],
    ['December last year names the year', new Date(2025, 11, 31, 12, 0), 1, 'December 2025'],
    ['a future date (a scheduled send) counts as today', new Date(2026, 9, 9, 9, 0), 1, 'Today'],
  ])('%s', (_, date, weekStart, expected) => {
    expect(dateGroup(date.getTime(), NOW, weekStart)).toBe(expected);
  });

  it('lets a week run across a month boundary, then names the old month', () => {
    // Sunday, November 1: that Monday-start week began on October 26.
    const first = new Date(2026, 10, 1, 9, 0).getTime();
    expect(dateGroup(new Date(2026, 9, 31, 22, 0).getTime(), first, 1)).toBe('Yesterday');
    expect(dateGroup(new Date(2026, 9, 26, 8, 0).getTime(), first, 1)).toBe('This week');
    expect(dateGroup(new Date(2026, 9, 25, 22, 0).getTime(), first, 1)).toBe('October');
  });
});
