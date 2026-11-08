import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePullToRefresh } from '../../src/app/features/list/usePullToRefresh';

/** A scroll box whose scrollTop the test moves, like a trackpad swipe would. */
function setup() {
  const el = document.createElement('div');
  let top = 0;
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v) => (top = v) });
  const refresh = vi.fn(async () => undefined);
  // A stable ref, as the list's useRef is.
  const ref = { current: el };
  const { result } = renderHook(() => usePullToRefresh(ref, refresh));
  const wheel = async (deltaY: number, gapMs = 16) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(gapMs);
      el.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0 }));
    });
  };
  const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(1_000)));
  return { el, refresh, result, wheel, settle, setTop: (v: number) => (top = v) };
}

describe('pull to refresh on a trackpad', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ignores scrolling back up to the top, momentum included, however far it carries on', async () => {
    const { refresh, wheel, settle, setTop } = setup();
    setTop(300);
    for (let i = 0; i < 10; i++) await wheel(-30);
    // The list reached the top mid-swipe; momentum keeps sending upward deltas.
    setTop(0);
    for (let i = 0; i < 40; i++) await wheel(-20);
    await settle();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on a deliberate swipe that starts at the top, but not a short nudge', async () => {
    const { refresh, wheel, settle } = setup();
    for (let i = 0; i < 4; i++) await wheel(-20, i === 0 ? 400 : 16);
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    for (let i = 0; i < 14; i++) await wheel(-20, i === 0 ? 400 : 16);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
