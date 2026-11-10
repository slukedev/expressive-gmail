import type { ThreadPage, ThreadQuery, ThreadSummary } from '../../data/types';

/** Past this the badge reads "99+", so counting further buys nothing. */
export const TAB_COUNT_LIMIT = 100;

/**
 * Lists a tab's unread threads up to the limit and counts them. Gmail's own total for an unread search is a guess
 * ("of many" over six threads, a round 200 over 40), so it is never used: the count is the threads themselves.
 * Pages on when a backend caps its page below the limit.
 */
export async function countTab(
  list: (query: ThreadQuery) => Promise<ThreadPage>,
  q: string,
  limit = TAB_COUNT_LIMIT,
): Promise<{ threads: ThreadSummary[]; more: boolean }> {
  const threads: ThreadSummary[] = [];
  let pageToken: string | undefined;
  do {
    const page = await list({ q, pageSize: limit - threads.length, ...(pageToken ? { pageToken } : {}) });
    threads.push(...page.threads);
    pageToken = page.nextPageToken;
    // A page that adds nothing would loop forever.
    if (!page.threads.length) break;
  } while (pageToken && threads.length < limit);
  return { threads: threads.slice(0, limit), more: !!pageToken };
}

/** "99+" past 99, "4+" when the count is only a floor. */
export function unreadBadge(count: number, more: boolean) {
  return count > 99 ? '99+' : more ? `${count}+` : String(count);
}
