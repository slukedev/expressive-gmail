import { useEffect, type RefObject } from 'react';

type Chrome = 'title' | 'hidden';

/** Gmail Android's list chrome: the title bar scrolls away and the search bar hides while scrolling down, back on scrolling up. Writes `data-chrome` only when it changes; CSS moves the bars with transforms. */
export function usePhoneChrome(appRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const set = (next: Chrome | null) => {
      if ((app.dataset.chrome ?? null) === next) return;
      if (next) app.dataset.chrome = next;
      else delete app.dataset.chrome;
    };
    if (!enabled) {
      set(null);
      return;
    }
    let last = 0;
    let scroller: HTMLElement | null = null;
    // Kept by a ResizeObserver: reading it per scroll event, after the data-chrome write, would force a layout each time.
    let bar = 80;
    let barEl: HTMLElement | null = null;
    const sizes = new ResizeObserver(([entry]) => {
      bar = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
    });
    const watchBar = (el: HTMLElement) => {
      const next = el.parentElement?.querySelector<HTMLElement>('.list-bar, .selection-bar') ?? null;
      if (next === barEl) return;
      if (barEl) sizes.unobserve(barEl);
      barEl = next;
      if (barEl) sizes.observe(barEl);
    };
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el.classList?.contains('list-scroll')) return;
      if (el !== scroller) {
        scroller = el;
        last = el.scrollTop;
      }
      if (!barEl?.isConnected) watchBar(el);
      const y = el.scrollTop;
      if (y <= 4) {
        set(null);
        last = y;
        return;
      }
      const delta = y - last;
      if (Math.abs(delta) < 6) return;
      last = y;
      if (delta > 0 && y > bar) set('hidden');
      else if (delta < 0) set(y > bar ? 'title' : null);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      sizes.disconnect();
      set(null);
    };
  }, [appRef, enabled]);
}
