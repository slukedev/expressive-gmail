/** Reads a time out of what's typed after "snooze" or "remind": "tomorrow 9am", "fri", "in 3 days", "oct 20 2pm", "2h". Local time throughout, so a wall-clock hour survives a DST change. */

export interface When {
  /** Epoch ms. */
  at: number;
  /** Already behind `now` (an explicit "today 9am" at noon). */
  past: boolean;
}

export interface WhenOptions {
  /** When only a day is given. Gmail's snooze uses 8. */
  defaultHour?: number;
  /** Read 10/11 as 10 November. */
  dayFirst?: boolean;
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, couple: 2, few: 3,
};

const PARTS: Record<string, number> = { morning: 8, afternoon: 13, evening: 18, tonight: 20, night: 20, noon: 12, midday: 12, midnight: 0, eod: 17 };

const TOMORROW = new Set(['tomorrow', 'tom', 'tmr', 'tmrw', 'tomo', 'tomorow', 'tommorow', 'tommorrow']);

interface Time {
  h: number;
  m: number;
}

interface Day {
  /** A calendar date, local. */
  y: number;
  mo: number;
  d: number;
  /** A date already gone this year means next year. */
  yearless?: boolean;
}

/** "9", "9am", "9:30", "9.30pm", "21:00", "noon". Bare 1 to 6 read as afternoon, the way people mean it. */
function readTime(words: string[]): { time: Time; used: number } | null {
  const [a, b] = words;
  if (!a) return null;
  if (a in PARTS && a !== 'tonight') return { time: { h: PARTS[a]!, m: 0 }, used: 1 };
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/.exec(a);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  let suffix = m[3];
  let used = 1;
  if (!suffix && (b === 'am' || b === 'pm' || b === 'a.m.' || b === 'p.m.')) {
    suffix = b[0];
    used = 2;
  }
  if (min > 59) return null;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    const pm = suffix.startsWith('p');
    h = (h % 12) + (pm ? 12 : 0);
  } else if (m[2] === undefined) {
    // A bare number: 7 to 11 morning, 12 noon, 1 to 6 afternoon, 13 to 23 as written.
    if (h > 23) return null;
    if (h >= 1 && h <= 6) h += 12;
  } else if (h > 23) return null;
  return { time: { h, m: min }, used };
}

function dayOf(date: Date): Day {
  return { y: date.getFullYear(), mo: date.getMonth(), d: date.getDate() };
}

function addDays(day: Day, n: number): Day {
  return dayOf(new Date(day.y, day.mo, day.d + n));
}

function validDate(y: number, mo: number, d: number) {
  const t = new Date(y, mo, d);
  return t.getFullYear() === y && t.getMonth() === mo && t.getDate() === d;
}

