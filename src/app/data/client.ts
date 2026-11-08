import { QueryClient, replaceEqualDeep, type InfiniteData } from '@tanstack/react-query';
import type { BackendError, MailBackend } from './backend';
import type { View } from '../router/routes';
import type { Label, LabelChange, LabelId, Thread, ThreadPage, ThreadSummary } from './types';
import { stillInView } from './views';
import { metered } from './requestMeter';

/** Freshness comes from the sync loop (sync.ts), which invalidates what changed, so queries don't refetch on focus, reconnect or remount. Retries are for hiccups only; a rate limit isn't retried here. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000,
      gcTime: 10 * 60_000,
      retry: (count, err) => count < 2 && err instanceof Error && (err as { retryable?: boolean }).retryable === true && (err as BackendError).code !== 'rate-limited',
      retryDelay: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt) * (0.5 + Math.random()),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

let backendRef: MailBackend | null = null;
export function setBackend(b: MailBackend) {
  backendRef = metered(b);
}
export function backend(): MailBackend {
  if (!backendRef) throw new Error('Mail backend not ready');
  return backendRef;
}

export const keys = {
  account: ['account'] as const,
  labels: ['labels'] as const,
  threads: (q: string, view: View) => ['threads', { q, view }] as const,
  allThreads: ['threads'] as const,
  thread: (id: string) => ['thread', id] as const,
  contacts: (prefix: string) => ['contacts', prefix] as const,
};

type ListData = InfiniteData<ThreadPage>;

/** React Query shares structure by position, so one row leaving gave every row below a new object, and every memoized row a re-render. */
export function shareListById(prev: unknown, next: unknown): unknown {
  const shared = replaceEqualDeep(prev, next);
  const before = prev as ListData | undefined;
  const after = shared as ListData | undefined;
  if (shared === prev || !before?.pages || !after?.pages) return shared;
  const old = new Map<string, ThreadSummary>();
  for (const p of before.pages) for (const t of p.threads) old.set(t.id, t);
  return {
    ...after,
    pages: after.pages.map((p) => ({
      ...p,
      threads: p.threads.map((t) => {
        const o = old.get(t.id);
        return o && o !== t ? replaceEqualDeep(o, t) : t;
      }),
    })),
  };
}

export function applyLabelChange<T extends Pick<ThreadSummary, 'labelIds'>>(t: T, change: LabelChange): T {
  const set = new Set<LabelId>(t.labelIds);
  change.remove?.forEach((l) => set.delete(l));
  change.add?.forEach((l) => set.add(l));
  return { ...t, labelIds: [...set] };
}

/** Label changes made in this tab recently. Gmail can answer a list request with the old state for a few seconds after a write, so fresh pages get these laid over them; otherwise an archived row would pop back until the next sync. */
const SETTLE_MS = 30_000;
const recent = new Map<string, { changes: LabelChange[]; until: number; gone?: boolean }>();

export function rememberChange(ids: string[], change: LabelChange, now = Date.now()) {
  for (const id of ids) {
    const prev = recent.get(id);
    recent.set(id, { changes: [...(prev && prev.until > now ? prev.changes : []), change], until: now + SETTLE_MS });
  }
}

/** Kept out of every fresh list while Gmail's lists catch up. */
export function rememberGone(ids: string[], now = Date.now()) {
  for (const id of ids) recent.set(id, { changes: [], until: now + SETTLE_MS, gone: true });
}

/** Undo or a failed write: the server's state is the truth again. */
export function forgetChange(ids: string[]) {
  ids.forEach((id) => recent.delete(id));
  // Their counts come back from the server as they are. A later change on the same label was counted from after this one; it now counts from before.
  const gone = new Set(ids);
  const shift = new Map<LabelId, number>();
  pendingUnread = pendingUnread.flatMap((p) => {
    if (p.ids.some((id) => gone.has(id))) {
      shift.set(p.label, (shift.get(p.label) ?? 0) + p.delta);
      return [];
    }
    return [{ ...p, from: p.from - (shift.get(p.label) ?? 0) }];
  });
}

/** A list page as it would look with this tab's recent changes applied. */
export function withRecentChanges(page: ThreadPage, view: View, now = Date.now()): ThreadPage {
  if (!recent.size) return page;
  for (const [id, r] of recent) if (r.until <= now) recent.delete(id);
  if (!page.threads.some((t) => recent.has(t.id))) return page;
  const labels = queryClient.getQueryData<Label[]>(keys.labels) ?? [];
  const threads = page.threads
    .map((t) => recent.get(t.id)?.changes.reduce((acc, c) => applyLabelChange(acc, c), t) ?? t)
    .filter((t) => {
      const r = recent.get(t.id);
      return !r || (!r.gone && stillInView(view, t, labels) !== false);
    });
  return { ...page, threads };
}

