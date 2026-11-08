import { create } from 'zustand';

/** Conversations an action just moved elsewhere; a row that stays in its list (All mail) plays this to show it went. */
export const useMoved = create<{ tokens: Map<string, number> }>(() => ({ tokens: new Map() }));

let seq = 0;

export function markMoved(ids: string[]) {
  const tokens = new Map(useMoved.getState().tokens);
  seq += 1;
  for (const id of ids) tokens.set(id, seq);
  useMoved.setState({ tokens });
}

/** The sidebar entry the conversation went to answers with a short swell. */
export function pulseDestination(hash: string) {
  const link = document.querySelector<HTMLElement>(`nav a[href="#${hash}"]`);
  if (!link || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  link.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(0.2, 0, 0, 1)', delay: 120 });
}
