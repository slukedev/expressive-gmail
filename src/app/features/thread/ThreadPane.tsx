import { rawId } from '../../data/accounts/ids';
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getVisibleThreadIds, mail } from '../../data/actions';
import { prefetchThread, useAccount, useLabels, useMe, useThread } from '../../data/hooks';
import { isMe } from '../../lib/format';
import type { Message, Thread } from '../../data/types';
import { closeThread, openThread, useRoute } from '../../router/useRoute';
import { useLocal, local } from '../../state/local';
import { useUi } from '../../state/ui';
import { useShallow } from 'zustand/react/shallow';
import { useSettings } from '../../state/settings';
import { IconButton } from '../../ui/Button';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import { LabelChip } from '../labels/LabelChip';
import { AccountChip, useThreadAccount } from '../accounts/AccountBits';
import { LabelMenu } from '../labels/LabelMenu';
import { SnoozeDialog, SnoozeMenu, SnoozeSubmenu } from '../snooze/SnoozeMenu';
import { MessageCard } from './MessageCard';
import { ReplyBar } from './ReplyBar';
import { SummaryCard } from '../gemini/SummaryCard';
import { ThreadNote } from './ThreadNote';
import { EmptyArt } from '../../ui/EmptyArt';
import { Button } from '../../ui/Button';
import { InlineCompose } from '../compose/InlineCompose';
import { ReminderMenu } from '../followups/ReminderMenu';
import { BackendError } from '../../data/backend';
import { printThread } from './print';
import { SmartCards } from '../../smart/SmartCards';
import { SpamBanner } from '../../smart/Banners';
import { ScheduledBanner } from '../schedule/ScheduledBanner';
import { ReplyLaterButton, ReplyLaterSession } from '../replylater/ReplyLaterControls';
import { aside, isAside, useAside } from '../replylater/store';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useScrollRow } from '../../ui/useScrollRow';
import { describeTime } from '../../lib/presets';
import { forwardAll } from '../compose/open';
import { filterLikeThese } from './filterLike';
import { findThread } from '../../data/client';
import { BodySizingContext, useBodySizing, type BodySizing } from './sizing';

const HIDDEN = new Set(['UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SNOOZED', 'SCHEDULED', 'CHAT', 'MUTED']);

