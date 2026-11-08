import { useEffect, type RefObject } from 'react';

/** Marks which ends have more (`data-more-start`, `data-more-end`) for CSS fades, and lets a mouse wheel scroll it, since most mice can't scroll sideways. */
export function useScrollRow(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => {
      const max = el.scrollWidth - el.clientWidth;
      // Right to left scrolls into negative numbers.
      const at = Math.abs(el.scrollLeft);
      el.toggleAttribute('data-more-start', max > 1 && at > 1);
      el.toggleAttribute('data-more-end', max > 1 && at < max - 1);
    };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += (getComputedStyle(el).direction === 'rtl' ? -1 : 1) * e.deltaY;
    };
    mark();
    const resize = new ResizeObserver(mark);
    resize.observe(el);
    // Buttons come and go with the conversation's state.
    const changes = new MutationObserver(mark);
    changes.observe(el, { childList: true, subtree: true });
    el.addEventListener('scroll', mark, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      resize.disconnect();
      changes.disconnect();
      el.removeEventListener('scroll', mark);
      el.removeEventListener('wheel', wheel);
    };
  }, [ref]);
}
