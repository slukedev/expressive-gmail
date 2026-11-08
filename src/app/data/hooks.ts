import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { View } from '../router/routes';
import { useSettings } from '../state/settings';
import { backend, keys, queryClient, shareListById, withPendingUnread, withRecentChanges } from './client';
import { keepPhoto } from './bootCache';
import type { Account } from './types';
import { viewQuery } from './views';
import { startSync } from './sync';

export function useAccount() {
  return useQuery({
    queryKey: keys.account,
    // A read made before Gmail drew its header has no photo; keep the one we had.
    queryFn: async () => keepPhoto(queryClient.getQueryData<Account>(keys.account), await backend().getAccount()),
    staleTime: Infinity,
  });
}

/** The account, its send-as aliases, and in a merged scope every account's. */
export function myAddresses(account: Account | undefined): string[] {
  if (!account) return [];
  const all = [account.email, ...(account.sendAs ?? []).map((a) => a.email), ...(account.members ?? []).flatMap((m) => [m.email, ...(m.sendAs ?? []).map((a) => a.email)])];
  return [...new Set(all.map((e) => e.toLowerCase()))];
}

export function useMe(): string[] {
  const { data: account } = useAccount();
  return useMemo(() => myAddresses(account), [account]);
}

export function useLabels() {
  // The sync loop invalidates counts when it sees a change.
  return useQuery({ queryKey: keys.labels, queryFn: async () => withPendingUnread(await backend().listLabels()), staleTime: 5 * 60_000 });
}

export function useViewQuery(view: View) {
  const inboxType = useSettings((s) => s.inboxType);
  const categories = useSettings((s) => s.categories);
  const splits = useSettings((s) => s.splits);
  return viewQuery(view, { inboxType, categories, splits });
}

export function useThreadList(view: View, q: string, enabled = true) {
  const pageSize = useSettings((s) => s.pageSize);
  return useInfiniteQuery({
    queryKey: keys.threads(q, view),
    queryFn: async ({ pageParam }) => withRecentChanges(await backend().listThreads({ q, pageToken: pageParam, pageSize }), view),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
    structuralSharing: shareListById,
    enabled,
  });
}

/** Threads are invalidated when the sync loop says they changed. */
const THREAD_STALE_MS = 5 * 60_000;

export function useThread(threadId: string | undefined) {
  return useQuery({
    queryKey: keys.thread(threadId ?? ''),
    queryFn: () => backend().getThread(threadId!),
    enabled: !!threadId,
    staleTime: THREAD_STALE_MS,
  });
}

export function prefetchThread(threadId: string) {
  return queryClient.prefetchQuery({
    queryKey: keys.thread(threadId),
    queryFn: () => backend().getThread(threadId),
    staleTime: THREAD_STALE_MS,
  });
}

const LIVE_MS = 20_000;

/** One change poll per interval while visible (see sync.ts). */
export function useMailSync(intervalMs: number) {
  useEffect(() => {
    const loop = startSync(backend, queryClient, Math.min(intervalMs, LIVE_MS));
    return () => loop.stop();
  }, [intervalMs]);
}
