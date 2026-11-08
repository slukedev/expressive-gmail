/** Package records kept in this browser, so a "Shipped" email can show the carrier has since said "Delivered". They fill from mail already loaded (the query cache and the watcher's inbox polls), then from a search for the exact number, rationed by status and an hourly budget shared between tabs. Delivered packages are never searched again. */
import { useEffect } from 'react';
import { create } from 'zustand';
import { backgroundSearch } from '../data/backgroundQueue';
import { threadAccount } from '../data/accounts/threads';
import { rawId } from '../data/accounts/ids';
import { backend, keys, queryClient } from '../data/client';
import type { Thread, ThreadSummary } from '../data/types';
import { readKey, removeKey, watchKey, writeKey } from '../state/storage';
import { analyzeMessage, packageStatus, senderName, type PackageInfo, type PackageStatus } from './extract';
import { PACKAGE_MAX_AGE } from './freshness';
import {
  addEvents,
  budgetLeft,
  compactRef,
  lastHeard,
  currentEvent,
  setManual,
  mentions,
  prune,
  referenceKey,
  searchDue,
  searchQuery,
  SEARCH_TTL,
  type TrackingEvent,
  type TrackingRecord,
} from './tracking';

const KEY = 'bg.tracking.v1';
/** Emails older than this never start a record; Purchases reads a year back and most of it is long delivered. */
const INGEST_MAX_AGE = 2 * PACKAGE_MAX_AGE;
/** Cheap pre-check before reading a whole message. */
const SHIPPY = /\b(track|ship|deliver|order|package|parcel|arriv|dispatch|courier|out for)/i;

interface Saved {
  records: Record<string, TrackingRecord>;
  /** In the last hour, from every tab. */
  searches: number[];
}

interface TrackingState extends Saved {
  /** Raw thread id to record key. */
  byThread: Record<string, string>;
  /** With a search running in this tab. */
  checking: Record<string, true>;
}

const index = (records: Record<string, TrackingRecord>) => {
  const byThread: Record<string, string> = {};
  for (const r of Object.values(records)) for (const e of r.events) byThread[e.threadId] ??= r.key;
  return byThread;
};

export const useTracking = create<TrackingState>(() => ({ records: {}, searches: [], byThread: {}, checking: {} }));

let sessionSearches = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    const { records, searches } = useTracking.getState();
    const at = Date.now();
    writeKey(KEY, { records: prune(records, at), searches: searches.filter((t) => at - t < 3_600_000) } satisfies Saved).catch(() => undefined);
  };
  if (!started) return;
  if (now) write();
  else saveTimer = setTimeout(write, 400);
}