/** Every list page and the open thread. */
export function patchThreads(ids: string[], fn: (t: ThreadSummary) => ThreadSummary) {
  const idSet = new Set(ids);
  queryClient.setQueriesData<ListData>({ queryKey: keys.allThreads }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({ ...p, threads: p.threads.map((t) => (idSet.has(t.id) ? fn(t) : t)) })),
        }
      : data,
  );
  for (const id of ids) {
    queryClient.setQueryData<Thread>(keys.thread(id), (t) => {
      if (!t) return t;
      const next = fn(t) as Thread;
      // Keep message labels in sync for the thread view's own checks.
      const added = next.labelIds.filter((l) => !t.labelIds.includes(l));
      const removed = t.labelIds.filter((l) => !next.labelIds.includes(l));
      return {
        ...next,
        messages: t.messages.map((m) => applyLabelChange(m, { add: added, remove: removed })),
      };
    });
  }
}

/** Rows still collapsing out of a list, kept by any prune until their own runs. */
const collapsing = new Map<string, number>();

/** A prune for something else meanwhile (opening the next thread marks it read) leaves them alone; cutting a row mid-collapse makes the list below jump. */
export function pruneAfterCollapse(ids: string[], ms: number) {
  const token = Math.random();
  for (const id of ids) collapsing.set(id, token);
  setTimeout(() => {
    for (const id of ids) if (collapsing.get(id) === token) collapsing.delete(id);
    pruneLists();
  }, ms);
}

export function pruneLists() {
  const labels = queryClient.getQueryData<Label[]>(keys.labels) ?? [];
  for (const query of queryClient.getQueryCache().findAll({ queryKey: keys.allThreads })) {
    const view = (query.queryKey[1] as { view: View }).view;
    queryClient.setQueryData<ListData>(query.queryKey, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              threads: p.threads.filter((t) => collapsing.has(t.id) || stillInView(view, t, labels) !== false),
            })),
          }
        : data,
    );
  }
}

export function snapshotThreads(ids: string[]): Map<string, ThreadSummary> {
  const out = new Map<string, ThreadSummary>();
  const idSet = new Set(ids);
  for (const [, data] of queryClient.getQueriesData<ListData>({ queryKey: keys.allThreads })) {
    data?.pages.forEach((p) => p.threads.forEach((t) => idSet.has(t.id) && !out.has(t.id) && out.set(t.id, t)));
  }
  for (const id of ids) {
    const t = queryClient.getQueryData<Thread>(keys.thread(id));
    if (t && !out.has(id)) out.set(id, t);
  }
  return out;
}

export function findThread(id: string): ThreadSummary | undefined {
  return snapshotThreads([id]).get(id);
}

/** Unread counts this tab changed ahead of the server. Gmail answers with the old count for a few seconds after a write, so without these the nav count flicks back (28, 29, 28). Each entry goes once the server's count moves off the one it was made against. */
const UNREAD_SETTLE_MS = 15_000;
let pendingUnread: { label: LabelId; from: number; delta: number; until: number; source: MailBackend | null; ids: string[] }[] = [];

/** `ids` made the change. */
export function adjustUnread(deltas: Map<LabelId, number>, ids: string[]) {
  if (![...deltas.values()].some(Boolean)) return;
  const until = Date.now() + UNREAD_SETTLE_MS;
  queryClient.setQueryData<Label[]>(keys.labels, (labels) =>
    labels?.map((l) => {
      const delta = deltas.get(l.id);
      if (!delta) return l;
      const from = l.unreadCount ?? 0;
      pendingUnread.push({ label: l.id, from, delta, until, source: backendRef, ids });
      return { ...l, unreadCount: Math.max(0, from + delta) };
    }),
  );
}

export function withPendingUnread(labels: Label[], now = Date.now()): Label[] {
  // Another account or scope since: its counts owe nothing to these.
  pendingUnread = pendingUnread.filter((p) => p.until > now && p.source === backendRef);
  if (!pendingUnread.length) return labels;
  const keep: typeof pendingUnread = [];
  const out = labels.map((l) => {
    let count = l.unreadCount ?? 0;
    for (const p of pendingUnread) {
      if (p.label !== l.id) continue;
      // Still the count the change was made against: the server hasn't caught up.
      if (count !== p.from) continue;
      count = Math.max(0, count + p.delta);
      keep.push(p);
    }
    return count === (l.unreadCount ?? 0) ? l : { ...l, unreadCount: count };
  });
  pendingUnread = keep;
  return out;
}