function readDay(words: string[], now: Date, dayFirst: boolean): { day: Day; used: number; part?: number } | null {
  const today = dayOf(now);
  const [a, b, c] = words;
  if (!a) return null;
  if (a === 'today') return { day: today, used: 1 };
  if (a === 'tonight') return { day: today, used: 1, part: PARTS.tonight };
  if (TOMORROW.has(a)) return { day: addDays(today, 1), used: 1 };
  if (a === 'day' && b === 'after' && c && TOMORROW.has(c)) return { day: addDays(today, 2), used: 3 };
  if (a === 'weekend' || ((a === 'this' || a === 'next') && b === 'weekend')) {
    // Saturday morning. On a weekend, "this weekend" is already the next one.
    const dow = now.getDay();
    const coming = dow === 6 ? 7 : 6 - dow;
    const offset = a === 'next' && dow >= 1 && dow <= 5 ? coming + 7 : coming;
    return { day: addDays(today, offset), used: a === 'weekend' ? 1 : 2 };
  }
  if (a === 'next' && b === 'week') {
    const toMon = (8 - now.getDay()) % 7 || 7;
    return { day: addDays(today, toMon), used: 2 };
  }
  if (a === 'later' && b === 'this' && c === 'week') return { day: addDays(today, 2), used: 3 };
  if (a === 'next' && b === 'month') return { day: dayOf(new Date(now.getFullYear(), now.getMonth() + 1, 1)), used: 2 };
  if (a === 'next' && b && b in WEEKDAYS) {
    // The named day in the week after this one (weeks start on Monday).
    const target = WEEKDAYS[b]!;
    const dow = now.getDay();
    const ahead = (target - dow + 7) % 7 || 7;
    const daysLeftInWeek = (7 - dow) % 7; // to Sunday
    return { day: addDays(today, ahead <= daysLeftInWeek ? ahead + 7 : ahead), used: 2 };
  }
  const named = a === 'this' || a === 'on' ? b : a;
  if (named && named in WEEKDAYS) {
    const target = WEEKDAYS[named]!;
    const ahead = (target - now.getDay() + 7) % 7 || 7;
    return { day: addDays(today, ahead), used: named === a ? 1 : 2 };
  }
  // "oct 20", "october 20th 2027", "20 oct".
  const ord = (s: string | undefined) => (s ? /^(\d{1,2})(st|nd|rd|th)?,?$/.exec(s) : null);
  const year = (s: string | undefined) => (s && /^\d{4}$/.test(s) ? Number(s) : undefined);
  if (a in MONTHS) {
    const dm = ord(b);
    if (!dm) return null;
    const y = year(c);
    const mo = MONTHS[a]!;
    const d = Number(dm[1]);
    const yy = y ?? today.y;
    if (!validDate(yy, mo, d)) return null;
    return { day: { y: yy, mo, d, yearless: y === undefined }, used: y ? 3 : 2 };
  }
  const dm = ord(a);
  if (dm && b && b in MONTHS) {
    const y = year(c);
    const mo = MONTHS[b]!;
    const d = Number(dm[1]);
    const yy = y ?? today.y;
    if (!validDate(yy, mo, d)) return null;
    return { day: { y: yy, mo, d, yearless: y === undefined }, used: y ? 3 : 2 };
  }
  // 2026-10-20
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(a);
  if (iso) {
    const [y, mo, d] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
    return validDate(y, mo, d) ? { day: { y, mo, d }, used: 1 } : null;
  }
  // 10/20, 10/20/2027, 20.10.
  const slash = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?\.?$/.exec(a);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const [mo, d] = dayFirst ? [second - 1, first] : [first - 1, second];
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : today.y;
    if (!validDate(y, mo, d)) return null;
    return { day: { y, mo, d, yearless: !slash[3] }, used: 1 };
  }
  return null;
}

const UNITS: [RegExp, number][] = [
  [/^(m|min|mins|minute|minutes)$/, 60_000],
  [/^(h|hr|hrs|hour|hours)$/, 3_600_000],
  [/^(d|day|days)$/, 0],
  [/^(w|wk|wks|week|weeks)$/, -1],
  [/^(mo|mos|month|months)$/, -2],
];

/** "in 3 days", "3d", "2 hours", "a week". */
function readRelative(words: string[], now: Date, defaultHour: number): { at: number; used: number; byDay: boolean } | null {
  let i = words[0] === 'in' ? 1 : 0;
  let n: number | undefined;
  let unitWord: string | undefined;
  const glued = /^(\d+)([a-z]+)$/.exec(words[i] ?? '');
  if (glued) {
    n = Number(glued[1]);
    unitWord = glued[2];
    i += 1;
  } else {
    const w = words[i];
    if (w === undefined) return null;
    n = /^\d+$/.test(w) ? Number(w) : NUMBERS[w];
    if (words[i + 1] === 'of' && w === 'couple') i += 1;
    unitWord = words[i + 1];
    i += 2;
  }
  if (n === undefined || !unitWord || n <= 0 || n > 1000) return null;
  const unit = UNITS.find(([re]) => re.test(unitWord!));
  if (!unit) return null;
  const [, ms] = unit;
  if (ms > 0) {
    // Minutes and hours count from now.
    const at = new Date(now.getTime() + n * ms);
    at.setSeconds(0, 0);
    return { at: at.getTime(), used: i, byDay: false };
  }
  // Days, weeks and months land on a calendar day at the default hour.
  const days = ms === 0 ? n : ms === -1 ? n * 7 : 0;
  const t = ms === -2 ? new Date(now.getFullYear(), now.getMonth() + n, now.getDate(), defaultHour) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, defaultHour);
  return { at: t.getTime(), used: i, byDay: true };
}

