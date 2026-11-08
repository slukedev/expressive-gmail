/** Matching Gmail's. */
export interface TimePreset {
  id: string;
  label: string;
  at: number;
}

function at(base: Date, days: number, hour: number, minute = 0) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export function snoozePresets(now = new Date()): TimePreset[] {
  const out: TimePreset[] = [];
  const hour = now.getHours();
  if (hour < 17) out.push({ id: 'later', label: 'Later today', at: at(now, 0, 18) });
  out.push({ id: 'tomorrow', label: 'Tomorrow', at: at(now, 1, 8) });
  const day = now.getDay();
  // Two days out, unless that runs into the weekend.
  if (day >= 1 && day <= 3) out.push({ id: 'week', label: 'Later this week', at: at(now, 2, 8) });
  if (day !== 6 && day !== 0) out.push({ id: 'weekend', label: 'This weekend', at: at(now, 6 - day, 8) });
  const toMonday = ((8 - day) % 7) || 7;
  out.push({ id: 'next-week', label: 'Next week', at: at(now, toMonday, 8) });
  // On Friday "Tomorrow" and "This weekend" land on the same Saturday; keep "Tomorrow".
  const tomorrow = out.find((p) => p.id === 'tomorrow')!.at;
  return out.filter((p) => p.id !== 'weekend' || p.at !== tomorrow);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 0 = Sunday: the locale's first weekday, or the first after it that isn't weekend (Sunday where the weekend is Friday and Saturday). */
export function workweekStart(lang = typeof navigator === 'undefined' ? 'en-US' : navigator.language): number {
  try {
    const loc = new Intl.Locale(lang) as Intl.Locale & {
      weekInfo?: { firstDay: number; weekend?: number[] };
      getWeekInfo?: () => { firstDay: number; weekend?: number[] };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) {
      const weekend = new Set(info.weekend ?? [6, 7]);
      for (let i = 0; i < 7; i++) {
        const day = ((info.firstDay - 1 + i) % 7) + 1;
        if (!weekend.has(day)) return day % 7;
      }
    }
  } catch {
    // Older engines: fall through.
  }
  return 1;
}

/** Gmail calls a time a minute or so away invalid. */
export const SCHEDULE_LEAD_MS = 5 * 60_000;

/** Gmail's menu: tomorrow at 8 AM and 1 PM, and 8 AM at the next work week start (dropped when that's tomorrow). Wall clock, so DST still lands on 8:00. */
export function schedulePresets(now = new Date(), weekStart = workweekStart()): TimePreset[] {
  const toStart = ((weekStart - now.getDay() + 7) % 7) || 7;
  return [
    { id: 'tomorrow-am', label: 'Tomorrow morning', at: at(now, 1, 8) },
    { id: 'tomorrow-pm', label: 'Tomorrow afternoon', at: at(now, 1, 13) },
    { id: 'week-start', label: `${WEEKDAYS[weekStart]} morning`, at: at(now, toStart, 8) },
  ].filter((p, i, all) => all.findIndex((x) => x.at === p.at) === i);
}

export function reminderPresets(now = new Date()): TimePreset[] {
  return [
    { id: '1d', label: 'In 1 day', at: at(now, 1, now.getHours(), now.getMinutes()) },
    { id: '3d', label: 'In 3 days', at: at(now, 3, 9) },
    { id: '1w', label: 'In 1 week', at: at(now, 7, 9) },
  ];
}

// A formatter per call costs more than the menu.
const WEEKDAY_TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const DAY_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const FULL = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function presetTime(t: number, now = new Date()): string {
  const d = new Date(t);
  const sameWeek = t - now.getTime() < 6 * 86_400_000;
  return sameWeek
    ? WEEKDAY_TIME.format(d)
    : DAY_TIME.format(d);
}

const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const WEEKDAY_DATE = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

// Built from a date and a time so every engine says "Oct 14, 8:00 AM" (Safari's own join is "Oct 14 at 8:00 AM").
/** As Gmail's schedule menu lists its presets. */
export function scheduleTime(t: number): string {
  return `${MONTH_DAY.format(t)}, ${TIME.format(t)}`;
}

/** "Tue, Oct 14, 8:00 AM". */
export function fullTime(t: number): string {
  return `${WEEKDAY_DATE.format(t)}, ${TIME.format(t)}`;
}

export function describeTime(t: number, now = new Date()): string {
  const d = new Date(t);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = TIME.format(d);
  if (d.toDateString() === now.toDateString()) return `today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow, ${time}`;
  return FULL.format(d);
}
