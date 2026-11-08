/** When something in your mail stops being worth a look, by the dates in the email itself (an estimate, a due date, the event's day) and when it arrived. Null when stale, else a rank: lower comes first on At a glance. */
import type { PackageStatus } from './extract';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What needs you soonest first. */
export const RANK = {
  code: 0,
  problem: 1,
  arriving: 2,
  billUrgent: 3,
  inviteSoon: 4,
  late: 5,
  bill: 6,
  invite: 7,
  deliveredToday: 8,
  inTransit: 9,
  nudge: 10,
} as const;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 0 today, 1 tomorrow, -1 yesterday. */
export function daysFrom(ms: number, now: number): number {
  return Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
}

const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec';
// Whole month names or their short forms only, so "market 12" is not March.
const MONTH_DAY =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:%|am|pm|kb|mb))(?:,?\s+(\d{4}))?/;

/** A year-less date read near New Year belongs to the closer year. */
function nearYear(month: number, today: Date): number {
  let year = today.getFullYear();
  if (month - today.getMonth() > 6) year -= 1;
  if (today.getMonth() - month > 6) year += 1;
  return year;
}

/** "Tuesday, October 6", "Oct 20, 2026", "10/20", "2026-10-20", "today", "tomorrow", as local midnight. A time or range of times alone isn't a date. */
export function parseDay(text: string | undefined, now: number): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const today = new Date(startOfDay(now));
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]).getTime();
  const named = MONTH_DAY.exec(t);
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3)) / 3;
    const year = named[3] ? +named[3] : nearYear(month, today);
    return new Date(year, month, +named[2]).getTime();
  }
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/.exec(t);
  if (numeric && +numeric[1] >= 1 && +numeric[1] <= 12 && +numeric[2] >= 1 && +numeric[2] <= 31) {
    const month = +numeric[1] - 1;
    const year = numeric[3] ? (numeric[3].length === 2 ? 2000 + +numeric[3] : +numeric[3]) : nearYear(month, today);
    return new Date(year, month, +numeric[2]).getTime();
  }
  if (/\b(today|tonight)\b/.test(t)) return today.getTime();
  if (/\btomorrow\b/.test(t)) return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  return null;
}

export interface PackageFacts {
  status: PackageStatus;
  /** The newest email about this package. */
  updatedAt: number;
  /** As the email wrote it. */
  eta?: string;
}

/** Past this, a package email is history whatever it says. */
export const PACKAGE_MAX_AGE = 30 * DAY;
/** A shipment with no estimate and no news for this long has almost always arrived. */
const SHIPPED_QUIET = 10 * DAY;
/** An estimate this many days gone with no news means we missed the delivery email. */
const LATE_GRACE_DAYS = 3;

export interface PackageRelevance {
  rank: number;
  /** Not delivered and its estimate came and went. */
  late: boolean;
}

export function packageRelevance(p: PackageFacts, now: number): PackageRelevance | null {
  const age = now - p.updatedAt;
  if (age > PACKAGE_MAX_AGE) return null;
  const since = -daysFrom(p.updatedAt, now);
  switch (p.status) {
    case 'delivered':
      // Good to know the day it lands; after that it's done.
      return since === 0 ? { rank: RANK.deliveredToday, late: false } : null;
    case 'out-for-delivery':
      // Carriers don't always send "Delivered"; by the next day it's arrived or it's a problem.
      if (since === 0) return { rank: RANK.arriving, late: false };
      return since === 1 ? { rank: RANK.inTransit, late: false } : null;
    case 'problem':
      return age <= 7 * DAY ? { rank: RANK.problem, late: false } : null;
    case 'ordered':
    case 'shipped': {
      const eta = parseDay(p.eta, now);
      if (eta !== null) {
        const until = daysFrom(eta, now);
        if (until < -LATE_GRACE_DAYS) return null;
        if (until < 0) return { rank: RANK.late, late: true };
        return { rank: until === 0 ? RANK.arriving : RANK.inTransit, late: false };
      }
      return age <= (p.status === 'ordered' ? 7 * DAY : SHIPPED_QUIET) ? { rank: RANK.inTransit, late: false } : null;
    }
  }
}

/** One-time codes are dead in minutes. */
const CODE_FRESH = 20 * MINUTE;

/** The email's own lifetime ("expires in 10 minutes"), else 20 minutes, never more than an hour. */
export function codeRelevance(c: { receivedAt: number; text?: string }, now: number): { rank: number } | null {
  const said = /\b(?:expires?|valid|good)\s+(?:in|for)\s+(\d{1,3})\s*(?:min|minutes?)\b/i.exec(c.text ?? '');
  const life = said ? Math.min(Number(said[1]) * MINUTE, HOUR) : CODE_FRESH;
  const age = now - c.receivedAt;
  return age >= 0 && age <= life ? { rank: RANK.code } : null;
}

export interface BillFacts {
  receivedAt: number;
  /** Subject and preview, or the body when at hand. */
  text: string;
  /** When read from a labelled field. */
  due?: string;
}

const PAID = /\b(payment (?:received|processed|confirmed|scheduled|successful)|thank(?:s| you) for (?:your )?payment|we(?:'ve| have) received your payment|paid in full|has been paid)\b/i;
const AUTOPAY = /\b(auto-?pay|automatic payment)\b(?!\s*(?:is\s*)?off)/i;

export interface BillRelevance {
  rank: number;
  /** Local midnight. */
  dueDay?: number;
}

export function billRelevance(b: BillFacts, now: number): BillRelevance | null {
  if (PAID.test(b.text)) return null;
  const age = now - b.receivedAt;
  const dueText = b.due ?? /\b(?:due|payment due|due date|due by|due on)\b:?\s*(?:by|on)?\s*([^\n.]{3,40})/i.exec(b.text)?.[1];
  const dueDay = parseDay(dueText, now) ?? undefined;
  // Autopay pays it; the amount is worth a glance the day or two it arrives.
  if (AUTOPAY.test(b.text)) return age <= 2 * DAY ? { rank: RANK.bill, dueDay } : null;
  if (dueDay !== undefined) {
    const until = daysFrom(dueDay, now);
    // A week past due and nothing new: it was paid somewhere we can't see.
    if (until < -7) return null;
    if (until <= 2) return { rank: RANK.billUrgent, dueDay };
    return age <= 14 * DAY || until <= 7 ? { rank: RANK.bill, dueDay } : null;
  }
  return age <= 10 * DAY ? { rank: RANK.bill } : null;
}

export interface InviteFacts {
  receivedAt: number;
  subject: string;
  snippet: string;
  unread: boolean;
}

export interface InviteRelevance {
  rank: number;
  /** Local midnight, when the invite says. */
  day?: number;
}

/** Unanswered-looking invites for events still ahead; past events drop the day after. */
export function inviteRelevance(i: InviteFacts, now: number): InviteRelevance | null {
  if (!i.unread) return null;
  if (/^(?:invitation|event) (?:cancel+ed|canceled)|^cancel+ed (?:event|invitation)/i.test(i.subject)) return null;
  const day = parseDay(i.subject.split(/\s+@\s+/)[1], now) ?? parseDay(i.snippet, now) ?? undefined;
  if (day !== undefined) {
    const until = daysFrom(day, now);
    if (until < 0) return null;
    return { rank: until <= 1 ? RANK.inviteSoon : RANK.invite, day };
  }
  return now - i.receivedAt <= 7 * DAY ? { rank: RANK.invite } : null;
}
