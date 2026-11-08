import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Gmail Android style: past 35% of the row's width it commits on release, otherwise it springs back. */
export function useSwipe(onCommit: (direction: 'left' | 'right') => void) {
  const state = useRef<{ x: number; y: number; dx: number; active: boolean; id: number; w: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return;
    state.current = { x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId, w: 0 };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = state.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.active) {
      // Vertical intent wins: let the list scroll.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        state.current = null;
        return;
      }
      if (Math.abs(dx) < 12) return;
      s.active = true;
      // Read once: reading it after the writes below forces a layout per event.
      s.w = e.currentTarget.offsetWidth;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    s.dx = dx;
    const row = e.currentTarget;
    const wrap = row.parentElement!;
    const progress = Math.min(Math.abs(dx) / (s.w * 0.35), 1);
    row.style.transition = 'none';
    row.style.transform = `translateX(${dx}px)`;
    wrap.dataset.swipe = dx > 0 ? 'right' : 'left';
    wrap.style.setProperty('--swipe-progress', String(progress));
  };

  const springBack = (row: HTMLElement, wrap: HTMLElement) => {
    row.style.transition = '';
    row.style.transform = '';
    window.setTimeout(() => {
      // A new drag may have started meanwhile.
      if (state.current?.active) return;
      delete wrap.dataset.swipe;
      wrap.style.removeProperty('--swipe-progress');
    }, 400);
  };

  // Only a row that leaves the list stays out; one that stays (marked read, Undo) slides home once off screen.
  const settle = (row: HTMLElement, wrap: HTMLElement) => {
    if (!wrap.isConnected) return;
    if (!wrap.hasAttribute('data-leaving')) {
      springBack(row, wrap);
      return;
    }
    const watch = new MutationObserver(() => {
      if (wrap.hasAttribute('data-leaving')) return;
      watch.disconnect();
      if (wrap.isConnected) springBack(row, wrap);
    });
    watch.observe(wrap, { attributes: true, attributeFilter: ['data-leaving'] });
  };

  const finish = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = state.current;
    state.current = null;
    if (!s?.active) return;
    const row = e.currentTarget;
    const wrap = row.parentElement!;
    // A cancelled pointer (the browser took the gesture) never commits.
    const commit = !cancelled && Math.abs(s.dx) > s.w * 0.35;
    row.style.transition = '';
    if (commit) {
      row.style.transform = `translateX(${s.dx > 0 ? '110%' : '-110%'})`;
      onCommit(s.dx > 0 ? 'right' : 'left');
      let done = false;
      const slid = (ev?: TransitionEvent) => {
        if (done || (ev && (ev.target !== row || ev.propertyName !== 'transform'))) return;
        done = true;
        row.removeEventListener('transitionend', slid);
        settle(row, wrap);
      };
      row.addEventListener('transitionend', slid);
      // Reduced motion has no transition to end.
      window.setTimeout(slid, 500);
    } else {
      springBack(row, wrap);
    }
    // Swallow the click that follows a swipe.
    const block = (ev: Event) => ev.stopPropagation();
    row.addEventListener('click', block, { capture: true, once: true });
    window.setTimeout(() => row.removeEventListener('click', block, { capture: true }), 50);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
  };
}
