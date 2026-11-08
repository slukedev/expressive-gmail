import type { Address } from '../data/types';

const DAY = 86_400_000;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Every row formats dates on each render, and toLocaleString builds a new formatter per call.
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
const FULL = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long' });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** "9:41 AM" today, "Aug 29" this year, "8/29/24" before, like Gmail's list. */
export function listDate(t: number, now = Date.now()): string {
  const d = new Date(t);
  const n = new Date(now);
  if (startOfDay(t) === startOfDay(now)) return TIME.format(d);
  if (d.getFullYear() === n.getFullYear()) return MONTH_DAY.format(d);
  return SHORT_DATE.format(d);
}

/** For tooltips: "Tue, Oct 7, 2026, 9:41 AM". */
export function fullDate(t: number): string {
  return FULL.format(t);
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
// Gmail headers say "1 day ago", never "yesterday".
const rtfDays = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }) : null;

/** "(12 minutes ago)". */
export function relative(t: number, now = Date.now()): string {
  const diff = t - now;
  const abs = Math.abs(diff);
  if (!rtf) return '';
  if (abs < 45_000) return 'just now';
  // Round first, then pick the unit, so 59m40s reads "1 hour ago".
  const sign = Math.sign(diff);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return rtf.format(sign * minutes, 'minute');
  const hours = Math.round(abs / 3_600_000);
  if (hours < 24) return rtf.format(sign * hours, 'hour');
  const days = Math.round(abs / DAY);
  if (days < 30) return rtfDays!.format(sign * days, 'day');
  const months = Math.round(abs / (30 * DAY));
  if (months < 12) return rtf.format(sign * months, 'month');
  return rtf.format(sign * Math.max(1, Math.round(abs / (365 * DAY))), 'year');
}

/** "9:41 AM (2 hours ago)" today, "Oct 3, 2026, 4:12 PM (5 days ago)" before. */
export function messageDate(t: number, now = Date.now()): string {
  const d = new Date(t);
  const sameDay = startOfDay(t) === startOfDay(now);
  const main = sameDay
    ? TIME.format(d)
    : DATE_TIME.format(d);
  return `${main} (${relative(t, now)})`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${kb} KB`;
  const mb = bytes / (1024 * 1024);
  const oneDecimal = Math.round(mb * 10) / 10;
  return oneDecimal < 10 ? `${oneDecimal.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Your address, or every address that's yours (send-as aliases, every account in a merged inbox). */
export type Me = string | readonly string[] | undefined;

export function isMe(email: string, me: Me): boolean {
  if (!me) return false;
  const e = email.toLowerCase();
  return typeof me === 'string' ? me.toLowerCase() === e : me.some((m) => m.toLowerCase() === e);
}

export function displayName(a: Address, myEmail?: Me): string {
  if (isMe(a.email, myEmail)) return 'me';
  if (a.name) return a.name;
  return a.email.split('@')[0];
}

export function firstName(a: Address, myEmail?: Me): string {
  const name = displayName(a, myEmail);
  if (name === 'me') return name;
  return a.name ? name.split(/\s+/)[0] : name;
}

/** One sender shows the full name; several show first names ("Ana, me, Jordan"), keeping the first and last when long. */
export function participantsLine(participants: Address[], myEmail?: Me): string {
  if (!participants.length) return '(no sender)';
  if (participants.length === 1) return displayName(participants[0], myEmail);
  const names = [...new Set(participants.map((p) => firstName(p, myEmail)))];
  if (names.length === 1) return displayName(participants[0], myEmail);
  if (names.length <= 3) return names.join(', ');
  return `${names[0]} .. ${names.slice(-2).join(', ')}`;
}

export function addressList(list: Address[], myEmail?: Me): string {
  return list.map((a) => displayName(a, myEmail)).join(', ');
}

/** "Ana <ana@x.com>, bo@y.com"; separators inside quotes or angle brackets don't split. */
export function parseAddresses(input: string): Address[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;
  for (const ch of input) {
    if (ch === '"' && !angled) quoted = !quoted;
    else if (ch === '<' && !quoted) angled = true;
    else if (ch === '>' && !quoted) angled = false;
    if ((ch === ',' || ch === ';') && !quoted && !angled) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  const out: Address[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const angle = part.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
    if (angle) {
      const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
      out.push({ name: name || undefined, email: angle[2] });
      continue;
    }
    const bare = part.match(/[^\s<>,;"]+@[^\s<>,;"]+/);
    if (bare) out.push({ email: bare[0] });
  }
  return out;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** 0 for Sunday; Monday where the browser can't say. */
let weekStart: { lang: string; day: number } | undefined;
export function weekStartDay(): number {
  // Asked for every row; the answer only changes with the language.
  if (weekStart?.lang !== navigator.language) weekStart = { lang: navigator.language, day: readWeekStart() };
  return weekStart.day;
}

function readWeekStart(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const first = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
    if (first) return first % 7;
  } catch {
    // Older engines: fall through.
  }
  return 1;
}

/** Inbox by Gmail's sections: Today, Yesterday, This week, This month, then month names (with the year once it isn't this year). */
export function dateGroup(t: number, now = Date.now(), weekStart = weekStartDay()): string {
  const day = startOfDay(t);
  const today = startOfDay(now);
  if (day >= today) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day >= yesterday.getTime()) return 'Yesterday';
  const week = new Date(today);
  week.setDate(week.getDate() - ((week.getDay() - weekStart + 7) % 7));
  if (day >= week.getTime()) return 'This week';
  const d = new Date(t);
  const n = new Date(now);
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return 'This month';
  return (d.getFullYear() === n.getFullYear() ? MONTH : MONTH_YEAR).format(d);
}
