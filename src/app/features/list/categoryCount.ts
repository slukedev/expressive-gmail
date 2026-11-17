import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { backend, withRecentChanges } from '../../data/client';
import { CATEGORY_LABEL } from '../../data/views';
import type { Label, ThreadPage, ThreadQuery, ThreadSummary } from '../../data/types';
import type { View } from '../../router/routes';

/** Past this the badge reads "50+": one page from Gmail, so four tabs stay cheap. */
const TAB_COUNT_LIMIT = 50;
const MAX_REQUESTS = 3;

/**
 * Lists a tab's unread threads up to the limit and counts the distinct ones. Gmail's own total for an unread search is a
 * guess ("of many" over six threads, a round 200 over 40), so it is never used: the count is the threads themselves.
 * Offset pages can shift or repeat when mail moves between requests, so a page that adds no new thread ends the count.
 */
export async function countTab(
  list: (query: ThreadQuery) => Promise<ThreadPage>,
  q: string,
  limit = TAB_COUNT_LIMIT,
): Promise<{ threads: ThreadSummary[]; more: boolean }> {
  const seen = new Map<string, ThreadSummary>();
  let pageToken: string | undefined;
  for (let requests = 0; requests < MAX_REQUESTS && seen.size < limit; requests++) {
    const page = await list({ q, pageSize: limit - seen.size, ...(pageToken ? { pageToken } : {}) });
    const before = seen.size;
    for (const t of page.threads) if (!seen.has(t.id)) seen.set(t.id, t);
    pageToken = page.threads.length ? page.nextPageToken : undefined;
    if (!pageToken || seen.size === before) break;
  }
  const threads = [...seen.values()].slice(0, limit);
  return { threads, more: !!pageToken || seen.size > limit };
}

/** "99+" past 99, "50+" when the count is only a floor. */
export function unreadBadge(count: number, more: boolean) {
  return count > 99 ? '99+' : more ? `${count}+` : String(count);
}

/**
 * The category's unread mail in the inbox, counted from the same search its tab lists. The category label's own count
 * also takes in archived mail ("14,000 new" over an empty tab), and Gmail's inbox-tab counts follow Gmail's own tabs,
 * which can be off or sort mail differently, so neither is shown. Nothing shows until the count answers.
 */
export function useCategoryUnread(category: string, labels: Label[], enabled: boolean) {
  const label = labels.find((l) => l.id === CATEGORY_LABEL[category]);
  const inbox = labels.find((l) => l.id === 'INBOX');
  const labelUnread = label?.unreadCount ?? 0;
  const q = `in:inbox category:${category} is:unread`;
  // Counted again whenever the tab could have changed: mail read, unread or arrived (the label's count), or archived
  // and moved back (the inbox's total, or the tab's when Gmail keeps one).
  const query = useQuery({
    queryKey: ['category-peek', category, labelUnread, label?.inboxTotalCount, inbox?.totalCount],
    queryFn: () => countTab((query) => backend().listThreads(query), q),
    enabled: enabled && labelUnread > 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  if (labelUnread === 0) return { count: 0, more: false, threads: undefined };
  const data = query.data;
  if (!data) return { count: undefined, more: false, threads: undefined };
  // What this tab read or archived since the count, ahead of Gmail's next answer.
  const threads = unreadIn(data.threads, category);
  return { count: threads.length, more: data.more, threads };
}

function unreadIn(threads: ThreadSummary[], category: string) {
  const view = { kind: 'category', category } as View;
  return withRecentChanges({ threads }, view).threads.filter((t) => t.labelIds.includes('UNREAD'));
}