/** `now` writes at once: what a person sets by hand must survive a reload a moment later. */
function setRecords(records: Record<string, TrackingRecord>, now = false) {
  useTracking.setState({ records, byThread: index(records) });
  save(now);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function sanitize(v: unknown): Saved {
  if (!isRecord(v)) return { records: {}, searches: [] };
  const records: Record<string, TrackingRecord> = {};
  if (isRecord(v.records)) {
    for (const [k, r] of Object.entries(v.records)) {
      if (!isRecord(r) || typeof r.ref !== 'string' || !Array.isArray(r.events)) continue;
      const events = r.events.filter((e): e is TrackingEvent => isRecord(e) && typeof e.status === 'string' && typeof e.at === 'number' && typeof e.threadId === 'string');
      records[k] = { ...(r as unknown as TrackingRecord), key: k, events };
    }
  }
  const searches = Array.isArray(v.searches) ? v.searches.filter((t): t is number => typeof t === 'number') : [];
  return { records, searches };
}

/** What another tab (or an earlier session) knew, under what this tab has seen since. */
function mergeSaved(saved: Saved) {
  const state = useTracking.getState();
  const records = { ...saved.records };
  for (const r of Object.values(state.records)) {
    const other = records[r.key];
    records[r.key] = other ? { ...addEvents(other, r.events), checkedAt: Math.max(other.checkedAt ?? 0, r.checkedAt ?? 0) || undefined } : r;
  }
  const searches = [...new Set([...saved.searches, ...state.searches])];
  useTracking.setState({ records, searches, byThread: index(records) });
}

type Found = { key: string; info: PackageInfo; event: TrackingEvent };

function upsert(found: Found[]) {
  if (!found.length || !started) return;
  const records = { ...useTracking.getState().records };
  let changed = false;
  for (const { key, info, event } of found) {
    const had = records[key];
    const base: TrackingRecord = had ?? { key, kind: key.startsWith('T:') ? 'tracking' : 'order', ref: info.tracking ?? info.orderNo ?? key.slice(2), events: [] };
    const next = addEvents(
      { ...base, carrier: base.carrier ?? info.carrier, merchant: base.merchant ?? info.merchant, trackUrl: base.trackUrl ?? info.trackUrl },
      [event],
    );
    if (next !== base || !had || next.carrier !== had.carrier || next.merchant !== had.merchant || next.trackUrl !== had.trackUrl) {
      records[key] = next;
      changed = true;
    }
  }
  if (changed) setRecords(records);
}

const seenThreads = new Map<string, string>();

/** Every shipping message in a conversation. */
function ingestThread(thread: Thread | undefined, now = Date.now()) {
  if (!thread?.messages?.length || thread.labelIds.includes('SPAM') || thread.labelIds.includes('CATEGORY_PROMOTIONS')) return;
  const stamp = `${thread.messageCount}|${thread.lastDate}`;
  if (seenThreads.get(thread.id) === stamp) return;
  seenThreads.set(thread.id, stamp);
  if (seenThreads.size > 500) seenThreads.delete(seenThreads.keys().next().value!);
  const found: Found[] = [];
  const raw = rawId(thread.id);
  const account = threadAccount(thread.id);
  for (const m of thread.messages.slice(-10)) {
    if (m.isDraft || now - m.date > INGEST_MAX_AGE || !SHIPPY.test(`${m.subject} ${m.snippet}`)) continue;
    for (const info of analyzeMessage(m, thread.labelIds)) {
      if (info.kind !== 'package') continue;
      const key = referenceKey(info);
      if (!key) continue;
      found.push({ key, info, event: { status: info.status, at: m.date, threadId: raw, account, from: senderName(m.from), eta: info.eta } });
    }
  }
  upsert(found);
}

function summaryEvent(t: ThreadSummary): TrackingEvent | null {
  const status = packageStatus(t.subject) ?? packageStatus(t.snippet);
  if (!status) return null;
  const last = t.participants[t.participants.length - 1];
  return { status, at: t.lastDate, threadId: rawId(t.id), account: threadAccount(t.id), from: last ? senderName(last) : undefined };
}

const seenSummaries = new Map<string, number>();

/** List rows mentioning a tracked number update it without a search. */
export function ingestSummaries(threads: readonly ThreadSummary[], now = Date.now()) {
  const records = Object.values(useTracking.getState().records).filter((r) => now - lastHeard(r) <= PACKAGE_MAX_AGE);
  if (!records.length) return;
  const found: Found[] = [];
  for (const t of threads) {
    if (seenSummaries.get(t.id) === t.lastDate) continue;
    seenSummaries.set(t.id, t.lastDate);
    if (seenSummaries.size > 2000) seenSummaries.delete(seenSummaries.keys().next().value!);
    if (t.labelIds.includes('SPAM') || t.labelIds.includes('TRASH')) continue;
    const text = compactRef(`${t.subject} ${t.snippet}`);
    for (const r of records) {
      if (!mentions(text, r)) continue;
      const event = summaryEvent(t);
      if (event) found.push({ key: r.key, info: { kind: 'package', status: event.status }, event });
    }
  }
  upsert(found);
}

function summariesIn(data: unknown): ThreadSummary[] {
  if (!isRecord(data)) return [];
  if (Array.isArray(data.pages)) return data.pages.flatMap((p) => (isRecord(p) && Array.isArray(p.threads) ? (p.threads as ThreadSummary[]) : []));
  return Array.isArray(data.threads) ? (data.threads as ThreadSummary[]) : [];
}

/** When its status could still change and the budget allows. Search answers usually say enough in the subject; else the newest conversation is read in full. */
async function refreshTracking(key: string, history = false, now = Date.now()) {
  const state = useTracking.getState();
  const record = state.records[key];
  if (!started || !record || state.checking[key] || !searchDue(record, now, history) || !budgetLeft(state.searches, sessionSearches, now)) return;
  let b;
  try {
    b = backend();
  } catch {
    return;
  }
  if (typeof b.listThreads !== 'function') return;
  // Claim it before searching, and tell other tabs, so nobody asks twice.
  sessionSearches++;
  useTracking.setState((s) => ({
    searches: [...s.searches.filter((t) => now - t < 3_600_000), now],
    checking: { ...s.checking, [key]: true },
    records: { ...s.records, [key]: { ...s.records[key]!, checkedAt: now } },
  }));
  save(true);
  try {
    const latest = currentEvent(record);
    const threads = await backgroundSearch(searchQuery(record), {
      pageSize: 10,
      maxAgeMs: latest && latest.status !== 'delivered' ? SEARCH_TTL[latest.status] : undefined,
    });
    const known = new Set(record.events.map((e) => e.threadId));
    const found: Found[] = [];
    const unread: ThreadSummary[] = [];
    for (const t of threads) {
      if (now - t.lastDate > INGEST_MAX_AGE) continue;
      const event = summaryEvent(t);
      if (event) found.push({ key, info: { kind: 'package', status: event.status }, event });
      else if (!known.has(rawId(t.id))) unread.push(t);
    }
    upsert(found);
    const newest = unread.sort((a, b) => b.lastDate - a.lastDate)[0];
    if (newest) {
      const thread = await queryClient.fetchQuery({ queryKey: keys.thread(newest.id), queryFn: () => b.getThread(newest.id), staleTime: 5 * 60_000 });
      ingestThread(thread, now);
    }
  } catch {
    // Offline or throttled: the claim stands, so the next try waits out the TTL.
  } finally {
    useTracking.setState((s) => {
      const checking = { ...s.checking };
      delete checking[key];
      return { checking };
    });
  }
}

let started = false;
let halt: (() => void) | undefined;

/** Loads saved records and reads packages from everything the app fetches. Starting again while running shares the run. */
export function startTracking(): () => void {
  if (!started) {
    started = true;
    let live = true;
    void readKey<unknown>(KEY).then((v) => live && mergeSaved(sanitize(v)));
    const unwatch = watchKey(KEY, (v) => live && mergeSaved(sanitize(v)));
    const cache = queryClient.getQueryCache();
    const read = (queryKey: readonly unknown[], data: unknown) => {
      if (queryKey[0] === 'thread') ingestThread(data as Thread);
      else ingestSummaries(summariesIn(data));
    };
    for (const q of cache.getAll()) if (q.state.data) read(q.queryKey, q.state.data);
    const unsubscribe = cache.subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'success') read(e.query.queryKey, e.query.state.data);
    });
    halt = () => {
      live = false;
      started = false;
      halt = undefined;
      unwatch();
      unsubscribe();
      clearTimeout(saveTimer);
    };
  }
  return () => halt?.();
}

