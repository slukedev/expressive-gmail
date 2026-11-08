/** One package seen across many emails ("Shipped", "Out for delivery", "Delivered"), each an event on one record keyed by tracking number (or order number). Pure; trackingStore.ts keeps the records. */
import type { PackageInfo, PackageStatus } from './extract';
import { PACKAGE_MAX_AGE } from './freshness';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface TrackingEvent {
  status: PackageStatus;
  /** When the email saying it arrived. */
  at: number;
  /** Without an account prefix. */
  threadId: string;
  /** Lowercased, when known. */
  account?: string;
  /** The sender's display name. */
  from?: string;
  eta?: string;
  /** Set by hand; `threadId` is empty. */
  manual?: true;
  /** Linked by "Add to Packages", not found by the extractor. */
  added?: true;
}

export interface TrackingRecord {
  key: string;
  /** 'email': tracked by hand with no number to search for, keyed by its email. */
  kind: 'tracking' | 'order' | 'email';
  /** As an email wrote it ("PP 4419 2086 7731 US"). */
  ref: string;
  carrier?: string;
  merchant?: string;
  trackUrl?: string;
  events: TrackingEvent[];
  /** When we last searched mail for this number. */
  checkedAt?: number;
  /** Holds until an email newer than it moves the package on. */
  manual?: { status: PackageStatus; at: number };
  /** Remove from Packages deletes it. */
  userAdded?: true;
  addedAt?: number;
}

/** Case-folded, so "pp 4419-2086" and "PP44192086" are the same number. */
export function compactRef(s: string): string {
  return s.replace(/[\s-]+/g, '').toUpperCase();
}

/** Its tracking number, else the order number. Short order numbers ("12345") are too common to trust. */
export function referenceKey(info: Pick<PackageInfo, 'tracking' | 'orderNo'>): string | undefined {
  if (info.tracking && compactRef(info.tracking).length >= 8) return `T:${compactRef(info.tracking)}`;
  if (info.orderNo && compactRef(info.orderNo).length >= 6) return `O:${compactRef(info.orderNo)}`;
  return undefined;
}

const STAGE: Record<PackageStatus, number> = { ordered: 0, shipped: 1, 'out-for-delivery': 2, delivered: 3, problem: -1 };

/** Newest news wins, but a package never goes backwards: a late "Shipped" can't undo "Delivered". A problem always counts, and anything after it replaces it. */
export function latestEvent(events: readonly TrackingEvent[]): TrackingEvent | undefined {
  let current: TrackingEvent | undefined;
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (!current || e.status === 'problem' || current.status === 'problem' || STAGE[e.status] >= STAGE[current.status]) current = e;
  }
  return current;
}

/** A hand-set status wins over every email before it; a later email takes over only if it moves the package on (or reports a problem). `extra` adds events not in the record yet. */
export function currentEvent(record: Pick<TrackingRecord, 'events' | 'manual'> | undefined, extra: readonly TrackingEvent[] = []): TrackingEvent | undefined {
  const events = [...(record?.events ?? []), ...extra];
  const manual = record?.manual;
  if (!manual) return latestEvent(events);
  const set: TrackingEvent = { status: manual.status, at: manual.at, threadId: '', manual: true };
  return latestEvent([set, ...events.filter((e) => e.at > manual.at)]);
}

/** Null goes back to what the emails say. */
export function setManual(record: TrackingRecord, status: PackageStatus | null, now: number): TrackingRecord {
  if (status === null) {
    const { manual: _drop, ...rest } = record;
    void _drop;
    return rest;
  }
  return { ...record, manual: { status, at: now } };
}

/** An email, a hand-set status, or starting to track it. */
function touchedAt(record: TrackingRecord): number {
  return Math.max(lastHeard(record), record.manual?.at ?? 0, record.addedAt ?? 0);
}

/** Newest first, from the first email that said each step. The current step leads even when an older-stage email came in later. */
export function timeline(events: readonly TrackingEvent[], manual?: TrackingRecord['manual']): TrackingEvent[] {
  const latest = currentEvent({ events: [...events], manual });
  // A hand-set status replaces what older emails claimed past it.
  if (latest?.manual) events = [...events.filter((e) => e.status !== latest.status && (e.at > latest.at || e.status === 'problem' || STAGE[e.status] < STAGE[latest.status])), latest];
  const first = new Map<PackageStatus, TrackingEvent>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) if (!first.has(e.status)) first.set(e.status, e);
  return [...first.values()].sort((a, b) => Number(b.status === latest?.status) - Number(a.status === latest?.status) || b.at - a.at);
}

const MAX_EVENTS = 12;

/** One event per thread and status, at the first email that said it. */
export function addEvents(record: TrackingRecord, events: readonly TrackingEvent[]): TrackingRecord {
  const byId = new Map(record.events.map((e) => [`${e.threadId}|${e.status}`, e]));
  let changed = false;
  for (const e of events) {
    const id = `${e.threadId}|${e.status}`;
    const had = byId.get(id);
    if (had && had.at <= e.at && (had.eta || !e.eta)) continue;
    byId.set(id, had ? { ...had, at: Math.min(had.at, e.at), eta: had.eta ?? e.eta, from: had.from ?? e.from, account: had.account ?? e.account } : e);
    changed = true;
  }
  if (!changed) return record;
  const next = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
  return { ...record, events: next };
}

export function lastHeard(record: TrackingRecord): number {
  return record.events.reduce((max, e) => Math.max(max, e.at), 0);
}

/** By where the package was. Delivered is final. */
export const SEARCH_TTL: Record<Exclude<PackageStatus, 'delivered'>, number> = {
  'out-for-delivery': 20 * MINUTE,
  problem: 2 * HOUR,
  shipped: 4 * HOUR,
  ordered: 8 * HOUR,
};

export const SEARCH_LIMITS = {
  perSession: 12,
  perHour: 8,
};

/** Ignoring the budget. `history` is for an open card wanting the whole story: a delivered package never searched gets that one search. */
export function searchDue(record: TrackingRecord, now: number, history = false): boolean {
  if (record.kind === 'email') return false;
  const latest = currentEvent(record);
  if (!latest) return false;
  if (now - touchedAt(record) > PACKAGE_MAX_AGE) return false;
  if (latest.status === 'delivered') return history && record.checkedAt === undefined;
  if (record.checkedAt === undefined) return true;
  return now - record.checkedAt >= SEARCH_TTL[latest.status];
}

/** A cap per tab session and one shared across tabs per rolling hour. */
export function budgetLeft(recent: readonly number[], sessionCount: number, now: number): boolean {
  if (sessionCount >= SEARCH_LIMITS.perSession) return false;
  return recent.filter((t) => now - t < HOUR && t <= now).length < SEARCH_LIMITS.perHour;
}

/** Quoted, both as the email wrote it and without spaces. */
export function searchQuery(record: TrackingRecord): string {
  const forms = [...new Set([record.ref.trim(), compactRef(record.ref)])].filter((f) => f && !f.includes('"'));
  return forms.map((f) => `"${f}"`).join(' OR ');
}

/** In any spacing. */
export function mentions(compactText: string, record: TrackingRecord): boolean {
  return record.kind !== 'email' && compactText.includes(record.key.slice(2));
}

/** Heard from in the last 90 days, newest 150. */
export function prune(records: Record<string, TrackingRecord>, now: number): Record<string, TrackingRecord> {
  const kept = Object.values(records)
    .filter((r) => now - touchedAt(r) <= 90 * DAY)
    .sort((a, b) => touchedAt(b) - touchedAt(a))
    .slice(0, 150);
  return Object.fromEntries(kept.map((r) => [r.key, r]));
}
