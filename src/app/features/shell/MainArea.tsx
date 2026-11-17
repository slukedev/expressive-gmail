import { Activity, Suspense, useDeferredValue, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { setSplitPane } from '../../data/actions';
import { useRoute } from '../../router/useRoute';
import { useSettings, updateSettings } from '../../state/settings';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { ListPane } from '../list/ListPane';
import { viewKeyOf } from '../list/filters';
import { ThreadPane } from '../thread/ThreadPane';
import { SubscriptionsView } from '../subscriptions/SubscriptionsView';
import { AttachmentsView } from '../attachments/AttachmentsView';
import { FollowupsView } from '../followups/FollowupsView';
import { EmptyDetail } from '../thread/EmptyDetail';
import { preloadable } from '../../warmup';
import { ErrorBoundary, RegionFailed } from '../../ui/ErrorBoundary';

// Pages opened now and then load their code on the way, or ahead in the warm-up.
const PurchasesView = preloadable(() => import('../../smart/PurchasesView').then((m) => m.PurchasesView));
const StorageView = preloadable(() => import('../storage/StorageView').then((m) => m.StorageView));
const AiInboxView = preloadable(() => import('../gemini/AiInboxView').then((m) => m.AiInboxView));

const MIN_LIST = 340;
/** What the reading pane keeps beside the list. */
const MIN_READING = 420;
const KEY_STEP = 24;

const maxList = (main: HTMLElement) => Math.max(main.getBoundingClientRect().width - MIN_READING, MIN_LIST);
const clampList = (w: number, main: HTMLElement) => Math.round(Math.min(Math.max(w, MIN_LIST), maxList(main)));

export function MainArea({ compact }: { compact: boolean }) {
  const route = useRoute();
  // The click paints first; the pane renders in slices after, so opening a conversation never holds a frame.
  const threadId = useDeferredValue(route.threadId);
  const readingPane = useSettings((s) => s.readingPane);
  const listWidth = useSettings((s) => s.listWidth);
  const wide = useMediaQuery('(min-width: 1180px)');
  // Below this a pane on the right is a sliver beside the list (a laptop at 200% zoom); conversations open full size instead.
  const roomy = useMediaQuery('(min-width: 800px)');
  const split = !compact && ((readingPane === 'right' && roomy) || (readingPane === 'auto' && wide));
  const mainRef = useRef<HTMLElement>(null);
  // Auto-advance follows whether a reading pane is actually showing.
  useEffect(() => setSplitPane(split), [split]);

  const special = route.view.kind === 'subscriptions' || route.view.kind === 'attachments' || route.view.kind === 'reminders' || route.view.kind === 'purchases' || route.view.kind === 'storage' || route.view.kind === 'ai-inbox';
  const viewKey = viewKeyOf(route.view);

  const thread = (id: string, single?: boolean) => (
    <ErrorBoundary
      resetKey={id}
      fallback={(retry) => (
        <section className="detail-pane" aria-label="Conversation" data-single={single || undefined}>
          <RegionFailed title="Couldn't show this conversation" onRetry={retry} />
        </section>
      )}
    >
      <ThreadPane threadId={id} single={single} />
    </ErrorBoundary>
  );
  const list = (
    <ErrorBoundary
      resetKey={viewKey}
      fallback={(retry) => (
        <section className="list-pane" data-split={split || undefined} aria-label="Conversation list">
          <RegionFailed title="Couldn't show this list" onRetry={retry} />
        </section>
      )}
    >
      <ListPane split={split} />
    </ErrorBoundary>
  );

  if (special && route.threadId && route.view.kind !== 'reminders') {
    return (
      <main className="main main--single" ref={mainRef}>
        {thread(route.threadId, true)}
      </main>
    );
  }

  if (special) {
    return (
      <main className="main main--page" ref={mainRef}>
        <ErrorBoundary resetKey={viewKey} fallback={(retry) => <RegionFailed title="Couldn't show this page" onRetry={retry} />}>
          {route.view.kind === 'subscriptions' && <SubscriptionsView />}
          {route.view.kind === 'attachments' && <AttachmentsView />}
          {/* Each page shows its own loading state once its code is in. */}
          <Suspense fallback={null}>
            {route.view.kind === 'purchases' && <PurchasesView />}
            {route.view.kind === 'storage' && <StorageView />}
            {route.view.kind === 'ai-inbox' && <AiInboxView />}
          </Suspense>
          {route.view.kind === 'reminders' && <FollowupsView split={split} />}
        </ErrorBoundary>
      </main>
    );
  }

  if (!split) {
    // The list stays mounted under a full-screen conversation, hidden, so coming back keeps its scroll and cursor.
    return (
      <main className="main main--single" ref={mainRef}>
        <Activity mode={threadId ? 'hidden' : 'visible'}>{list}</Activity>
        {threadId && thread(threadId, true)}
      </main>
    );
  }

  return (
    <main className="main main--split" ref={mainRef} style={{ '--list-w': listWidth ? `${listWidth}px` : 'clamp(400px, 30vw, 600px)' } as CSSProperties}>
      {list}
      <PaneHandle mainRef={mainRef} />
      {threadId ? thread(threadId) : <EmptyDetail />}
    </main>
  );
}

/** Its own component: tracking the width for screen readers re-renders only the handle, never the panes. */
function PaneHandle({ mainRef }: { mainRef: RefObject<HTMLElement | null> }) {
  const [range, setRange] = useState({ now: 0, max: 0 });

  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === 'undefined') return;
    // Whichever list is there now: it remounts on a new view, or when its error boundary tries again.
    let pane: HTMLElement | null = null;
    const ro = new ResizeObserver(() => setRange({ now: pane ? Math.round(pane.getBoundingClientRect().width) : 0, max: Math.round(maxList(main)) }));
    const track = () => {
      const next = main.querySelector<HTMLElement>(':scope > .list-pane');
      if (next === pane) return;
      if (pane) ro.unobserve(pane);
      pane = next;
      if (pane) ro.observe(pane);
    };
    ro.observe(main);
    track();
    const mo = new MutationObserver(track);
    mo.observe(main, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [mainRef]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const main = mainRef.current;
    if (!main) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const left = main.getBoundingClientRect().left;
    let width: number | null = null;
    const move = (ev: PointerEvent) => {
      width = clampList(ev.clientX - left, main);
      main.style.setProperty('--list-w', `${width}px`);
    };
    // Fires after a release and after a cancel (a touch scroll taking over, the window losing the pointer) alike.
    const done = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', done);
      if (width !== null) updateSettings({ listWidth: width });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', done);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const main = mainRef.current;
    if (!main) return;
    const current = range.now || main.querySelector<HTMLElement>('.list-pane')?.offsetWidth || 440;
    const next =
      e.key === 'ArrowLeft' ? current - KEY_STEP : e.key === 'ArrowRight' ? current + KEY_STEP : e.key === 'Home' ? MIN_LIST : e.key === 'End' ? maxList(main) : null;
    if (next === null) return;
    e.preventDefault();
    updateSettings({ listWidth: clampList(next, main) });
  };

  return (
    <div
      className="pane-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize list"
      aria-valuenow={range.now || undefined}
      aria-valuemin={MIN_LIST}
      aria-valuemax={range.max || undefined}
      aria-valuetext={range.now ? `${range.now} pixels` : undefined}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => updateSettings({ listWidth: 0 })}
      onKeyDown={onKeyDown}
    />
  );
}
