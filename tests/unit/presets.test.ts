import { describeTime, fullTime, reminderPresets, schedulePresets, scheduleTime, snoozePresets, workweekStart, type TimePreset } from '../../src/app/lib/presets';

// Week of Monday, October 5 2026 (local time, clear of DST changes in either hemisphere).
const MON_0900 = new Date(2026, 9, 5, 9, 0);
const WED_1630 = new Date(2026, 9, 7, 16, 30);
const FRI_1800 = new Date(2026, 9, 9, 18, 0);
const SAT_1100 = new Date(2026, 9, 10, 11, 0);
const SUN_2000 = new Date(2026, 9, 11, 20, 0);

const local = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const shape = (presets: TimePreset[]) => presets.map((p) => [p.id, p.label, p.at]);
const norm = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ');

describe('snoozePresets', () => {
  it.each<[string, Date, [string, string, number][]]>([
    [
      'Monday morning',
      MON_0900,
      [
        ['later', 'Later today', local(10, 5, 18)],
        ['tomorrow', 'Tomorrow', local(10, 6, 8)],
        ['week', 'Later this week', local(10, 7, 8)],
        ['weekend', 'This weekend', local(10, 10, 8)],
        ['next-week', 'Next week', local(10, 12, 8)],
      ],
    ],
    [
      'Wednesday at 4:30 PM still offers later today',
      WED_1630,
      [
        ['later', 'Later today', local(10, 7, 18)],
        ['tomorrow', 'Tomorrow', local(10, 8, 8)],
        ['week', 'Later this week', local(10, 9, 8)],
        ['weekend', 'This weekend', local(10, 10, 8)],
        ['next-week', 'Next week', local(10, 12, 8)],
      ],
    ],
    [
      'Saturday has no weekend option',
      SAT_1100,
      [
        ['later', 'Later today', local(10, 10, 18)],
        ['tomorrow', 'Tomorrow', local(10, 11, 8)],
        ['next-week', 'Next week', local(10, 12, 8)],
      ],
    ],
    [
      'Sunday evening: next week is tomorrow',
      SUN_2000,
      [
        ['tomorrow', 'Tomorrow', local(10, 12, 8)],
        ['next-week', 'Next week', local(10, 12, 8)],
      ],
    ],
  ])('%s', (_name, now, expected) => {
    expect(shape(snoozePresets(now))).toEqual(expected);
  });

  it('Friday at 6 PM has no later today and no later this week', () => {
    const presets = snoozePresets(FRI_1800);
    expect(presets.map((p) => p.id)).not.toContain('later');
    expect(presets.map((p) => p.id)).not.toContain('week');
    expect(presets.find((p) => p.id === 'tomorrow')?.at).toBe(local(10, 10, 8));
    expect(presets.find((p) => p.id === 'next-week')?.at).toBe(local(10, 12, 8));
  });

  it('later today stops at 5 PM', () => {
    expect(snoozePresets(new Date(2026, 9, 7, 16, 59)).map((p) => p.id)).toContain('later');
    expect(snoozePresets(new Date(2026, 9, 7, 17, 0)).map((p) => p.id)).not.toContain('later');
  });

  it.each([MON_0900, WED_1630, FRI_1800, SAT_1100, SUN_2000])('every preset is in the future and next week is a Monday (%s)', (now) => {
    const presets = snoozePresets(now);
    for (const p of presets) expect(p.at).toBeGreaterThan(now.getTime());
    const next = new Date(presets.find((p) => p.id === 'next-week')!.at);
    expect(next.getDay()).toBe(1);
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
  });
});