export function ThreadPane({ threadId, single }: { threadId: string; single?: boolean }) {
  const { data: latest, isPending, isError, error, refetch } = useThread(threadId);
  // Edits to the open thread re-render it in slices after the frame that showed the action. Archive moves on, so the old one never re-renders.
  const lagging = useDeferredValue(latest);
  // Moving on (archive, j / k): the router names the next thread, and this one keeps what it shows until replaced.
  const route = useRoute();
  const leaving = route.threadId !== threadId;
  const thread = (lagging && latest && lagging.id === latest.id) || leaving ? lagging : latest;
  // The clicked row already knows the subject, labels and senders: show those while the messages load.
  const known = useMemo(() => (isPending ? findThread(threadId) : undefined), [threadId, isPending]);
  const view = useMemo<Thread | undefined>(() => thread ?? latest ?? (known && { ...known, messages: [] }), [thread, latest, known]);
  // The header paints first; the messages follow a frame later.
  const shownId = useDeferredValue(thread?.id ?? null, null);
  const { data: labels = [] } = useLabels();
  const { data: account } = useAccount();
  const me = useMe();
  const owner = useThreadAccount(threadId);
  const pinned = useLocal((s) => s.pinned.includes(rawId(threadId)));
  const hasNote = useLocal((s) => !!s.notes[rawId(threadId)]);
  const [noteOpen, setNoteOpen] = useState(false);
  const smartFeatures = useSettings((s) => s.smartFeatures);
  // Only which compose: its text changes on every keystroke.
  const inlineKey = useUi((s) => s.composes.find((c) => c.inline && c.threadId === threadId)?.key);
  const compact = useMediaQuery('(max-width: 599px)');
  const setAside = useAside((s) => isAside(s.items, threadId));
  const [pickingSnooze, setPickingSnooze] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useScrollRow(toolbarRef);
  const markedRead = useRef<string | null>(null);

  // Once per open.
  useEffect(() => {
    if (!view || markedRead.current === view.id) return;
    markedRead.current = view.id;
    if (view.labelIds.includes('UNREAD')) void mail.markRead([view.id], true, true);
  }, [view]);

  // Only scrolls when it has to: scrollTo forces a layout of the pane it just rendered.
  const scrollTop = useRef(0);
  useEffect(() => {
    if (scrollTop.current) scrollRef.current?.scrollTo({ top: 0 });
    scrollTop.current = 0;
    setNoteOpen(false);
  }, [threadId]);

  useEffect(() => setNoteOpen(hasNote), [hasNote, threadId]);

  const ids = getVisibleThreadIds();
  const position = ids.indexOf(threadId);
  const newer = position > 0 ? ids[position - 1] : undefined;
  const older = position >= 0 && position < ids.length - 1 ? ids[position + 1] : undefined;
  useEffect(() => {
    if (older) void prefetchThread(older);
  }, [older]);

  const threadLabels = useMemo(
    () =>
      view
        ? labels.filter((l) => view.labelIds.includes(l.id) && !HIDDEN.has(l.id) && !l.id.startsWith('CATEGORY_'))
        : [],
    [view, labels],
  );

  // Gmail expands unread messages and the newest one.
  const initiallyExpanded = useMemo(() => {
    if (!thread) return new Set<string>();
    const set = new Set<string>();
    const msgs = thread.messages.filter((m) => !m.isDraft);
    msgs.forEach((m) => m.labelIds.includes('UNREAD') && set.add(m.id));
    if (msgs.length) set.add(msgs[msgs.length - 1].id);
    return set;
  }, [thread?.id, !thread]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids1 = [threadId];
  // Gmail's "Filter messages like these" starts from the newest sender who isn't you.
  const filterFrom = thread ? [...thread.messages].reverse().find((m) => !m.isDraft && !isMe(m.from.email, me))?.from.email : undefined;
  const inInbox = view?.labelIds.includes('INBOX');
  const inTrash = view?.labelIds.includes('TRASH');
  const inSpam = view?.labelIds.includes('SPAM');
  const starred = view?.labelIds.includes('STARRED');
  const important = view?.labelIds.includes('IMPORTANT');

  // Stable while the thread hasn't changed, so toolbar and position updates don't re-render every message.
  const messages = useMemo(
    () =>
      thread && (
        <>
          <ReplyLaterSession threadId={thread.id} />
          <SpamBanner thread={thread} />
          <ScheduledBanner thread={thread} />
          <SummaryCard thread={thread} />
          {smartFeatures && <SmartCards thread={thread} />}
          <MessageList messages={thread.messages} initiallyExpanded={initiallyExpanded} threadId={thread.id} />
          {inlineKey ? <InlineReply composeKey={inlineKey} /> : <ReplyBar thread={thread} />}
        </>
      ),
    [thread, smartFeatures, initiallyExpanded, inlineKey],
  );

  // M3 top app bars take a container color once content scrolls under them.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setScrolled(false), [threadId]);
  // Watched, not computed per scroll event.
  const [pastSubject, setPastSubject] = useState(false);
  const subjectRef = useRef<HTMLHeadingElement>(null);
  const viewId = view?.id;
  useEffect(() => {
    setPastSubject(false);
    const el = subjectRef.current;
    const root = scrollRef.current;
    if (!el || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPastSubject(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)), { root });
    io.observe(el);
    return () => io.disconnect();
  }, [viewId]);

  return (
    <section className="detail-pane" aria-label="Conversation" data-single={single || undefined}>
      <div ref={toolbarRef} className="thread-toolbar" role="toolbar" aria-label="Conversation actions" data-scrolled={scrolled || undefined}>
        {single && <IconButton icon="arrow_back" label="Back to list" shortcut="u" className="thread-toolbar__back" onClick={() => closeThread()} />}
        {view && (
          <>
            {inTrash ? (
              <IconButton icon="restore_from_trash" label="Restore" onClick={() => void mail.untrash(ids1)} />
            ) : inSpam ? (
              <IconButton icon="report" label="Not spam" onClick={() => void mail.notSpam(ids1)} />
            ) : inInbox ? (
              <IconButton icon="archive" label="Archive" shortcut="e" onClick={() => void mail.archive(ids1)} />
            ) : (
              <IconButton icon="move_to_inbox" label="Move to Inbox" onClick={() => void mail.moveToInbox(ids1)} />
            )}
            {!inSpam && !inTrash && <IconButton icon="report" label="Report spam" shortcut="!" onClick={() => void mail.spam(ids1)} />}
            {inTrash ? (
              <IconButton icon="delete_forever" label="Delete forever" onClick={() => void mail.deleteForever(ids1)} />
            ) : (
              <IconButton icon="delete" label="Delete" shortcut="#" onClick={() => void mail.trash(ids1)} />
            )}
            <span className="toolbar-divider" />
            <IconButton
              icon="mark_email_unread"
              label="Mark as unread"
              shortcut="Shift U"
              onClick={() => {
                void mail.markRead(ids1, false, true);
                closeThread();
              }}
            />
            {/* Phones keep four actions in the bar, like Gmail Android. */}
            {!compact &&
              (view.labelIds.includes('SNOOZED') ? (
                <IconButton icon="alarm_on" label="Unsnooze" onClick={() => void mail.unsnooze(ids1)} />
              ) : (
                <SnoozeMenu ids={ids1} trigger={<IconButton icon="schedule" label="Snooze" shortcut="b" />} />
              ))}
            <ReminderMenu thread={view} />
            {!compact && <ReplyLaterButton thread={view} />}
            <span className="toolbar-divider" />
            <LabelMenu ids={ids1} mode="move" trigger={<IconButton icon="drive_file_move" label="Move to" shortcut="v" />} />
            <LabelMenu ids={ids1} mode="label" trigger={<IconButton icon="label" label="Labels" shortcut="l" />} />
            <Menu trigger={<IconButton icon="more_vert" label="More" />} align="end">
              {compact && (
                <>
                  {view.labelIds.includes('SNOOZED') ? (
                    <MenuItem icon="alarm_on" onClick={() => void mail.unsnooze(ids1)}>
                      Unsnooze
                    </MenuItem>
                  ) : (
                    <SnoozeSubmenu ids={ids1} onCustom={() => setPickingSnooze(true)} />
                  )}
                  <MenuItem icon="pending_actions" onClick={() => aside.toggle(view)}>
                    {setAside ? 'Remove from Reply later' : 'Reply later'}
                  </MenuItem>
                  {!inSpam && (
                    <MenuItem icon="report" onClick={() => void mail.spam(ids1)}>
                      Report spam
                    </MenuItem>
                  )}
                  {position >= 0 && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon="chevron_left" disabled={!newer} onClick={() => newer && openThread(newer, route.view)}>
                        Newer
                      </MenuItem>
                      <MenuItem icon="chevron_right" disabled={!older} onClick={() => older && openThread(older, route.view)}>
                        Older
                      </MenuItem>
                    </>
                  )}
                  <MenuSeparator />
                </>
              )}
              <MenuItem icon="keep" onClick={() => local.togglePin(threadId)}>
                {pinned ? 'Unpin from top' : 'Pin to top of inbox'}
              </MenuItem>
              <MenuItem icon="sticky_note_2" onClick={() => setNoteOpen(true)}>
                {hasNote ? 'Edit note' : 'Add a private note'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon="label_important" onClick={() => void mail.important(ids1, !important)}>
                {important ? 'Mark as not important' : 'Mark as important'}
              </MenuItem>
              <MenuItem icon="notifications_off" onClick={() => void mail.mute(ids1)}>
                Mute
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon="forward" disabled={!thread} onClick={() => thread && forwardAll(thread)}>
                Forward all
              </MenuItem>
              <MenuItem icon="print" disabled={!thread} onClick={() => thread && printThread(thread, account?.email)}>
                Print all
              </MenuItem>
              {filterFrom && !compact && (
                <MenuItem icon="filter_alt" onClick={() => filterLikeThese(filterFrom)}>
                  Filter messages like these
                </MenuItem>
              )}
            </Menu>
            <SnoozeDialog open={pickingSnooze} onClose={() => setPickingSnooze(false)} onPick={(t) => void mail.snooze(ids1, t, describeTime(t))} />
          </>
        )}
        <span className="thread-toolbar__spacer">
          {/* On wide panes the subject shows here once it scrolls away. A copy of the heading, so screen readers skip it. */}
          {view && (
            <span className="thread-toolbar__title md-title-medium" data-shown={pastSubject || undefined} aria-hidden="true" dir="auto">
              {view.subject || '(no subject)'}
            </span>
          )}
        </span>
        {position >= 0 && !compact && (
          <>
            <span className="thread-toolbar__pos md-body-small">
              {(position + 1).toLocaleString()} of {ids.length.toLocaleString()}
            </span>
            <IconButton icon="chevron_left" label="Newer" shortcut="k" disabled={!newer} onClick={() => newer && openThread(newer, route.view)} />
            <IconButton icon="chevron_right" label="Older" shortcut="j" disabled={!older} onClick={() => older && openThread(older, route.view)} />
          </>
        )}
      </div>

      <div className="thread-scroll" ref={scrollRef} tabIndex={-1} onScroll={(e) => {
          scrollTop.current = e.currentTarget.scrollTop;
          setScrolled(scrollTop.current > 4);
        }}>
        {isPending && !view && (
          <div className="thread-loading">
            <LoadingIndicator size={48} label="Loading conversation" />
          </div>
        )}
        {isError && (
          <div className="empty" role="alert">
            <EmptyArt icon={error instanceof BackendError && error.code === 'not-found' ? 'search_off' : 'error'} tone="error" />
            <h2 className="md-title-large empty__title">
              {error instanceof BackendError && error.code === 'not-found' ? 'This conversation is gone' : "Couldn't open this conversation"}
            </h2>
            <p className="md-body-medium empty__text">
              {error instanceof BackendError && error.code === 'not-found'
                ? 'It may have been deleted or moved.'
                : 'Check your connection and try again.'}
            </p>
            <Button variant="tonal" icon="refresh" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}
        {view && (
          <article key={view.id} className="thread" aria-labelledby={`subject-${view.id}`} aria-busy={!thread || undefined}>
            <header className="thread__head">
              <div className="thread__subject">
                {/* Only the subject is the heading; the chips after it are controls. */}
                <h1 ref={subjectRef} id={`subject-${view.id}`} className="thread__subject-text" dir="auto">
                  {view.subject || '(no subject)'}
                </h1>
                {owner && <AccountChip account={owner} size="medium" className="thread__account" />}
                {threadLabels.map((l) => (
                  <LabelChip
                    key={l.id}
                    label={l}
                    onRemove={
                      l.id === 'INBOX'
                        ? () => void mail.archive(ids1)
                        : () => void mail.addLabels(ids1, [], [l.id], `Label "${l.name}" removed`)
                    }
                  />
                ))}
              </div>
              <div className="thread__head-actions">
                {pinned && (
                  <Tooltip content="Pinned to the top of your inbox">
                    <span className="thread__pinned">
                      <IconButton icon="keep" label="Unpin" selected onClick={() => local.togglePin(threadId)} />
                    </span>
                  </Tooltip>
                )}
                <IconButton
                  key={view.id}
                  icon="star"
                  label={starred ? 'Starred' : 'Not starred'}
                  selected={!!starred}
                  className="thread__star"
                  onClick={() => void mail.star(ids1, !starred)}
                />
              </div>
            </header>
            {noteOpen && <ThreadNote threadId={threadId} onClose={() => setNoteOpen(false)} />}
            <Settle loaded={!!thread && shownId === thread.id} placeholder={<ThreadSkeleton thread={view} />}>
              {messages}
            </Settle>
          </article>
        )}
      </div>
    </section>
  );
}

function InlineReply({ composeKey }: { composeKey: string }) {
  const draft = useUi((s) => s.composes.find((c) => c.key === composeKey));
  return draft ? <InlineCompose draft={draft} /> : null;
}

const MessageList = memo(function MessageList({ messages, initiallyExpanded, threadId }: { messages: Message[]; initiallyExpanded: Set<string>; threadId: string }) {
  const editing = useUi(useShallow((s) => s.composes.flatMap((c) => (c.threadId === threadId && c.draftMessageId ? [c.draftMessageId] : []))));
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setExpanded(initiallyExpanded);
    setShowAll(false);
    setRevealed(new Set());
  }, [initiallyExpanded]);

  // A reply that arrives while the thread is open opens, like Gmail.
  const newest = messages.findLast((m) => !m.isDraft)?.id;
  const seenNewest = useRef(newest);
  useEffect(() => {
    if (!newest || newest === seenNewest.current) return;
    const known = seenNewest.current;
    seenNewest.current = newest;
    if (known) setExpanded((prev) => new Set(prev).add(newest));
  }, [newest]);

  useEffect(() => {
    const onExpand = (e: Event) => {
      const all = (e as CustomEvent<boolean>).detail;
      setExpanded(all ? new Set(messages.map((m) => m.id)) : new Set([messages[messages.length - 1]?.id]));
      if (all) setShowAll(true);
    };
    window.addEventListener('bg:expand-all', onExpand);
    return () => window.removeEventListener('bg:expand-all', onExpand);
  }, [messages]);

  // Opening or closing a message grows its card on the spatial spring instead of making everything under it jump: heights are read before React swaps the card and played back once laid out.
  const listRef = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<string, number>());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // The photo and name sit in both a folded and an open card; their old boxes are kept so they can glide over.
  const morphs = useRef(new Map<string, Map<string, DOMRect>>());
  const measure = (id: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
    if (!el) return;
    before.current.set(id, el.getBoundingClientRect().height);
    morphs.current.set(id, new Map([...el.querySelectorAll<HTMLElement>('[data-morph]')].map((m) => [m.dataset.morph!, m.getBoundingClientRect()])));
  };
  // Revealed cards play their entrance once.
  useEffect(() => {
    if (!revealed.size) return;
    const t = window.setTimeout(() => setRevealed(new Set()), 800);
    return () => window.clearTimeout(t);
  }, [revealed]);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easings = () => {
    const root = getComputedStyle(document.documentElement);
    return { spatial: root.getPropertyValue('--md-spring-0-8').trim() || 'ease-out', effects: root.getPropertyValue('--md-spring-1-0').trim() || 'ease-out' };
  };
  const grow = (el: HTMLElement, from: number) => {
    const to = el.getBoundingClientRect().height;
    if (!to || Math.abs(to - from) < 2 || reduced()) return;
    el.animate([{ height: `${from}px`, overflow: 'clip' }, { height: `${to}px`, overflow: 'clip' }], { duration: 435, easing: easings().spatial });
  };
  // The photo and name move from where they were; everything else fades in where it lands, so it reads as one card opening.
  const morph = (el: HTMLElement, was: Map<string, DOMRect> | undefined, opening: boolean) => {
    if (reduced()) return;
    const { spatial, effects } = easings();
    const fade = (node: Element) =>
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: opening ? 230 : 150, delay: opening ? 60 : 0, easing: effects, fill: 'backwards' });
    const visit = (node: Element) => {
      const key = (node as HTMLElement).dataset?.morph;
      const from = key ? was?.get(key) : undefined;
      if (key && from) {
        const now = node.getBoundingClientRect();
        if (!now.width || !now.height) return;
        // Text scales evenly by its line height; a name's box can be wider than its words.
        const sy = from.height / now.height;
        const sx = key === 'name' ? sy : from.width / now.width;
        node.animate(
          [{ transformOrigin: '0 0', transform: `translate(${from.left - now.left}px, ${from.top - now.top}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }],
          { duration: 435, easing: spatial },
        );
        return;
      }
      if (node.querySelector('[data-morph]')) for (const child of node.children) visit(child);
      else fade(node);
    };
    for (const child of el.children) visit(child);
  };
  // A card opening an email can't know its final height until the email measures itself, so it holds its old height and grows once.
  const holding = useRef(new Map<string, { from: number; timer: number }>());
  const release = useRef((id: string) => {
    const held = holding.current.get(id);
    if (!held) return;
    holding.current.delete(id);
    window.clearTimeout(held.timer);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
    if (!el) return;
    el.style.height = '';
    el.style.overflow = '';
    delete el.dataset.holding;
    grow(el, held.from);
  }).current;
  const outer = useBodySizing();
  const sizing = useMemo<BodySizing>(
    () => ({
      register: outer.register,
      unregister: (id) => (outer.unregister(id), release(id)),
      sized: (id) => (outer.sized(id), release(id)),
    }),
    [outer, release],
  );
  useLayoutEffect(() => {
    const pending = before.current;
    if (!pending.size) return;
    for (const [id, from] of pending) {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
      if (!el) continue;
      morph(el, morphs.current.get(id), expanded.has(id));
      morphs.current.delete(id);
      if (el.querySelector('.msg__frame[data-sizing]')) {
        el.style.height = `${from}px`;
        el.style.overflow = 'clip';
        el.dataset.holding = '';
        holding.current.set(id, { from, timer: window.setTimeout(() => release(id), 400) });
        continue;
      }
      grow(el, from);
    }
    pending.clear();
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // One function for every card, so a toggle re-renders only the card that changed.
  const toggle = useRef<(id: string) => void>(() => {});
  toggle.current = (id: string) => {
    measure(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const onToggle = useCallback((id: string) => toggle.current(id), []);

  // A draft open in a composer shows there, not as a row too.
  const visible = useMemo(() => messages.filter((m) => !m.isDraft || !editing.includes(m.id)), [messages, editing]);
  // Long threads fold their middle, like Gmail's "N older messages".
  const fold = !showAll && visible.length > 4;
  const firstExpanded = visible.findIndex((m) => expanded.has(m.id));
  const keepTail = Math.max(2, visible.length - Math.max(firstExpanded, 1));
  const hidden = fold ? visible.slice(1, Math.max(1, visible.length - keepTail)) : [];
  const hiddenSet = new Set(hidden.map((m) => m.id));

  return (
    <BodySizingContext.Provider value={sizing}>
      <div className="messages" ref={listRef}>
        {visible.map((m, i) => {
          if (hiddenSet.has(m.id)) {
            if (m.id !== hidden[0].id) return null;
            return (
              <button
                key="fold"
                type="button"
                className="messages__fold"
                onClick={() => {
                  setRevealed(new Set(hidden.map((h) => h.id)));
                  setShowAll(true);
                }}
              >
                {/* The top sheet says how many; two more peek out under it. */}
                <span className="messages__fold-card">
                  <span className="messages__fold-count">{hidden.length}</span>
                  <span className="md-label-large">older messages</span>
                </span>
              </button>
            );
          }
          return (
            <MessageCard
              key={m.id}
              message={m}
              threadId={threadId}
              expanded={expanded.has(m.id)}
              last={i === visible.length - 1}
              revealIndex={revealed.has(m.id) ? [...revealed].indexOf(m.id) : undefined}
              onToggle={onToggle}
            />
          );
        })}
      </div>
    </BodySizingContext.Provider>
  );
});

/** Quicker than this, nothing flashes. */
const PLACEHOLDER_DELAY_MS = 120;
/** A body that never reports its size doesn't hold the conversation back longer. */
const SETTLE_TIMEOUT_MS = 600;

/** Until every open email has measured itself, then one settle. A placeholder fills in if that takes long enough to notice. */
function Settle({ loaded, placeholder, children }: { loaded: boolean; placeholder: ReactNode; children: ReactNode }) {
  const [settled, setSettled] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [placeholderGone, setPlaceholderGone] = useState(false);
  const pending = useRef(new Set<string>());

  const sizing = useMemo<BodySizing>(() => {
    const check = () => !pending.current.size && setSettled(true);
    return {
      register: (id) => pending.current.add(id),
      // A body that remounts registers again straight away; only a real removal should settle.
      unregister: (id) => (pending.current.delete(id), queueMicrotask(check)),
      sized: (id) => (pending.current.delete(id), check()),
    };
  }, []);

  useEffect(() => {
    if (loaded || settled) return;
    const t = window.setTimeout(() => setWaiting(true), PLACEHOLDER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [loaded, settled]);

  // Bodies register in their own effects, which run before this one.
  useEffect(() => {
    if (!loaded) return;
    if (!pending.current.size) setSettled(true);
    const t = window.setTimeout(() => setSettled(true), SETTLE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [loaded]);

  const showPlaceholder = waiting && !placeholderGone;
  return (
    <div className="thread-settle">
      {loaded && (
        <div className="thread-settle__content" data-settled={settled || undefined} data-after-wait={(settled && waiting) || undefined}>
          <BodySizingContext.Provider value={sizing}>{children}</BodySizingContext.Provider>
        </div>
      )}
      {showPlaceholder && (
        <div
          className="thread-settle__placeholder"
          data-leaving={settled || undefined}
          onAnimationEnd={(e) => settled && e.target === e.currentTarget && setPlaceholderGone(true)}
        >
          {placeholder}
        </div>
      )}
    </div>
  );
}

/** Sized from what the list already knows. */
function ThreadSkeleton({ thread }: { thread: Thread }) {
  const count = Math.max(thread.messageCount - thread.draftCount, 1);
  // The same shape as the list it stands in for.
  const folded = count > 4;
  const earlier = folded ? 2 : Math.min(count - 1, 2);
  const collapsed = (i: number) => (
    <div key={i} className="thread-sk__card thread-sk__card--collapsed">
      <span className="sk sk--circle" />
      <span className="sk sk--line thread-sk__name" />
      <span className="sk sk--line thread-sk__snippet" />
    </div>
  );
  return (
    <div className="thread-sk" aria-hidden="true">
      <div className="thread-sk__cards">
        {folded ? (
          <>
            {collapsed(0)}
            <div className="messages__fold thread-sk__fold">
              <span className="messages__fold-card">
                <span className="sk sk--circle" />
                <span className="sk sk--line thread-sk__name" />
              </span>
            </div>
            {collapsed(1)}
          </>
        ) : (
          Array.from({ length: earlier }, (_, i) => collapsed(i))
        )}
        <div className="thread-sk__card">
          <div className="thread-sk__head">
            <span className="sk sk--circle" />
            <div className="thread-sk__who">
              <span className="sk sk--line thread-sk__from" />
              <span className="sk sk--line thread-sk__to" />
            </div>
          </div>
          <div className="thread-sk__body">
            <span className="sk sk--line" style={{ width: '92%' }} />
            <span className="sk sk--line" style={{ width: '84%' }} />
            <span className="sk sk--line" style={{ width: '88%' }} />
            <span className="sk sk--line" style={{ width: '46%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
