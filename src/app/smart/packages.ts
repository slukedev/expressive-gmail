import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { rawId } from '../data/accounts/ids';
import { scopedThreadId } from '../data/accounts/threads';
import { backend, keys } from '../data/client';
import type { Thread } from '../data/types';
import { analyzeMessage, etaPassed, type PackageInfo } from './extract';
import { currentEvent, referenceKey, type TrackingEvent, type TrackingRecord } from './tracking';
import { useTracking } from './trackingStore';

export interface FoundPackage {
  info: PackageInfo;
  /** Only its id and senders are needed. */
  thread: Pick<Thread, 'id' | 'participants'>;
  /** The newest email about this package. */
  date: number;
  /** Not delivered, and its estimate has come and gone. */
  late: boolean;
  key?: string;
  /** When it's newer than these threads. */
  latest?: TrackingEvent;
  /** For the status menu. */
  record?: TrackingRecord;
}

/** One entry per package. Emails sharing a tracking number are the same package and the newest status wins, so "Out for delivery" never outlives a later "Delivered". Purchases and the glance board both read packages here. */
export function collectPackages(threads: (Thread | undefined)[], now = Date.now(), records: Record<string, TrackingRecord> = {}): FoundPackage[] {
  return withLatest(groupPackages(threads), records, now);
}

/** The slow half: it reads every message. */
export function groupPackages(threads: (Thread | undefined)[]): FoundPackage[] {
  const byKey = new Map<string, FoundPackage>();
  for (const thread of threads) {
    if (!thread || thread.labelIds.includes('CATEGORY_PROMOTIONS')) continue;
    const last = [...thread.messages].reverse().find((m) => !m.isDraft);
    if (!last) continue;
    for (const info of analyzeMessage(last, thread.labelIds)) {
      if (info.kind !== 'package') continue;
      const ref = referenceKey(info);
      const key = ref ?? thread.id;
      const existing = byKey.get(key);
      if (existing && existing.date >= last.date) {
        if (!existing.info.merchant && info.merchant) existing.info = { ...existing.info, merchant: info.merchant };
        continue;
      }
      const merged = { ...info, merchant: info.merchant ?? existing?.info.merchant, eta: info.eta ?? existing?.info.eta };
      byKey.set(key, { info: merged, thread, date: last.date, late: false, key: ref });
    }
  }
  return [...byKey.values()];
}

/** Up to date with other emails (or what you set by hand), sorted. Cheap enough for every record change. */
export function withLatest(found: FoundPackage[], records: Record<string, TrackingRecord>, now = Date.now()): FoundPackage[] {
  const byThread = new Map<string, string>();
  for (const r of Object.values(records)) for (const e of r.events) if (!byThread.has(e.threadId)) byThread.set(e.threadId, r.key);
  const out = found.map((p): FoundPackage => {
    const raw = rawId(p.thread.id);
    const key = p.key ?? byThread.get(raw);
    // Mail outside these threads (a carrier's "Delivered", found by search or in the inbox) can be newer.
    const record = key ? records[key] : undefined;
    const own: TrackingEvent = { status: p.info.status, at: p.date, threadId: raw, eta: p.info.eta };
    const latest = record ? currentEvent(record, [own]) : undefined;
    const newer = latest && latest !== own ? latest : undefined;
    const info = newer ? { ...p.info, status: newer.status, eta: newer.eta ?? p.info.eta } : p.info;
    const date = newer?.at ?? p.date;
    return { ...p, key, info, date, record, latest: newer?.manual ? undefined : newer, late: lateFor(info, now) };
  });
  // Emails tracked with "Add to Packages" that the extractor doesn't read as packages.
  const shown = new Set(out.map((p) => p.key));
  for (const r of Object.values(records)) {
    if (!r.userAdded || shown.has(r.key)) continue;
    const first = r.events.find((e) => e.added) ?? r.events[0];
    const current = currentEvent(r);
    if (!first || !current) continue;
    const info: PackageInfo = {
      kind: 'package',
      status: current.status,
      merchant: r.merchant,
      carrier: r.carrier,
      tracking: r.kind === 'tracking' ? r.ref : undefined,
      orderNo: r.kind === 'order' ? r.ref : undefined,
      trackUrl: r.trackUrl,
      eta: current.eta,
    };
    out.push({
      info,
      thread: { id: scopedThreadId(first.threadId, first.account), participants: [] },
      date: Math.max(current.at, r.addedAt ?? 0),
      late: lateFor(info, now),
      key: r.key,
      record: r,
      latest: current.manual || current.threadId === first.threadId ? undefined : current,
    });
  }
  return out.sort((a, b) => Number(a.info.status === 'delivered') - Number(b.info.status === 'delivered') || b.date - a.date);
}

const lateFor = (info: PackageInfo, now: number) => info.status !== 'delivered' && info.status !== 'out-for-delivery' && etaPassed(info.eta, now);

/** With their messages, for pages that read mail in bulk. */
function useThreadsFor(q: string, limit: number, enabled = true) {
  const list = useQuery({ queryKey: ['bulk-threads', q, limit], queryFn: () => backend().listThreads({ q, pageSize: limit }), staleTime: 60_000, enabled });
  const ids = (list.data?.threads ?? []).filter((t) => !t.labelIds.includes('CATEGORY_PROMOTIONS')).map((t) => t.id);
  const details = useQueries({ queries: ids.map((id) => ({ queryKey: keys.thread(id), queryFn: () => backend().getThread(id), staleTime: 60_000, enabled })) });
  const loading = enabled && (list.isPending || details.some((q) => q.isPending));
  const threads = details.map((d) => d.data);
  // useQueries hands back a new array each render; key the memo on what's in it.
  const stamp = details.map((d) => d.dataUpdatedAt).join();
  return { threads: useMemo(() => threads, [stamp]), loading }; // eslint-disable-line react-hooks/exhaustive-deps
}

// A little past the 30 days a package stays relevant, so an order's first email still ties to its last.
const RECENT_PACKAGES = '(shipped OR delivered OR "out for delivery" OR "on the way" OR "tracking number") -in:spam -in:trash newer_than:45d';

/** Delivered ones included; callers decide what's still relevant. */
export function useRecentPackages(enabled = true) {
  const { threads, loading } = useThreadsFor(RECENT_PACKAGES, 25, enabled);
  const records = useTracking((s) => s.records);
  const grouped = useMemo(() => groupPackages(threads), [threads]);
  const packages = useMemo(() => withLatest(grouped, records), [grouped, records]);
  return { packages, loading };
}
