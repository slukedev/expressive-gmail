import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const TRIGGER = 72;
const MAX = 120;
/** Wheel events further apart than this start a new swipe. */
const GESTURE_GAP = 250;
/** About 240px of trackpad travel to reach the trigger. */
const wheelPull = (total: number) => Math.min(MAX, total * 0.3);
/** Touch: about 150px of travel, past a dead zone so a tap-and-drift doesn't count. */
const TOUCH_DEAD_ZONE = 12;

interface PullParts {
  indicator: RefObject<HTMLElement | null>;
  /** Turns with the pull. */
  arrow: RefObject<HTMLElement | null>;
}

/** Touch drags and two-finger trackpad swipes. The pull is written straight to the DOM each event, so following the finger never re-renders the list. Returns whether a refresh runs. */
export function usePullToRefresh(scrollRef: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>, parts?: PullParts) {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const pullRef = useRef(0);

  const setPull = (pull: number) => {
    pullRef.current = pull;
    const el = scrollRef.current;
    const indicator = partsRef.current?.indicator.current;
    const arrow = partsRef.current?.arrow.current;
    const progress = Math.min(pull / TRIGGER, 1);
    if (el) {
      el.style.transform = pull ? `translateY(${pull * 0.4}px)` : '';
      el.toggleAttribute('data-pulling', pull > 0);
    }
    if (indicator) {
      indicator.style.transform = `translate(-50%, ${pull - 56}px) scale(${0.5 + progress * 0.5})`;
      indicator.style.opacity = String(Math.min(1, progress * 1.4));
      indicator.toggleAttribute('data-active', pull > 0 || busy.current);
    }
    if (arrow) arrow.style.transform = `rotate(${progress * 270}deg)`;
  };
  const setPullRef = useRef(setPull);
  setPullRef.current = setPull;

  // Before first paint; the arrow remounts after each refresh.
  useLayoutEffect(() => {
    setPullRef.current(pullRef.current);
  }, [refreshing]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const setPull = (pull: number) => setPullRef.current(pull);
    let startY: number | null = null;
    let distance = 0;
    let wheelTotal = 0;
    let wheelTimer = 0;
    let lastWheel = -Infinity;
    let eligible = false;

    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      setRefreshing(true);
      setPull(TRIGGER);
      try {
        await Promise.all([refreshRef.current(), new Promise((r) => setTimeout(r, 650))]);
      } finally {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    // Rubber band: the further you pull, the less it moves.
    const damp = (d: number) => Math.min(MAX, d <= TOUCH_DEAD_ZONE ? 0 : (d - TOUCH_DEAD_ZONE) * 0.52);

    const onTouchStart = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 && !busy.current ? e.touches[0].clientY : null;
      distance = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY === null) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0) {
        setPull(0);
        return;
      }
      if (el.scrollTop > 0) {
        startY = null;
        return;
      }
      e.preventDefault();
      distance = damp(d);
      setPull(distance);
    };
    const onTouchEnd = () => {
      if (startY === null) return;
      startY = null;
      if (distance >= TRIGGER) void run();
      else setPull(0);
    };

    // Trackpads send small, frequent deltas; a mouse wheel's big notches are left alone. A pull only counts when the whole swipe (wheel events under GESTURE_GAP apart) starts at the top, so momentum after scrolling back up never refreshes.
    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      const fresh = now - lastWheel > GESTURE_GAP;
      lastWheel = now;
      if (fresh) eligible = el.scrollTop <= 0 && e.deltaY < 0;
      if (el.scrollTop > 0 || e.deltaY > 0) eligible = false;
      if (busy.current || !eligible || e.ctrlKey || e.deltaMode !== 0 || Math.abs(e.deltaY) > 40) {
        if (wheelTotal) {
          wheelTotal = 0;
          window.clearTimeout(wheelTimer);
          setPull(0);
        }
        return;
      }
      wheelTotal += -e.deltaY;
      setPull(wheelPull(wheelTotal));
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        if (wheelPull(wheelTotal) >= TRIGGER) void run();
        else setPull(0);
        wheelTotal = 0;
      }, 180);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(wheelTimer);
    };
  }, [scrollRef]);

  return { refreshing };
}
