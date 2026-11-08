import { Activity, Suspense, useCallback, useDeferredValue, useEffect, useRef, type CSSProperties } from 'react';
import { setSplitPane } from '../../data/actions';
import { useRoute } from '../../router/useRoute';
import { useSettings, updateSettings } from '../../state/settings';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { ListPane } from '../list/ListPane';
import { ThreadPane } from '../thread/ThreadPane';
import { SubscriptionsView } from '../subscriptions/SubscriptionsView';
import { AttachmentsView } from '../attachments/AttachmentsView';
import { FollowupsView } from '../followups/FollowupsView';
import { EmptyDetail } from '../thread/EmptyDetail';
import { preloadable } from '../../warmup';

// Pages opened now and then load their code on the way, or ahead in the warm-up.
const PurchasesView = preloadable(() => import('../../smart/PurchasesView').then((m) => m.PurchasesView));
const StorageView = preloadable(() => import('../storage/StorageView').then((m) => m.StorageView));
const AiInboxView = preloadable(() => import('../gemini/AiInboxView').then((m) => m.AiInboxView));

export function MainArea({ compact }: { compact: boolean }) {
  const route = useRoute();
  // The click paints first; the pane renders in slices after, so opening a conversation never holds a frame.
  const threadId = useDeferredValue(route.threadId);
  const readingPane = useSettings((s) => s.readingPane);
  const listWidth = useSettings((s) => s.listWidth);
  const wide = useMediaQuery('(min-width: 1180px)');
  const split = !compact && (readingPane === 'right' || (readingPane === 'auto' && wide));
  const mainRef = useRef<HTMLElement>(null);
  // Auto-advance follows whether a reading pane is actually showing.
  useEffect(() => setSplitPane(split), [split]);

  const special = route.view.kind === 'subscriptions' || route.view.kind === 'attachments' || route.view.kind === 'reminders' || route.view.kind === 'purchases' || route.view.kind === 'storage' || route.view.kind === 'ai-inbox';

  const onResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const main = mainRef.current;
    if (!main) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const left = main.getBoundingClientRect().left;
    const max = main.getBoundingClientRect().width - 420;
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(Math.max(ev.clientX - left, 340), Math.max(max, 340)));
      main.style.setProperty('--list-w', `${w}px`);
    };
    const up = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      const w = Math.round(Math.min(Math.max(ev.clientX - left, 340), Math.max(max, 340)));
      updateSettings({ listWidth: w });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }, []);

  if (special && route.threadId && route.view.kind !== 'reminders') {
    return (
      <main className="main main--single" ref={mainRef}>
        <ThreadPane threadId={route.threadId} single />
      </main>
    );
  }

  if (special) {
    return (
      <main className="main main--page" ref={mainRef}>
        {route.view.kind === 'subscriptions' && <SubscriptionsView />}
        {route.view.kind === 'attachments' && <AttachmentsView />}
        {/* Each page shows its own loading state once its code is in. */}
        <Suspense fallback={null}>
          {route.view.kind === 'purchases' && <PurchasesView />}
          {route.view.kind === 'storage' && <StorageView />}
          {route.view.kind === 'ai-inbox' && <AiInboxView />}
        </Suspense>
        {route.view.kind === 'reminders' && <FollowupsView split={split} />}
      </main>
    );
  }

  if (!split) {
    // The list stays mounted under a full-screen conversation, hidden, so coming back keeps its scroll and cursor.
    return (
      <main className="main main--single" ref={mainRef}>
        <Activity mode={threadId ? 'hidden' : 'visible'}>
          <ListPane split={false} />
        </Activity>
        {threadId && <ThreadPane threadId={threadId} single />}
      </main>
    );
  }

  return (
    <main className="main main--split" ref={mainRef} style={{ '--list-w': listWidth ? `${listWidth}px` : 'clamp(400px, 30vw, 600px)' } as CSSProperties}>
      <ListPane split />
      <div
        className="pane-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize list"
        tabIndex={0}
        onPointerDown={onResize}
        onDoubleClick={() => updateSettings({ listWidth: 0 })}
        onKeyDown={(e) => {
          const current = listWidth || (mainRef.current?.querySelector('.list-pane') as HTMLElement | null)?.offsetWidth || 440;
          if (e.key === 'ArrowLeft') updateSettings({ listWidth: Math.max(340, current - 24) });
          if (e.key === 'ArrowRight') updateSettings({ listWidth: Math.min(900, current + 24) });
        }}
      />
      {threadId ? <ThreadPane threadId={threadId} /> : <EmptyDetail />}
    </main>
  );
}