describe('schedulePresets', () => {
  // Every case passes its own now and work-week start, so the result never depends on today or the machine's locale.
  it.each<[string, Date, [string, string, number][]]>([
    [
      'Wednesday',
      WED_1630,
      [
        ['tomorrow-am', 'Tomorrow morning', local(10, 8, 8)],
        ['tomorrow-pm', 'Tomorrow afternoon', local(10, 8, 13)],
        ['week-start', 'Monday morning', local(10, 12, 8)],
      ],
    ],
    [
      'Saturday: Monday is two days away',
      SAT_1100,
      [
        ['tomorrow-am', 'Tomorrow morning', local(10, 11, 8)],
        ['tomorrow-pm', 'Tomorrow afternoon', local(10, 11, 13)],
        ['week-start', 'Monday morning', local(10, 12, 8)],
      ],
    ],
    [
      'Sunday: Monday morning is tomorrow morning, listed once',
      SUN_2000,
      [
        ['tomorrow-am', 'Tomorrow morning', local(10, 12, 8)],
        ['tomorrow-pm', 'Tomorrow afternoon', local(10, 12, 13)],
      ],
    ],
    [
      'Monday: the Monday option is a week out',
      MON_0900,
      [
        ['tomorrow-am', 'Tomorrow morning', local(10, 6, 8)],
        ['tomorrow-pm', 'Tomorrow afternoon', local(10, 6, 13)],
        ['week-start', 'Monday morning', local(10, 12, 8)],
      ],
    ],
  ])('%s', (_name, now, expected) => {
    expect(shape(schedulePresets(now, 1))).toEqual(expected);
  });

  it('a Sunday work week offers Sunday morning, and drops it when that is tomorrow', () => {
    expect(shape(schedulePresets(WED_1630, 0)).at(-1)).toEqual(['week-start', 'Sunday morning', local(10, 11, 8)]);
    expect(schedulePresets(SAT_1100, 0).map((p) => p.id)).toEqual(['tomorrow-am', 'tomorrow-pm']);
  });

  it('just after midnight, tomorrow is the next calendar day', () => {
    expect(schedulePresets(new Date(2026, 9, 7, 0, 5), 1)[0].at).toBe(local(10, 8, 8));
  });

  it('crosses month and year ends', () => {
    expect(schedulePresets(new Date(2026, 9, 31, 15, 0), 1).map((p) => p.at)).toEqual([local(11, 1, 8), local(11, 1, 13), local(11, 2, 8)]);
    // Thursday, December 31 2026.
    expect(schedulePresets(new Date(2026, 11, 31, 10, 0), 1).map((p) => p.at)).toEqual([
      new Date(2027, 0, 1, 8).getTime(),
      new Date(2027, 0, 1, 13).getTime(),
      new Date(2027, 0, 4, 8).getTime(),
    ]);
  });

  describe('across a DST change', () => {
    const tz = process.env.TZ;
    afterEach(() => {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    });

    it('spring forward in New York still lands on 8:00 AM wall clock', () => {
      process.env.TZ = 'America/New_York';
      // Saturday March 7 2026; clocks go forward early Sunday March 8.
      const presets = schedulePresets(new Date(2026, 2, 7, 22, 0), 1);
      const hours = presets.map((p) => [new Date(p.at).getDate(), new Date(p.at).getHours()]);
      expect(hours).toEqual([[8, 8], [8, 13], [9, 8]]);
      // 8 AM Sunday is 9 hours after 10 PM Saturday, not 10: the clock skipped an hour.
      expect(presets[0].at - new Date(2026, 2, 7, 22, 0).getTime()).toBe(9 * 3_600_000);
    });

    it('fall back in London keeps 8:00 AM too', () => {
      process.env.TZ = 'Europe/London';
      // Saturday October 24 2026; clocks go back early Sunday October 25.
      const presets = schedulePresets(new Date(2026, 9, 24, 22, 0), 1);
      expect(presets.map((p) => new Date(p.at).getHours())).toEqual([8, 13, 8]);
      expect(presets[0].at - new Date(2026, 9, 24, 22, 0).getTime()).toBe(11 * 3_600_000);
    });
  });
});

describe('workweekStart', () => {
  const supported = typeof (new Intl.Locale('en-US') as Intl.Locale & { getWeekInfo?: unknown }).getWeekInfo === 'function' || 'weekInfo' in new Intl.Locale('en-US');
  it.runIf(supported).each([
    ['en-US', 1],
    ['en-GB', 1],
    ['de-DE', 1],
    ['he-IL', 0],
  ])('%s starts its work week on day %i', (lang, day) => {
    expect(workweekStart(lang)).toBe(day);
  });

  it('falls back to Monday for a locale it cannot read', () => {
    expect(workweekStart('not a locale')).toBe(1);
  });
});

describe('scheduleTime and fullTime', () => {
  it('format like Gmail', () => {
    expect(norm(scheduleTime(local(10, 14, 8)))).toBe('Oct 14, 8:00 AM');
    expect(norm(fullTime(local(10, 13, 8)))).toBe('Tue, Oct 13, 8:00 AM');
  });
});

describe('reminderPresets', () => {
  it('one day keeps the current time, three days and a week land at 9 AM', () => {
    expect(shape(reminderPresets(WED_1630))).toEqual([
      ['1d', 'In 1 day', local(10, 8, 16, 30)],
      ['3d', 'In 3 days', local(10, 10, 9)],
      ['1w', 'In 1 week', local(10, 14, 9)],
    ]);
  });

  it('rolls over the end of the month', () => {
    const now = new Date(2026, 8, 29, 7, 45);
    expect(reminderPresets(now).map((p) => p.at)).toEqual([local(9, 30, 7, 45), local(10, 2, 9), local(10, 6, 9)]);
  });
});

describe('describeTime', () => {
  it.each([
    ['later today', local(10, 7, 18), 'today, 6:00 PM'],
    ['tomorrow morning', local(10, 8, 8), 'tomorrow, 8:00 AM'],
    ['two days out', local(10, 9, 8), 'Fri, Oct 9, 8:00 AM'],
    ['earlier today', local(10, 7, 0, 5), 'today, 12:05 AM'],
  ])('%s', (_name, t, expected) => {
    expect(norm(describeTime(t, WED_1630))).toBe(expected);
  });

  it('tomorrow crosses a month boundary', () => {
    expect(norm(describeTime(local(10, 1, 13), new Date(2026, 8, 30, 22, 0)))).toBe('tomorrow, 1:00 PM');
  });
});
