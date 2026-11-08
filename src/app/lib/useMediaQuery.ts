import { useSyncExternalStore } from 'react';

// Every list row asks; one MediaQueryList per query.
const lists = new Map<string, MediaQueryList>();
function list(query: string): MediaQueryList {
  let mq = lists.get(query);
  if (!mq) lists.set(query, (mq = window.matchMedia(query)));
  return mq;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = list(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => list(query).matches,
    () => false,
  );
}
