import { rawId } from '../../data/accounts/ids';
import { AccountFilter } from '../accounts/AccountFilter';
import { useAccountViews, useIsMerged } from '../accounts/AccountBits';
import { accountScope, useAccounts } from '../../data/accounts/store';
import { switchScope } from '../accounts/switch';
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { setVisibleThreadIds } from '../../data/actions';
import { useAccount, useLabels, useThreadList, useViewQuery } from '../../data/hooks';
import { useQuery } from '@tanstack/react-query';
import type { ThreadSummary } from '../../data/types';
import { CATEGORY_LABEL, stillInView } from '../../data/views';
import type { Label } from '../../data/types';
import type { View } from '../../router/routes';
import { useRoute } from '../../router/useRoute';
import { useLocal } from '../../state/local';
import { useSettings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { LinearProgress } from '../../ui/Progress';
import { CategoryTabs } from './CategoryTabs';
import { ListEmpty, ListError } from './ListStates';
import { ListSkeleton } from './ListSkeleton';
import { ListToolbar } from './ListToolbar';
import { SearchChips } from '../search/SearchChips';
import { SearchAnswer } from '../gemini/SearchAnswer';
import { ThreadRow } from './ThreadRow';
import { SelectionBar } from './SelectionBar';
import { Button } from '../../ui/Button';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { usePullToRefresh } from './usePullToRefresh';
import { useRowHover } from './rowHover';
import { keys, queryClient } from '../../data/client';
import { Icon } from '../../ui/Icon';
import { SCHEDULED, ScheduledSoon } from '../../smart/ScheduledSoon';
import { SentNudges, sentNudgesQuery } from '../../smart/SentNudges';
import { ReplyLaterEmpty, ReplyLaterStack } from '../replylater/ReplyLaterStack';
import { useAside, visibleItems } from '../replylater/store';
import { Chip } from '../../ui/Chip';
import { filteredQuery, LIST_FILTERS, useListFilters, viewKeyOf } from './filters';
import { resumeInbox, useInboxPause } from '../pause/pause';
import { describeTime } from '../../lib/presets';
import { dateGroup } from '../../lib/format';

const NO_LABELS: Label[] = [];

export function ListPane({ split }: { split: boolean }) {
  const route = useRoute();
  const view = route.view;
  const q = useViewQuery(view);
  const viewKey = viewKeyOf(view);
  // Filters belong to the view they were set on: a remount keeps them, a new view never inherits them.
  const [filters, setFilters] = useListFilters(view);
  const merged = useIsMerged();
  const listQuery = filteredQuery(q, filters);
  const list = useThreadList(view, listQuery);
  // A change to the list on screen re-renders its rows in slices after the frame that showed it; a different list shows at once.
  const listKey = `${viewKey}\u0000${listQuery}`;
  const tagged = useMemo(() => ({ key: listKey, data: list.data }), [listKey, list.data]);
  const deferred = useDeferredValue(tagged);
  const listData = deferred.key === listKey && deferred.data && list.data ? deferred.data : list.data;
  const failedToOpen = useAccounts((s) => s.missing);
  const unavailable = useMemo(() => {
    const listed = list.data?.pages[0]?.unavailable ?? [];
    const all = [...failedToOpen, ...listed.filter((u) => !failedToOpen.some((f) => f.email.toLowerCase() === u.email.toLowerCase()))];
    return all.length ? all : undefined;
  }, [failedToOpen, list.data]);
  const { data: labels = NO_LABELS } = useLabels();
  // Rows draw label names and colours only; unread counts change on every read and would re-render every row.
  const labelsKey = labels.map((l) => `${l.id}\u0000${l.name}\u0000${l.color?.background ?? ''}\u0000${l.color?.text ?? ''}`).join('\u0001');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowLabels = useMemo(() => labels, [labelsKey]);
  const pinned = useLocal((s) => s.pinned);
  const inboxType = useSettings((s) => s.inboxType);
  const groupByDate = useSettings((s) => s.groupByDate);
  const selected = useUi((s) => s.selected);
  const listWidth = useSettings((s) => s.listWidth);
  const compact = useMediaQuery('(max-width: 599px)');
  const narrow = compact || (split && (listWidth ? listWidth < 640 : true));
  const scrollRef = useRef<HTMLDivElement>(null);
  // State, not a ref: the sentinel comes and goes with the rows.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useRowHover(scrollRef);

  const threads = useMemo(() => {
    const seen = new Set<string>();
    const all: ThreadSummary[] = [];
    for (const page of listData?.pages ?? []) {
      for (const t of page.threads) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        all.push(t);
      }
    }
    return all;
  }, [listData]);

  const isInbox = (view.kind === 'folder' && view.folder === 'inbox') || (view.kind === 'category' && view.category === 'primary');
  const pause = useInboxPause();
  const paused = !!pause && (isInbox || view.kind === 'category');
  // While paused, unread mail that arrived after the pause waits out of sight; a thread you reply to stays put.
  const held = useMemo(
    () => (paused ? threads.filter((t) => t.lastDate > pause.since && t.labelIds.includes('UNREAD')) : []),
    [paused, pause, threads],
  );
  // Set aside to reply later: those live in the stack at the top instead.
  const asideItems = useAside((s) => s.items);
  const { pinnedRows, rows } = useMemo(() => {
    const heldIds = new Set(held.map((t) => t.id));
    const asideIds = isInbox ? new Set(asideItems.map((i) => i.threadId)) : null;
    const visible = heldIds.size || asideIds?.size ? threads.filter((t) => !heldIds.has(t.id) && !asideIds?.has(rawId(t.id))) : threads;
    let ordered = visible;
    if (isInbox && inboxType !== 'categories' && inboxType !== 'everything') {
      const flag = inboxType === 'unread-first' ? 'UNREAD' : inboxType === 'important-first' ? 'IMPORTANT' : 'STARRED';
      ordered = [...visible.filter((t) => t.labelIds.includes(flag)), ...visible.filter((t) => !t.labelIds.includes(flag))];
    }
    if (!isInbox || !pinned.length) return { pinnedRows: [] as ThreadSummary[], rows: ordered };
    const pinSet = new Set(pinned);
    return {
      pinnedRows: ordered.filter((t) => pinSet.has(rawId(t.id))).sort((a, b) => pinned.indexOf(rawId(a.id)) - pinned.indexOf(rawId(b.id))),
      rows: ordered.filter((t) => !pinSet.has(rawId(t.id))),
    };
  }, [threads, held, isInbox, inboxType, pinned, asideItems]);

  // What the reader can see; Select all never reaches held mail.
  const visibleThreads = useMemo(() => [...pinnedRows, ...rows], [pinnedRows, rows]);
  const orderedIds = useMemo(() => visibleThreads.map((t) => t.id), [visibleThreads]);
  useEffect(() => setVisibleThreadIds(orderedIds), [orderedIds]);
  // Rows that leave leave the selection too, or the bar counts mail you can't see.
  useEffect(() => {
    const ui = useUi.getState();
    if (!ui.selected.size) return;
    const listed = new Set(orderedIds);
    const keep = [...ui.selected].filter((id) => listed.has(id));
    if (keep.length !== ui.selected.size) ui.setSelected(new Set(keep));
  }, [orderedIds]);


  // After a page fails, wait for Load more instead of retrying.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  const autoLoad = hasNextPage && !isFetchingNextPage && !isFetchNextPageError;
  useEffect(() => {
    if (!sentinel || !autoLoad) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void fetchNextPage();
      },
      { root: scrollRef.current, rootMargin: '600px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinel, autoLoad, fetchNextPage]);

  // A new view starts at the top with nothing selected; coming back to the same one (from a full-screen thread) keeps its place.
  const shownView = useRef<string | null>(null);
  const scrollPos = useRef(0);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (shownView.current === viewKey) {
      // Hidden lists lose their scroll offset.
      if (el && el.scrollTop !== scrollPos.current) el.scrollTop = scrollPos.current;
      return;
    }
    shownView.current = viewKey;
    scrollPos.current = 0;
    el?.scrollTo({ top: 0 });
    setScrolled(false);
    useUi.getState().clearSelection();
    useUi.getState().setCursor(-1);
  }, [viewKey]);

  // The keyboard cursor follows the open thread, and so does focus when it's on a row, so Enter and x act on the row you're reading.
  useEffect(() => {
    const index = route.threadId ? orderedIds.indexOf(route.threadId) : -1;
    if (index < 0) return;
    const ui = useUi.getState();
    if (ui.cursor !== index) ui.setCursor(index);
    const current = document.activeElement;
    if (!(current instanceof HTMLElement) || !current.matches('[data-row-index]')) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
    if (!row || row === current) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
  }, [route.threadId, orderedIds]);

  const showTabs = (isInbox && inboxType === 'categories') || view.kind === 'category';
  const heroMeta = useHeroMeta(view, labels, list.data?.pages[0]?.resultSizeEstimate, list.data?.pages[0]?.resultSizeAtLeast);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrArrowRef = useRef<HTMLSpanElement>(null);
  const ptr = usePullToRefresh(
    scrollRef,
    () => Promise.all([list.refetch(), queryClient.invalidateQueries({ queryKey: keys.labels })]),
    { indicator: ptrRef, arrow: ptrArrowRef },
  );
  const refreshing = list.isRefetching && !list.isFetchingNextPage && !ptr.refreshing;

  const activeFilters = LIST_FILTERS.filter((f) => filters.includes(f.id));
  // The app bar doesn't repeat "You're all caught up". An empty inbox with replies set aside isn't inbox zero.
  const waiting = isInbox && !filters.length && visibleItems(asideItems).length > 0;
  const inboxZero = isInbox && list.isSuccess && !filters.length && !pinnedRows.length && !rows.length && !held.length;

  const pauseBanner = paused && (
    <div className="pause-banner" role="status">
      <Icon name="pause_circle" size={24} className="pause-banner__icon" />
      <div className="pause-banner__text">
        <p className="md-title-small">{pause.until ? `Inbox paused until ${describeTime(pause.until)}` : 'Inbox paused'}</p>
        <p className="md-body-medium">
          {held.length
            ? `${held.length} new ${held.length === 1 ? 'conversation is' : 'conversations are'} waiting.`
            : 'New mail waits here until you resume.'}
        </p>
      </div>
      <Button variant="text" size="s" icon="play_arrow" onClick={resumeInbox}>
        Resume
      </Button>
    </div>
  );

  // A cold start (no cached inbox) also waits for what sits above the rows, so Scheduled and Follow-ups don't land later and push every row down. Not for long.
  const asides = isInbox && !filters.length;
  const scheduledList = useThreadList(SCHEDULED, 'in:scheduled', asides);
  const nudgesList = useQuery({ ...sentNudgesQuery, enabled: asides });
  const { isPending: accountPending } = useAccount();
  const [cold] = useState(() => list.isPending);
  const [stopWaiting, setStopWaiting] = useState(false);
  const asidesPending = cold && asides && !stopWaiting && (scheduledList.isPending || nudgesList.isPending || accountPending);
  useEffect(() => {
    if (!asidesPending || list.isPending) return;
    const t = window.setTimeout(() => setStopWaiting(true), 1_500);
    return () => window.clearTimeout(t);
  }, [asidesPending, list.isPending]);

  let body;
  if (list.isPending || asidesPending) body = <ListSkeleton />;
  else if (list.isError) body = <ListError error={list.error} onRetry={() => void list.refetch()} />;
  else if (!pinnedRows.length && !rows.length && !held.length)
    body = (
      <>
        {pauseBanner}
        {isInbox && !filters.length && <ReplyLaterStack threads={threads} />}
        {/* Kept from the list above, so the last rows leaving doesn't also pull the follow-ups out. */}
        {isInbox && !filters.length && <ScheduledSoon />}
        {isInbox && !filters.length && <SentNudges />}
        {waiting ? (
          <ReplyLaterEmpty />
        ) : (
          <ListEmpty
            view={view}
            filtered={filters.length ? activeFilters.map((f) => f.label.toLowerCase()).join(', ') : undefined}
            onClearFilters={() => setFilters([])}
          />
        )}
      </>
    );
  else {
    let index = 0;
    const renderGroup = (group: ThreadSummary[]) => (
      <div className="seg-list" role="presentation">
        {group.map((t) => {
          const i = index++;
          return (
            <ThreadRow
              key={t.id}
              thread={t}
              index={i}
              view={view}
              active={route.threadId === t.id}
              selected={selected.has(t.id)}
              leaving={stillInView(view, t, labels) === false}
              pinned={pinned.includes(rawId(t.id))}
              labels={rowLabels}
            />
          );
        })}
      </div>
    );
    // A section whose rows are all leaving folds its header away with them, so nothing below jumps.
    const allLeaving = (group: ThreadSummary[]) => group.length > 0 && group.every((t) => stillInView(view, t, labels) === false);
    // Date sections only make sense when the list is newest first.
    const reordered = isInbox && inboxType !== 'categories' && inboxType !== 'everything';
    const timed = view.kind === 'folder' && (view.folder === 'scheduled' || view.folder === 'snoozed');
    const sections: { title: string; rows: ThreadSummary[] }[] = [];
    if (groupByDate && !reordered && !timed) {
      const now = Date.now();
      for (const t of rows) {
        const title = dateGroup(t.lastDate, now);
        const last = sections[sections.length - 1];
        if (last?.title === title) last.rows.push(t);
        else sections.push({ title, rows: [t] });
      }
    }
    body = (
      <div role="list" aria-label="Conversations" className="thread-list" data-grouped={sections.length > 0 || undefined}>
        {pauseBanner}
        {isInbox && !filters.length && <ReplyLaterStack threads={threads} />}
        {isInbox && !filters.length && <ScheduledSoon />}
        {isInbox && !filters.length && <SentNudges />}
        {pinnedRows.length > 0 && (
          <>
            <SectionHeader title="Pinned" leaving={allLeaving(pinnedRows)} />
            {renderGroup(pinnedRows)}
            {!sections.length && <SectionHeader title="Everything else" leaving={allLeaving(rows) || allLeaving(pinnedRows)} />}
          </>
        )}
        {sections.length > 0
          ? sections.map((s) => (
              <div key={s.title} className="list-group" role="presentation">
                <SectionHeader title={s.title} leaving={allLeaving(s.rows)} />
                {renderGroup(s.rows)}
              </div>
            ))
          : rows.length > 0 && renderGroup(rows)}
        <div ref={setSentinel} className="list-sentinel" />
        {list.isFetchingNextPage && (
          <div className="list-more">
            <LoadingIndicator size={40} label="Loading more conversations" />
          </div>
        )}
        {!list.hasNextPage && rows.length + pinnedRows.length > 20 && (
          <p className="list-end md-body-small">That's everything in this view</p>
        )}
        {list.hasNextPage && !list.isFetchingNextPage && (
          <div className="list-more">
            <Button variant="text" onClick={() => void list.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="list-pane" data-split={split || undefined} data-selecting={selected.size > 0 || undefined} aria-label="Conversation list">
      {/* The selection toolbar sits over the app bar in one cell, so selecting never moves the list. */}
      <div className="list-head" data-selecting={selected.size > 0 || undefined}>
        <div className="list-head__bar" inert={selected.size > 0}>
          <ListToolbar
            view={view}
            threads={visibleThreads}
            meta={inboxZero ? null : heroMeta}
            metaPending={!labels.length && (isInbox || view.kind === 'category')}
            scrolled={scrolled}
          />
        </div>
        {selected.size > 0 && <SelectionBar view={view} threads={visibleThreads} />}
      </div>
      <div className="list-progress" aria-hidden={!refreshing}>
        {refreshing && <LinearProgress label="Refreshing" />}
      </div>
      <div
        ref={ptrRef}
        className="ptr"
        aria-hidden={!ptr.refreshing}
      >
        {ptr.refreshing ? (
          <LoadingIndicator contained size={48} label="Refreshing" />
        ) : (
          <span ref={ptrArrowRef} className="ptr__arrow">
            <Icon name="refresh" size={24} />
          </span>
        )}
      </div>
      <div
        className="list-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          scrollPos.current = e.currentTarget.scrollTop;
          setScrolled(scrollPos.current > 4);
        }}
      >
        {activeFilters.length > 0 && (
          <div className="list-filters" role="toolbar" aria-label="Active filters">
            {activeFilters.map((f) => (
              <Chip
                key={f.id}
                kind="input"
                icon={f.icon}
                selected
                onRemove={() => setFilters(filters.filter((x) => x !== f.id))}
                removeLabel={`Remove ${f.label} filter`}
                onClick={() => setFilters(filters.filter((x) => x !== f.id))}
              >
                {f.label}
              </Chip>
            ))}
            {activeFilters.length > 1 && (
              <Button variant="text" size="s" onClick={() => setFilters([])}>
                Clear all
              </Button>
            )}
          </div>
        )}
        {merged && <AccountFilter missing={unavailable?.map((m) => m.email)} />}
        {unavailable?.length ? <UnavailableNotice missing={unavailable} onRetry={() => void list.refetch()} /> : null}
        {showTabs && <CategoryTabs bundles={narrow} />}
        {view.kind === 'search' && <SearchChips query={view.query} />}
        {view.kind === 'search' && <SearchAnswer query={view.query} />}
        {body}
      </div>
    </section>
  );
}

function SectionHeader({ title, leaving }: { title: string; leaving: boolean }) {
  return (
    <h2 className="list-section md-label-large" data-leaving={leaving || undefined}>
      <span className="list-section__text">{title}</span>
    </h2>
  );
}

/** Instead of looking complete. */
function UnavailableNotice({ missing, onRetry }: { missing: { email: string; message: string }[]; onRetry: () => void }) {
  const accounts = useAccountViews();
  // Named the way the chips above name them.
  const views = missing.map((m) => ({ ...m, view: accounts.find((a) => a.email.toLowerCase() === m.email.toLowerCase()) }));
  const who = views.map((m) => m.view?.short ?? m.email).join(', ');
  // Accounts this browser hasn't opened yet: opening each once lets this page read it.
  const unopened = views.filter((m) => /open .* once/i.test(m.message) && m.view);
  return (
    <div className="list-notice" role="status">
      <Icon name={unopened.length ? 'link' : 'cloud_off'} size={20} className="list-notice__icon" />
      <p className="md-body-medium list-notice__text">
        {unopened.length === views.length
          ? `Open ${who} once to see ${views.length === 1 ? 'its' : 'their'} mail here.`
          : `Mail from ${who} couldn't load, so it's missing from this list.`}
      </p>
      {unopened.length ? (
        <Button variant="text" size="s" onClick={() => void switchScope(accountScope(unopened[0]!.email))}>
          Open {unopened[0]!.view!.short}
        </Button>
      ) : (
        <Button variant="text" size="s" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Counts come from the label list, the same source as the menu. */
function useHeroMeta(view: View, labels: Label[], estimate?: number, atLeast?: boolean): string | null {
  const unread = (id: string) => labels.find((l) => l.id === id)?.unreadCount ?? 0;
  const total = (id: string) => labels.find((l) => l.id === id)?.totalCount;
  const fmt = (n: number, word: string) => `${n.toLocaleString()} ${word}`;
  // Until labels load, "All caught up" would be a guess.
  if (!labels.length && view.kind !== 'search') return null;
  switch (view.kind) {
    case 'search':
      if (estimate === undefined) return null;
      return atLeast ? `${estimate.toLocaleString()}+ conversations` : fmt(estimate, estimate === 1 ? 'conversation' : 'conversations');
    case 'category': {
      const n = view.category === 'primary' ? unread('INBOX') : unread(CATEGORY_LABEL[view.category]);
      return n ? fmt(n, 'unread') : 'All caught up';
    }
    case 'label': {
      const l = labels.find((x) => x.name === view.label);
      return l?.unreadCount ? fmt(l.unreadCount, 'unread') : null;
    }
    case 'folder':
      if (view.folder === 'inbox') return unread('INBOX') ? fmt(unread('INBOX'), 'unread') : 'All caught up';
      if (view.folder === 'drafts' || view.folder === 'scheduled') {
        const t = total(view.folder === 'drafts' ? 'DRAFT' : 'SCHEDULED');
        return t ? fmt(t, t === 1 ? 'message' : 'messages') : null;
      }
      if (view.folder === 'spam' || view.folder === 'trash') return 'Messages here are deleted after 30 days';
      return null;
    default:
      return null;
  }
}
