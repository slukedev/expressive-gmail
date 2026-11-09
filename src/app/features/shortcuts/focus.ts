import { getVisibleThreadIds } from '../../data/actions';
import { reducedMotion } from '../../ui/motion';
import { useUi } from '../../state/ui';

/** Runs `fn` with the first match once it's laid out; a pane that just mounted, or a list coming back from a full-screen thread, takes a few frames. */
function whenShown(selector: string, fn: (el: HTMLElement) => void) {
  // By time, not frames: a busy machine draws far fewer of them.
  const until = performance.now() + 1000;
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el || !el.getClientRects().length) {
      if (performance.now() < until) requestAnimationFrame(attempt);
      return;
    }
    fn(el);
  };
  requestAnimationFrame(attempt);
}

export function focusRow(i: number) {
  const ids = getVisibleThreadIds();
  if (!ids.length) return;
  const index = Math.max(0, Math.min(ids.length - 1, i));
  useUi.getState().setCursor(index);
  whenShown(`.list-scroll [data-row-index="${index}"]`, (el) => {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  });
}

const THREAD_SCROLL = '.detail-pane .thread-scroll';

/** The open conversation takes the keyboard, so arrow keys and Space scroll it. */
export function focusThread() {
  whenShown(THREAD_SCROLL, (el) => el.focus({ preventScroll: true }));
}

/** Arrow keys move about this far, like a browser's own keyboard scrolling. */
const LINE = 48;

/** Scrolls the open conversation from wherever focus is, and hands it focus so held and later keys scroll natively. */
export function scrollThread(key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'): boolean {
  const el = document.querySelector<HTMLElement>(THREAD_SCROLL);
  if (!el) return false;
  el.focus({ preventScroll: true });
  const behavior = reducedMotion() ? 'auto' : 'smooth';
  if (key === 'Home') el.scrollTo({ top: 0, behavior });
  else if (key === 'End') el.scrollTo({ top: el.scrollHeight, behavior });
  else el.scrollBy({ top: key === 'ArrowDown' ? LINE : -LINE, behavior });
  return true;
}

export const isThreadScroller = (el: Element | null) => !!el?.matches(THREAD_SCROLL);
