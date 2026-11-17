import { useMemo, useSyncExternalStore } from 'react';
import { getVisibleThreadIds, setVisibleThreadIds } from '../../data/actions';

const listeners = new Set<() => void>();

/** The list on screen, in order. Imperative callers read getVisibleThreadIds(); components subscribe with useNeighbours. */
export function publishListOrder(ids: string[]) {
  if (ids === getVisibleThreadIds()) return;
  setVisibleThreadIds(ids);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface Neighbours {
  /** -1 when the thread isn't in the list. */
  position: number;
  count: number;
  newer?: string;
  older?: string;
}

/** Re-renders only when the thread's place in the list or its neighbours change. */
export function useNeighbours(threadId: string): Neighbours {
  // A string snapshot, so an unchanged place compares equal.
  const key = useSyncExternalStore(subscribe, () => {
    const ids = getVisibleThreadIds();
    const at = ids.indexOf(threadId);
    return [at, ids.length, at > 0 ? ids[at - 1] : '', at >= 0 ? (ids[at + 1] ?? '') : ''].join('\u0000');
  });
  return useMemo(() => {
    const [position, count, newer, older] = key.split('\u0000');
    return { position: Number(position), count: Number(count), newer: newer || undefined, older: older || undefined };
  }, [key]);
}
