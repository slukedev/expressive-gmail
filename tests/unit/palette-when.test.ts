import { describe, expect, it } from 'vitest';
import { localeDayFirst, parseWhen } from '../../src/app/features/palette/when';

// Tuesday 13 October 2026, 10:30 local. Dates are built with local
// constructors, so these hold in any time zone the suite runs in.
const NOW = new Date(2026, 9, 13, 10, 30);
const at = (y: number, mo: number, d: number, h = 8, m = 0) => new Date(y, mo, d, h, m).getTime();
const parse = (s: string, now = NOW, dayFirst = false) => parseWhen(s, now, { defaultHour: 8, dayFirst });

describe('parseWhen', () => {
  it.each([
    ['tomorrow', at(2026, 9, 14)],
    ['tom', at(2026, 9, 14)],
    ['tmrw 9am', at(2026, 9, 14, 9)],
    ['tomorrow 9am', at(2026, 9, 14, 9)],
    ['9am tomorrow', at(2026, 9, 14, 9)],
    ['tomorrow at 9:30 pm', at(2026, 9, 14, 21, 30)],
    ['tomorrow morning', at(2026, 9, 14, 8)],
    ['tomorrow evening', at(2026, 9, 14, 18)],
    ['day after tomorrow', at(2026, 9, 15)],
    ['today 3pm', at(2026, 9, 13, 15)],
    ['tonight', at(2026, 9, 13, 20)],
    ['3pm', at(2026, 9, 13, 15)],
    ['noon', at(2026, 9, 13, 12)],
  ])('reads %s', (text, expected) => {
    expect(parse(text)).toEqual({ at: expected, past: false });
  });

  it.each([
    // Tuesday: the coming Friday is this week; "next fri" is the one after.
    ['fri', at(2026, 9, 16)],
    ['friday 9am', at(2026, 9, 16, 9)],
    ['on fri at 5', at(2026, 9, 16, 17)],
    ['next fri', at(2026, 9, 23)],
    ['next monday', at(2026, 9, 19)],
    ['mon morning', at(2026, 9, 19, 8)],
    // The same weekday as today means a week out, never today.
    ['tue', at(2026, 9, 20)],
    ['next week', at(2026, 9, 19)],
    ['weekend', at(2026, 9, 17)],
    ['this weekend', at(2026, 9, 17)],
    ['next weekend', at(2026, 9, 24)],
    ['later this week', at(2026, 9, 15)],
    ['next month', at(2026, 10, 1)],
  ])('reads the weekday phrase %s', (text, expected) => {
    expect(parse(text)?.at).toBe(expected);
  });

  it.each([
    ['in 3 days', at(2026, 9, 16)],
    ['3 days', at(2026, 9, 16)],
    ['3d', at(2026, 9, 16)],
    ['in a week', at(2026, 9, 20)],
    ['in 2 weeks', at(2026, 9, 27)],
    ['in 3 days at 2pm', at(2026, 9, 16, 14)],
    ['in a month', at(2026, 10, 13)],
    ['in 2 hours', at(2026, 9, 13, 12, 30)],
    ['2h', at(2026, 9, 13, 12, 30)],
    ['in 45 minutes', at(2026, 9, 13, 11, 15)],
  ])('reads the relative time %s', (text, expected) => {
    expect(parse(text)?.at).toBe(expected);
  });

  it.each([
    ['oct 20', at(2026, 9, 20)],
    ['october 20th 2pm', at(2026, 9, 20, 14)],
    ['20 oct', at(2026, 9, 20)],
    ['2026-12-01', at(2026, 11, 1)],
    ['12/1', at(2026, 11, 1)],
    ['12/1/27', at(2027, 11, 1)],
    // A month and day already gone this year means next year.
    ['oct 1', at(2027, 9, 1)],
    ['jan 5 9am', at(2027, 0, 5, 9)],
  ])('reads the date %s', (text, expected) => {
    expect(parse(text)?.at).toBe(expected);
  });

  it('reads slashes the way the locale writes dates', () => {
    expect(parse('11/12', NOW, false)?.at).toBe(at(2026, 10, 12));
    expect(parse('11/12', NOW, true)?.at).toBe(at(2026, 11, 11));
    expect(parse('20/10', NOW, false)).toBeNull();
    expect(localeDayFirst('en-GB')).toBe(true);
    expect(localeDayFirst('en-US')).toBe(false);
  });

  it('reads a bare hour as the one people mean', () => {
    expect(parse('tomorrow 9')?.at).toBe(at(2026, 9, 14, 9));
    expect(parse('tomorrow 5')?.at).toBe(at(2026, 9, 14, 17));
    expect(parse('tomorrow 12')?.at).toBe(at(2026, 9, 14, 12));
    expect(parse('tomorrow 17:45')?.at).toBe(at(2026, 9, 14, 17, 45));
  });

  it('moves a time alone that has passed today to tomorrow', () => {
    expect(parse('9am')).toEqual({ at: at(2026, 9, 14, 9), past: false });
  });

  it('flags an explicit time that has already passed instead of moving it', () => {
    expect(parse('today 9am')).toEqual({ at: at(2026, 9, 13, 9), past: true });
  });

  it('uses the caller default hour for a day alone', () => {
    expect(parseWhen('fri', NOW, { defaultHour: 9 })?.at).toBe(at(2026, 9, 16, 9));
  });

  it('says "later" means this evening, or three hours on once evening is close', () => {
    expect(parse('later today')?.at).toBe(at(2026, 9, 13, 18));
    expect(parse('later', new Date(2026, 9, 13, 18, 10))?.at).toBe(at(2026, 9, 13, 22));
  });

  it('keeps the wall-clock hour across a daylight saving change', () => {
    // US clocks fall back on Sunday 1 November 2026; Europe on 25 October.
    const sat = new Date(2026, 9, 31, 10);
    expect(new Date(parse('tomorrow 9am', sat)!.at).getHours()).toBe(9);
    expect(new Date(parse('in 2 days', new Date(2026, 9, 24, 10))!.at).getHours()).toBe(8);
  });

  it('rolls over months and years', () => {
    expect(parse('tomorrow', new Date(2026, 11, 31, 12))?.at).toBe(at(2027, 0, 1));
    expect(parse('fri', new Date(2026, 9, 30, 12))?.at).toBe(at(2026, 10, 6));
  });

  it.each(['', 'snooze', 'in 2', 'tomorrow 25:00', 'feb 30', '13/45', 'next', 'month', 'fri banana', 'in 3 hours 9am', '0am'])('rejects %j', (text) => {
    expect(parse(text)).toBeNull();
  });

  it('ignores filler words around the time', () => {
    expect(parse('until tomorrow at 9am')?.at).toBe(at(2026, 9, 14, 9));
    expect(parse('me in 3 days')?.at).toBe(at(2026, 9, 16));
  });
});