/** Deletes every record kept in this browser. */
export function clearTracking() {
  halt?.();
  seenThreads.clear();
  seenSummaries.clear();
  useTracking.setState({ records: {}, searches: [], byThread: {}, checking: {} });
  void removeKey(KEY);
}

/** A few at a time, when due. `history` (an open card) also fills in a delivered package's earlier steps, once. */
export function useRefreshTracking(keys: readonly (string | undefined)[], enabled = true, history = false) {
  const list = keys.filter((k): k is string => !!k).slice(0, 4).join('\n');
  useEffect(() => {
    if (!enabled || !list) return;
    let stopped = false;
    void (async () => {
      for (const key of list.split('\n')) {
        if (stopped) return;
        await refreshTracking(key, history);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [list, enabled, history]);
}

/** Undefined while nothing is known. */
export function useTrackingRecord(key: string | undefined): TrackingRecord | undefined {
  return useTracking((s) => (key ? s.records[key] : undefined));
}

/** Across every email about it. */
export function useThreadPackageStatus(threadId: string, enabled: boolean) {
  return useTracking((s) => {
    if (!enabled) return undefined;
    const key = s.byThread[rawId(threadId)];
    const record = key ? s.records[key] : undefined;
    return record ? currentEvent(record)?.status : undefined;
  });
}

function putRecord(record: TrackingRecord) {
  setRecords({ ...useTracking.getState().records, [record.key]: record }, true);
}

export function recordForThread(threadId: string): TrackingRecord | undefined {
  const { byThread, records } = useTracking.getState();
  const key = byThread[rawId(threadId)];
  return key ? records[key] : undefined;
}

/** Null goes back to what its emails say. A package with no record (an email with no number) gets one keyed by that email. Returns its key and the previous record, for Undo. */
export function setPackageStatus(
  key: string | undefined,
  status: PackageStatus | null,
  seed: { threadId: string; info: Pick<PackageInfo, 'status' | 'merchant' | 'carrier' | 'trackUrl' | 'tracking' | 'orderNo'>; at: number },
  now = Date.now(),
): { key: string; before: TrackingRecord | undefined } {
  const records = useTracking.getState().records;
  const raw = rawId(seed.threadId);
  const k = key ?? useTracking.getState().byThread[raw] ?? `M:${raw}`;
  const before = records[k];
  const base: TrackingRecord = before ?? {
    key: k,
    kind: k.startsWith('T:') ? 'tracking' : k.startsWith('O:') ? 'order' : 'email',
    ref: seed.info.tracking ?? seed.info.orderNo ?? '',
    merchant: seed.info.merchant,
    carrier: seed.info.carrier,
    trackUrl: seed.info.trackUrl,
    events: [{ status: seed.info.status, at: seed.at, threadId: raw, account: threadAccount(seed.threadId), from: seed.info.merchant }],
  };
  putRecord(setManual(base, status, now));
  return { key: k, before };
}

/** Undo; removes it when there was none. */
export function restoreRecord(key: string, before: TrackingRecord | undefined) {
  const records = { ...useTracking.getState().records };
  if (before) records[key] = before;
  else delete records[key];
  setRecords(records, true);
}

export interface OrderDraft {
  merchant: string;
  orderNo: string;
  tracking: string;
  carrier: string;
}

/** By tracking number, else order number, else the email itself; an existing record for the number gains this email. */
export function trackOrder(thread: { id: string; date: number; status: PackageStatus }, draft: OrderDraft, now = Date.now()): string {
  const tracking = draft.tracking.trim() || undefined;
  const orderNo = draft.orderNo.trim() || undefined;
  const raw = rawId(thread.id);
  const key = referenceKey({ tracking, orderNo }) ?? `M:${raw}`;
  const had = useTracking.getState().records[key];
  const event: TrackingEvent = { status: thread.status, at: thread.date, threadId: raw, account: threadAccount(thread.id), from: draft.merchant.trim() || undefined, added: true };
  const base: TrackingRecord = had ?? {
    key,
    kind: key.startsWith('T:') ? 'tracking' : key.startsWith('O:') ? 'order' : 'email',
    ref: tracking ?? orderNo ?? '',
    events: [],
    userAdded: true,
    addedAt: now,
  };
  putRecord({
    ...addEvents(base, [event]),
    merchant: draft.merchant.trim() || base.merchant,
    carrier: draft.carrier.trim() || base.carrier,
  });
  return key;
}

/** So its menu offers Remove from Packages. */
export function trackedByHand(record: TrackingRecord | undefined, threadId: string): boolean {
  const raw = rawId(threadId);
  return !!record && (!!record.userAdded || record.events.some((e) => e.added && e.threadId === raw));
}

/** Returns the previous record, for Undo. */
export function untrackEmail(threadId: string): { key: string; before: TrackingRecord } | undefined {
  const record = recordForThread(threadId);
  if (!record || !trackedByHand(record, threadId)) return undefined;
  const raw = rawId(threadId);
  const records = { ...useTracking.getState().records };
  const events = record.events.filter((e) => !(e.added && e.threadId === raw));
  if (record.userAdded) delete records[record.key];
  else records[record.key] = { ...record, events };
  setRecords(records, true);
  return { key: record.key, before: record };
}
