import { useEffect, useState, type CSSProperties } from 'react';
import { create } from 'zustand';
import { Avatar } from '../../ui/Avatar';
import { LoadingIndicator } from '../../ui/LoadingIndicator';

// Switching accounts loads that account's Gmail in the tab. So the load reads as one motion, the
// old page fades into a card for the account, and the new page starts on that card and fades it out.

const ARRIVING_KEY = 'bg.arriving';
/** An older hand-off is from some other navigation. */
const ARRIVING_TTL_MS = 20_000;
/** Even if the list is slow. */
const ARRIVING_MAX_MS = 4_000;
export const LEAVE_MS = 220;

export interface Traveller {
  email: string;
  name?: string;
  photoUrl?: string;
  color: string;
}

type Phase = { kind: 'idle' } | { kind: 'leaving' | 'arriving' | 'settled'; who: Traveller };

// Read before the first render, so the new page's very first frame is the card.
const arrival = typeof window === 'undefined' ? undefined : takeArrival();
const useTransition = create<{ phase: Phase }>(() => ({ phase: arrival ? { kind: 'arriving', who: arrival } : { kind: 'idle' } }));

export function leaveFor(who: Traveller) {
  try {
    sessionStorage.setItem(ARRIVING_KEY, JSON.stringify({ ...who, at: Date.now() }));
  } catch {
    // No per-tab memory: the new page just fades in on its own.
  }
  useTransition.setState({ phase: { kind: 'leaving', who } });
}

function takeArrival(): Traveller | undefined {
  try {
    const raw = sessionStorage.getItem(ARRIVING_KEY);
    sessionStorage.removeItem(ARRIVING_KEY);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as Traveller & { at?: number };
    return typeof saved.email === 'string' && Date.now() - (saved.at ?? 0) < ARRIVING_TTL_MS ? saved : undefined;
  } catch {
    return undefined;
  }
}

/** The list, or its empty or error state. */
function listPainted() {
  return !!document.querySelector('.thread-list [data-row-index], .thread-list .empty, .list-pane .empty');
}

export function AccountTransition() {
  const phase = useTransition((s) => s.phase);
  const [, force] = useState(0);

  useEffect(() => {
    const who = arrival;
    if (!who) return;
    const started = performance.now();
    let frame = 0;
    const watch = () => {
      if (listPainted() || performance.now() - started > ARRIVING_MAX_MS) {
        useTransition.setState({ phase: { kind: 'settled', who } });
        return;
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (phase.kind !== 'settled') return;
    const timer = window.setTimeout(() => {
      useTransition.setState({ phase: { kind: 'idle' } });
      force((n) => n + 1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [phase.kind]);

  if (phase.kind === 'idle') return null;
  const { who } = phase;
  return (
    <div className="account-travel" data-phase={phase.kind} role="status" aria-live="polite" aria-label={`Opening ${who.email}`}>
      <div className="account-travel__card">
        <span className="account-travel__photo" style={{ '--account-color': who.color } as CSSProperties}>
          <Avatar own name={who.name} email={who.email} photoUrl={who.photoUrl} size={72} />
        </span>
        <span className="md-title-large account-travel__name">{who.name || who.email}</span>
        {who.name && <span className="md-body-medium account-travel__email">{who.email}</span>}
        <LoadingIndicator size={40} label={`Opening ${who.email}`} className="account-travel__busy" />
      </div>
    </div>
  );
}
