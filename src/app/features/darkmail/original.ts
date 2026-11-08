import { create } from 'zustand';
import { rawId } from '../../data/accounts/ids';

/** Switched back with "View in light theme". This session only, like Gmail on Android. */
const useOriginal = create<{ ids: Set<string> }>(() => ({ ids: new Set() }));

export function useShowsOriginal(messageId: string) {
  return useOriginal((s) => s.ids.has(rawId(messageId)));
}

export function setShowsOriginal(messageId: string, on: boolean) {
  const next = new Set(useOriginal.getState().ids);
  if (on) next.add(rawId(messageId));
  else next.delete(rawId(messageId));
  useOriginal.setState({ ids: next });
}
