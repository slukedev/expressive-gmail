import type { ThreadPage } from '../../data/types';

/** Everything fit on the page: count it. Otherwise trust Gmail's total only when it's a real number above what loaded. */
export function peekCount(page: Pick<ThreadPage, 'threads' | 'nextPageToken' | 'resultSizeEstimate' | 'resultSizeAtLeast'>) {
  const loaded = page.threads.length;
  if (!page.nextPageToken) return { count: loaded, more: false };
  const estimate = page.resultSizeEstimate;
  if (page.resultSizeAtLeast || estimate === undefined || estimate <= loaded) return { count: loaded, more: true };
  return { count: estimate, more: false };
}

/** "99+" past 99, "4+" when the count is only a floor. */
export function unreadBadge(count: number, more: boolean) {
  return count > 99 ? '99+' : more ? `${count}+` : String(count);
}
