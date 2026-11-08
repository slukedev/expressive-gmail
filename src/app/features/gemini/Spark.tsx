import { useEffect, useId, useRef } from 'react';
import { cx } from '../../ui/Button';

/** One full turn while Gemini works. */
const TURN_MS = 2400;
/** How long the spark takes to come to rest once the answer is in. */
const SETTLE_MS = 520;

/** Drawn in the theme's primary and tertiary so it follows Material You and dark mode (the symbols font has no spark). `mono` paints currentColor. `busy` turns it; when that ends it eases on to its next point, which reads as the work landing. */
export function Spark({ size = 24, mono, className, busy }: { size?: number; mono?: boolean; className?: string; busy?: boolean }) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  useSpin(ref, !!busy);
  return (
    <svg ref={ref} className={cx('gemini-spark', className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {!mono && (
        <defs>
          <linearGradient id={id} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--md-sys-color-primary)" />
            <stop offset="1" stopColor="var(--md-sys-color-tertiary)" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M12 2.5c.5 5.1 4.4 9 9.5 9.5-5.1.5-9 4.4-9.5 9.5-.5-5.1-4.4-9-9.5-9.5 5.1-.5 9-4.4 9.5-9.5Z"
        fill={mono ? 'currentColor' : `url(#${id})`}
      />
    </svg>
  );
}

function useSpin(ref: React.RefObject<SVGSVGElement | null>, busy: boolean) {
  const spin = useRef<Animation | null>(null);
  /** Its gradient isn't symmetric, so it never snaps back to 0. */
  const rest = useRef(0);
  const turning = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (busy === turning.current) return;
    turning.current = busy;
    const from = spin.current ? angleOf(spin.current, rest.current) : rest.current;
    spin.current?.cancel();
    if (busy) {
      rest.current = from;
      spin.current = el.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + 360}deg)` }], { duration: TURN_MS, iterations: Infinity });
      return;
    }
    // On to the next of its four points, with room to slow down.
    let to = Math.ceil(from / 90) * 90;
    if (to - from < 30) to += 90;
    rest.current = to % 360;
    spin.current = el.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], {
      duration: SETTLE_MS,
      easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
      fill: 'forwards',
    });
  }, [busy, ref]);
  useEffect(() => () => spin.current?.cancel(), []);
}

/** Its start plus how far through the turn it is. */
function angleOf(anim: Animation, start: number): number {
  const timing = anim.effect?.getComputedTiming();
  if (anim.playState === 'finished' || timing?.iterations !== Infinity) return start;
  return start + ((timing.progress ?? 0) * 360);
}
