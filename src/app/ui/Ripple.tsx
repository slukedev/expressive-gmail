import { useEffect, useRef } from 'react';

/** So a scroll that begins on a control doesn't flash it. */
const TOUCH_DELAY_MS = 100;
/** Before it counts as a scroll. */
const TOUCH_SLOP = 6;

/** The last child of any interactive element with `position: relative`; reads the host's currentColor. */
export function Ripple({ disabled }: { disabled?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const host = layer?.parentElement;
    if (!layer || !host || disabled) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || host.matches(':disabled,[aria-disabled="true"],[data-disabled]')) return;
      // A control inside the host (a row's star) ripples on its own.
      const inner = (e.target as Element).closest('button, a, input, [role="button"], [role="menuitem"]');
      if (inner && inner !== host && host.contains(inner)) return;
      const rect = host.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let wave: HTMLSpanElement | null = null;
      let started = 0;
      const show = () => {
        const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
        wave = document.createElement('span');
        wave.className = 'm3-ripple-wave';
        wave.style.cssText = `left:${x - radius}px;top:${y - radius}px;width:${radius * 2}px;height:${radius * 2}px`;
        layer.appendChild(wave);
        started = performance.now();
      };
      // A finger on a list may be starting a scroll: wait, and drop the wave if it moves.
      const touch = e.pointerType === 'touch';
      let timer = 0;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId === e.pointerId && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > TOUCH_SLOP) cancel();
      };
      const stop = () => {
        window.clearTimeout(timer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', cancel);
      };
      const fade = () => {
        const w = wave;
        if (!w) return;
        // Let the expansion read before fading, even on a quick tap.
        const wait = Math.max(0, 225 - (performance.now() - started));
        window.setTimeout(() => {
          w.dataset.out = '';
          w.addEventListener('transitionend', () => w.remove(), { once: true });
          window.setTimeout(() => w.remove(), 600);
        }, wait);
      };
      const cancel = () => {
        stop();
        fade();
      };
      const release = () => {
        stop();
        // A tap shorter than the delay still gets its wave.
        if (!wave) show();
        fade();
      };
      if (touch) {
        timer = window.setTimeout(show, TOUCH_DELAY_MS);
        window.addEventListener('pointermove', onMove);
      } else {
        show();
      }
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', cancel);
    };

    host.addEventListener('pointerdown', onDown);
    return () => host.removeEventListener('pointerdown', onDown);
  }, [disabled]);

  return <span ref={ref} className="m3-ripple" aria-hidden="true" data-disabled={disabled || undefined} />;
}