const FILLER = new Set(['at', 'on', 'until', 'till', 'til', 'for', 'by', 'me', 'remind', 'snooze', 'to', '@', 'the']);

function words(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/(\d)\s*(am|pm)\b/g, '$1$2')
    .split(/\s+/)
    .filter(Boolean);
}

/** Null when it isn't a time. */
export function parseWhen(input: string, now: Date, options: WhenOptions = {}): When | null {
  const defaultHour = options.defaultHour ?? 8;
  const dayFirst = options.dayFirst ?? false;
  const all = words(input);
  if (!all.length) return null;

  // "later": six in the evening, or three hours on once that's close.
  const joined = all.filter((w) => !FILLER.has(w)).join(' ');
  if (joined === 'later' || joined === 'later today') {
    const t = new Date(now);
    if (now.getHours() < 17) t.setHours(18, 0, 0, 0);
    else {
      // Up to the next whole hour on the local clock (not UTC's: India is on the half hour).
      t.setTime(now.getTime() + 3 * 3_600_000);
      if (t.getMinutes() || t.getSeconds() || t.getMilliseconds()) t.setHours(t.getHours() + 1, 0, 0, 0);
    }
    return { at: t.getTime(), past: false };
  }

  const lead = all.filter((w, i) => (i === 0 && w === 'in') || !FILLER.has(w));
  const relative = readRelative(lead, now, defaultHour);
  if (relative) {
    const rest = lead.slice(relative.used);
    if (!rest.length) return { at: relative.at, past: false };
    // "in 3 days 9am": that day at that time. Hours and minutes take no time of day.
    const time = relative.byDay ? readTime(rest) : null;
    if (!time || time.used !== rest.length) return null;
    const t = new Date(relative.at);
    t.setHours(time.time.h, time.time.m, 0, 0);
    return { at: t.getTime(), past: t.getTime() <= now.getTime() };
  }

  const list = all.filter((w) => !FILLER.has(w) || w === 'on');
  let day: Day | undefined;
  let time: Time | undefined;
  let part: number | undefined;
  let i = 0;
  while (i < list.length) {
    const w = list[i]!;
    if (w === 'on') {
      i += 1;
      continue;
    }
    if (!day) {
      const d = readDay(list.slice(i), now, dayFirst);
      if (d) {
        day = d.day;
        part = d.part;
        i += d.used;
        continue;
      }
    }
    if (!time) {
      const t = readTime(list.slice(i));
      if (t) {
        time = t.time;
        i += t.used;
        continue;
      }
    }
    return null;
  }
  if (!day && !time) return null;

  if (!day) {
    // A time alone is the next time the clock shows it.
    const t = new Date(now);
    t.setHours(time!.h, time!.m, 0, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    return { at: t.getTime(), past: false };
  }
  const hm = time ?? { h: part ?? defaultHour, m: 0 };
  let at = new Date(day.y, day.mo, day.d, hm.h, hm.m, 0, 0).getTime();
  if (day.yearless && at <= now.getTime() && new Date(day.y, day.mo, day.d).getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    at = new Date(day.y + 1, day.mo, day.d, hm.h, hm.m, 0, 0).getTime();
  }
  return { at, past: at <= now.getTime() };
}

/** 10/11 as 10 November. */
export function localeDayFirst(locale?: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2026, 10, 10));
    return parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month');
  } catch {
    return false;
  }
}
