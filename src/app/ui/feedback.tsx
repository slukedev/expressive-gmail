import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon, type IconName } from './Icon';
import { motionToken, reducedMotion } from './motion';
import { snack } from './Snackbar';

/** The way Google's apps acknowledge a copy: the control turns "done" and goes back by itself. */
function useConfirmed(ms = 2000): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const confirm = useCallback(() => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, confirm];
}

let region: HTMLElement | null = null;

/** For feedback that is only visual. */
export function announce(message: string) {
  if (!region) {
    region = document.createElement('div');
    region.className = 'sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  const el = region;
  el.textContent = '';
  // A fresh node after a beat, so the same message twice is still read.
  window.setTimeout(() => {
    el.textContent = message;
  }, 60);
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    snack("Couldn't copy. Select the text and copy it yourself.");
    return false;
  }
}

/** `spoken` is what a screen reader hears. */
export function useCopy(ms?: number) {
  const [copied, confirm] = useConfirmed(ms);
  const copy = useCallback(
    async (text: string, spoken = 'Copied') => {
      if (!(await writeClipboard(text))) return;
      confirm();
      announce(spoken);
    },
    [confirm],
  );
  return { copied, copy };
}

/** `from` turns and shrinks away while `to` grows in (FastSpatial). */
export function SwapIcon({
  from,
  to,
  on,
  size = 24,
  filled,
  className,
}: {
  from: IconName;
  to: IconName;
  on: boolean;
  size?: 14 | 16 | 18 | 20 | 24 | 28 | 32;
  filled?: boolean;
  className?: string;
}) {
  return (
    <span className={className ? `m3-swap-icon ${className}` : 'm3-swap-icon'} data-on={on || undefined} aria-hidden="true">
      <Icon name={from} size={size} filled={filled} />
      <Icon name={to} size={size} filled={filled} weight={500} />
    </span>
  );
}

/** The new label rolls up into place and the slot's width follows on FastSpatial, so the button never jumps. */
export function SwapText({ on, idle, done }: { on: boolean; idle: ReactNode; done: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useWidthMorph(ref, on);
  return (
    <span ref={ref} className="m3-swap-text" data-on={on || undefined}>
      <span aria-hidden={on || undefined}>{idle}</span>
      <span aria-hidden={!on || undefined}>{done}</span>
    </span>
  );
}

function useWidthMorph(ref: RefObject<HTMLElement | null>, on: boolean) {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted.current || !el) {
      mounted.current = true;
      return;
    }
    if (reducedMotion()) return;
    const [idle, done] = Array.from(el.children) as HTMLElement[];
    const entering = on ? done : idle;
    const leaving = on ? idle : done;
    const running = el.getAnimations();
    // Mid-morph, start from where the slot is now.
    const from = running.length ? el.getBoundingClientRect().width : leaving.getBoundingClientRect().width;
    running.forEach((a) => a.cancel());
    const to = entering.getBoundingClientRect().width;
    if (Math.abs(from - to) < 0.5) return;
    el.animate([{ width: `${from}px` }, { width: `${to}px` }], motionToken('--md-sys-motion-spatial-fast'));
  }, [on, ref]);
}

/** And lets it finish on a spring, so a refresh reads as started, working and done. */
export function useSpin(ref: RefObject<HTMLElement | null>, active: boolean) {
  const loop = useRef<Animation | null>(null);
  useEffect(() => {
    const icon = ref.current?.querySelector<HTMLElement>('.m3-icon');
    if (!icon || reducedMotion()) return;
    if (active) {
      if (loop.current) return;
      loop.current = icon.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], {
        duration: 900,
        iterations: Infinity,
      });
      return;
    }
    const spin = loop.current;
    if (!spin) return;
    loop.current = null;
    const turned = ((Number(spin.currentTime) || 0) % 900) / 900;
    spin.cancel();
    const settle = motionToken('--md-sys-motion-spatial-default');
    icon.animate([{ transform: `rotate(${turned}turn)` }, { transform: 'rotate(1turn)' }], settle);
  }, [active, ref]);
}
