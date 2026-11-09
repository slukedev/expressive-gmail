import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { isArriving } from '../../data/client';
import { useMoved } from '../../data/moved';
import { motionToken } from '../../ui/motion';
import { mail } from '../../data/actions';
import { prefetchThread, useMe } from '../../data/hooks';
import type { Label, ThreadSummary } from '../../data/types';
import { isMe, listDate, fullDate, participantsLine } from '../../lib/format';
import type { View } from '../../router/routes';
import { openThread } from '../../router/useRoute';
import { openDraftOf } from '../compose/open';
import { useSettings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { focusThread } from '../shortcuts/focus';
import { Avatar } from '../../ui/Avatar';
import { IconButton, cx } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';
import { Ripple } from '../../ui/Ripple';
import { LabelChip } from '../labels/LabelChip';
import { AccountBadge, AccountChip, useThreadAccount } from '../accounts/AccountBits';
import { useAccounts } from '../../data/accounts/store';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { SnoozeMenu } from '../snooze/SnoozeMenu';
import { RowContextMenu } from './RowContextMenu';
import { fileIcon } from '../attachments/fileIcon';
import { AttachmentViewer } from '../attachments/AttachmentViewer';
import { useSwipe } from './useSwipe';
import { ROW_HOVER_EVENT } from './rowHover';
import { selectRangeTo, toggleOne } from './select';
import { isComposing } from '../../lib/ime';
import { RowSmartChips, RowSmartLine, useRowSmart } from '../../smart/RowSmart';

interface RowProps {
  thread: ThreadSummary;
  index: number;
  view: View;
  active: boolean;
  selected: boolean;
  leaving: boolean;
  pinned: boolean;
  labels: Label[];
}

const SYSTEM_HIDDEN = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SNOOZED', 'SCHEDULED', 'CHAT', 'MUTED', 'SPAM', 'TRASH']);

/** Before its thread is fetched ahead of a click. */
const PREFETCH_HOVER_MS = 80;

export const ThreadRow = memo(function ThreadRow({ thread, index, view, active, selected, leaving, pinned, labels }: RowProps) {
  const me = useMe();
  // Read once, as the row mounts: only a row put back by an undo opens up.
  const [entering] = useState(() => isArriving(thread.id));
  const moved = useMoved((s) => s.tokens.get(thread.id));
  const leavingNow = useRef(leaving);
  leavingNow.current = leaving;
  const seen = useRef(moved);
  useEffect(() => {
    if (moved === seen.current) return;
    seen.current = moved;
    // A row that stays in its list (All mail, a label) can't leave, so it answers with a tint that fades; one that leaves folds away instead.
    const timer = window.setTimeout(() => {
      const row = wrapRef.current?.querySelector<HTMLElement>(':scope > .row');
      if (!row || leavingNow.current || wrapRef.current?.hasAttribute('data-leaving') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      row.animate([{ backgroundColor: 'color-mix(in srgb, var(--md-sys-color-primary) 16%, transparent)' }], {
        duration: motionToken('--md-sys-motion-effects-slow').duration + 300,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [moved]);
  const chosen = useSettings((s) => s.accountMarker);
  const forcedColors = useMediaQuery('(forced-colors: active)');
  const focused = useAccounts((s) => !!s.focus);
  // Narrowed to one account, every row is that account's: no marker. Forced colors drop hues, so name it.
  const marker = focused ? 'off' : forcedColors && chosen !== 'off' ? 'chip' : chosen;
  const owner = useThreadAccount(thread.id);
  const showAvatars = useSettings((s) => s.showAvatars);
  // Without photos the account shows as a chip.
  const onPhoto = owner && showAvatars && (marker === 'badge' || marker === 'dot') ? marker : null;
  const accountTag = owner && marker !== 'off' && !onPhoto ? <AccountChip account={owner} className="row__account-chip" /> : null;
  const hoverActions = useSettings((s) => s.hoverActions);
  const showSnippets = useSettings((s) => s.showSnippets);
  const showLabelChips = useSettings((s) => s.showLabelChips);
  const smartFeatures = useSettings((s) => s.smartFeatures);
  // Only the rows the cursor leaves and lands on re-render on j / k.
  const isCursor = useUi((s) => s.cursor === index);
  const tabStop = useUi((s) => s.cursor === index || (s.cursor < 0 && index === 0));
  const prefetched = useRef(false);
  const prefetchTimer = useRef(0);
  // Hover actions (buttons, tooltips, the snooze menu) are most of a row's cost; build them on first point or focus.
  const [armed, setArmed] = useState(false);
  useEffect(() => () => window.clearTimeout(prefetchTimer.current), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The list marks the row that slides in under a resting pointer (rowHover.ts); it needs its actions at once.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const arm = () => setArmed(true);
    el.addEventListener(ROW_HOVER_EVENT, arm);
    // The list may have marked this row before this effect ran.
    if (el.querySelector('[data-hover]')) arm();
    return () => el.removeEventListener(ROW_HOVER_EVENT, arm);
  }, []);
  // Focus inside a leaving row would drop to the page; hand it to the row taking its place.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!leaving || !wrap?.contains(document.activeElement)) return;
    const all = [...(wrap.closest('.list-scroll')?.querySelectorAll<HTMLElement>('.row-wrap') ?? [])];
    const at = all.indexOf(wrap);
    const stays = (w: HTMLElement) => !w.hasAttribute('data-leaving');
    const next = all.slice(at + 1).find(stays) ?? all.slice(0, at).reverse().find(stays);
    next?.querySelector<HTMLElement>('[data-row-index]')?.focus({ preventScroll: true });
  }, [leaving]);

  const unread = thread.labelIds.includes('UNREAD');
  const starred = thread.labelIds.includes('STARRED');
  const important = thread.labelIds.includes('IMPORTANT');
  const last = thread.participants[thread.participants.length - 1];
  // Sent mail reads "To: Ana" like Gmail.
  const fromMe = me.length > 0 && thread.participants.length > 0 && thread.participants.every((p) => isMe(p.email, me));
  // Drafts read like Gmail's: a red "Draft", who it's to, and a click opens the composer.
  const inDrafts = view.kind === 'folder' && view.folder === 'drafts';
  // A reply draft's newest message may be the one sent to you; then it's to the others.
  const others = (list: typeof thread.participants = []) => list.filter((p) => !isMe(p.email, me));
  const draftTo = inDrafts ? (others(thread.recipients).length ? others(thread.recipients) : others(thread.participants)) : [];
  const to = draftTo.length ? participantsLine(draftTo, me) : '';
  const sender = inDrafts
    ? to
      ? `Draft to ${to}`
      : 'Draft'
    : fromMe && thread.recipients?.length && (view.kind === 'folder' && (view.folder === 'sent' || view.folder === 'scheduled') || thread.messageCount === 1)
      ? `To: ${participantsLine(thread.recipients, me)}`
      : participantsLine(thread.participants, me);
  const labelChips = labels.filter(
    (l) =>
      showLabelChips &&
      thread.labelIds.includes(l.id) &&
      !SYSTEM_HIDDEN.has(l.id) &&
      !l.id.startsWith('CATEGORY_') &&
      !(view.kind === 'label' && view.label === l.name),
  );
  const inFolder = (id: string) => thread.labelIds.includes(id);
  // Searches show where a thread lives, like Gmail's "Inbox" chip.
  if ((view.kind === 'search' || (view.kind === 'folder' && view.folder === 'all')) && showLabelChips && inFolder('INBOX')) labelChips.unshift({ id: 'INBOX', name: 'Inbox', type: 'system' });

  const toggleSelect = (e: MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) selectRangeTo(thread.id);
    else toggleOne(thread.id);
  };

  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, [role="menuitem"]')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      toggleSelect(e);
      return;
    }
    useUi.getState().setCursor(index);
    if (inDrafts) openDraft();
    else openThread(thread.id, view);
  };
  // A conversation whose draft has gone opens as itself.
  const openDraft = () => void openDraftOf(thread.id).then((ok) => ok || openThread(thread.id, view), () => openThread(thread.id, view));

  const swipe = useSwipe((dir) => {
    if (dir === 'right') void (thread.labelIds.includes('INBOX') ? mail.archive([thread.id]) : mail.moveToInbox([thread.id]));
    else void mail.markRead([thread.id], unread, true);
  });

  const smart = useRowSmart(thread, me, smartFeatures);
  // An invite's .ics shows as the RSVP chips instead.
  const chipFiles = thread.attachments.filter((a) => smart?.kind !== 'invite' || !/\.ics$|calendar/i.test(a.filename + a.mimeType));
  const [viewing, setViewing] = useState<number | null>(null);
  const smartLine = smart && (smart.kind === 'package' || smart.kind === 'bill');
  const nudge = smart?.kind === 'nudge' ? smart : null;
  const smartChips = smart && (smart.kind === 'code' || smart.kind === 'invite' || smart.kind === 'deal' || (smart.kind === 'package' && smart.status !== 'delivered'));

  const meta = rowMeta(thread, view);
  const dateText = meta ?? listDate(thread.lastDate);

  return (
    <RowContextMenu thread={thread}>
      <div
        ref={wrapRef}
        role="listitem"
        className="row-wrap"
        data-leaving={leaving || undefined}
        data-entering={entering || undefined}
        onFocus={() => setArmed(true)}
        // A row mounted under a resting pointer gets no pointerenter.
        onPointerMove={armed ? undefined : () => setArmed(true)}
        onPointerEnter={() => {
          setArmed(true);
          // Wait for the pointer to settle: sweeping across the list shouldn't fetch and parse every thread (in Safari parsing shares the app's thread).
          if (prefetched.current || prefetchTimer.current) return;
          prefetchTimer.current = window.setTimeout(() => {
            prefetchTimer.current = 0;
            prefetched.current = true;
            void prefetchThread(thread.id);
          }, PREFETCH_HOVER_MS);
        }}
        onPointerLeave={() => {
          window.clearTimeout(prefetchTimer.current);
          prefetchTimer.current = 0;
        }}
      >
        <span className="row-swipe row-swipe--right" aria-hidden="true">
          <Icon name={thread.labelIds.includes('INBOX') ? 'archive' : 'move_to_inbox'} size={24} />
        </span>
        <span className="row-swipe row-swipe--left" aria-hidden="true">
          <Icon name={unread ? 'mark_email_read' : 'mark_email_unread'} size={24} />
        </span>
        <div
          {...swipe}
          className={cx('row', unread && 'row--unread', selected && 'row--selected', active && 'row--active')}
          data-cursor={isCursor || undefined}
          data-row-index={index}
          onClick={open}
          // Shift-click extends the selection, not a text selection.
          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          // A link, not a button: it holds its own buttons, which a button role would hide.
          role="link"
          tabIndex={tabStop ? 0 : -1}
          aria-current={active ? 'true' : undefined}
          aria-label={`${unread ? 'Unread, ' : ''}${starred ? 'Starred, ' : ''}${important ? 'Important, ' : ''}${sender}, ${thread.subject || '(no subject)'}, ${fullDate(thread.lastDate)}${owner ? `, in ${owner.short}` : ''}`}
          onKeyDown={(e) => {
            // Enter on the row's own buttons presses them only.
            if (e.key !== 'Enter' || e.target !== e.currentTarget || isComposing(e)) return;
            // The list-wide Enter would open the cursor's row as well.
            e.preventDefault();
            if (inDrafts) return openDraft();
            openThread(thread.id, view);
            focusThread();
          }}
        >
          <button
            type="button"
            className="row__lead"
            aria-pressed={selected}
            aria-label={selected ? 'Deselect conversation' : 'Select conversation'}
            onClick={toggleSelect}
            data-avatars={showAvatars || undefined}
          >
            <span className="row__lead-flip" data-flipped={selected || undefined}>
              <span className="row__lead-front">
                {showAvatars && inDrafts && !draftTo.length ? (
                  <span className="row__draft-tile">
                    <Icon name="edit_note" size={24} />
                  </span>
                ) : showAvatars ? (
                  <Avatar
                    name={inDrafts ? draftTo[0]!.name : last?.name}
                    email={(inDrafts ? draftTo[0]!.email : last?.email) ?? 'unknown'}
                    size={40}
                  />
                ) : (
                  <span className="row__checkbox" />
                )}
              </span>
              <span className="row__lead-back">
                <Icon name="check" size={24} weight={500} />
              </span>
            </span>
            {onPhoto === 'badge' && <AccountBadge account={owner!} />}
            {onPhoto === 'dot' && <span className="row__account-dot" style={{ '--account-color': owner!.color } as CSSProperties} />}
          </button>

          <div className="row__sender">
            {important && (
              <Tooltip content="Important">
                <span className="row__important">
                  <Icon name="label_important" size={18} filled />
                </span>
              </Tooltip>
            )}
            <span className="row__from">
              {inDrafts ? (
                <>
                  <span className="row__draft">Draft</span>
                  {to && <span className="row__draft-to"> to {to}</span>}
                </>
              ) : thread.labelIds.includes('DRAFT') && thread.messageCount === thread.draftCount ? (
                <span className="row__draft">Draft</span>
              ) : (
                sender
              )}
            </span>
            {thread.messageCount > 1 && <span className="row__count">{thread.messageCount}</span>}
            {accountTag}
            {thread.draftCount > 0 && thread.messageCount > thread.draftCount && (
              <span className="row__draft">, Draft{thread.draftCount > 1 ? ` (${thread.draftCount})` : ''}</span>
            )}
          </div>

          <div className="row__main">
            <span className="row__subject">
              {pinned && <Icon name="keep" size={16} filled className="row__pin" />}
              {labelChips.length > 0 && (
                <span className="row__labels row__labels--inline">
                  {labelChips.slice(0, 3).map((l) => (
                    <LabelChip key={l.id} label={l} />
                  ))}
                </span>
              )}
              <span className="row__subject-text" dir="auto">{thread.subject || '(no subject)'}</span>
            </span>
            {labelChips.length > 0 && (
              <span className="row__labels row__labels--compact">
                <LabelChip label={labelChips[0]} />
                {labelChips.length > 1 && <span className="label-chip label-chip--more">+{labelChips.length - 1}</span>}
              </span>
            )}
            {smartLine && <RowSmartLine smart={smart} />}
            {showSnippets && thread.snippet && !smartLine && (
              <span className="row__snippet" dir="auto">
                <span className="row__dash" aria-hidden="true">
                  {' '}
                  -{' '}
                </span>
                {nudge && <span className="row__nudge">Received {nudge.days} days ago. Reply? </span>}
                {thread.snippet}
              </span>
            )}
          </div>

          {(chipFiles.length > 0 || smartChips) && (
            <div className="row__attachments">
              {smartChips && <RowSmartChips smart={smart} thread={thread} />}
              {chipFiles.slice(0, 2).map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  className="att-chip"
                  aria-label={`Preview ${a.filename}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewing(i);
                  }}
                >
                  <Icon name={fileIcon(a.mimeType, a.filename) as IconName} size={16} className="att-chip__icon" data-kind={a.mimeType.split('/')[0]} />
                  <span className="att-chip__name">{a.filename}</span>
                  <Ripple />
                </button>
              ))}
              {chipFiles.length > 2 && (
                <button
                  type="button"
                  className="att-chip att-chip--more"
                  aria-label={`Preview ${chipFiles.length - 2} more attachments`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewing(2);
                  }}
                >
                  +{chipFiles.length - 2}
                  <Ripple />
                </button>
              )}
            </div>
          )}

          <div className="row__trail">
            <span className="row__date" title={fullDate(thread.lastDate)} data-meta={meta ? '' : undefined}>
              {thread.hasAttachments && thread.attachments.length === 0 && <Icon name="attach_file" size={16} className="row__clip" />}
              {dateText}
            </span>
            <IconButton
              icon="star"
              label={starred ? 'Starred' : 'Not starred'}
              size="xs"
              className="row__star"
              selected={starred}
              data-starred={starred || undefined}
              onClick={(e) => {
                e.stopPropagation();
                void mail.star([thread.id], !starred);
              }}
              tooltip={starred ? 'Starred' : 'Not starred'}
            />
          </div>

          {hoverActions && armed && (
            <div className="row__hover" onClick={(e) => e.stopPropagation()}>
              {inDrafts ? (
                <IconButton icon="delete" label="Discard draft" size="s" onClick={() => void mail.discardDrafts([thread.id])} shortcut="#" />
              ) : (
                <>
                  {thread.labelIds.includes('INBOX') ? (
                    <IconButton icon="archive" label="Archive" size="s" onClick={() => void mail.archive([thread.id])} shortcut="e" />
                  ) : (
                    <IconButton icon="move_to_inbox" label="Move to Inbox" size="s" onClick={() => void mail.moveToInbox([thread.id])} />
                  )}
                  {!thread.labelIds.includes('TRASH') && (
                    <IconButton icon="delete" label="Delete" size="s" onClick={() => void mail.trash([thread.id])} shortcut="#" />
                  )}
                  <IconButton
                    icon={unread ? 'mark_email_read' : 'mark_email_unread'}
                    label={unread ? 'Mark as read' : 'Mark as unread'}
                    size="s"
                    onClick={() => void mail.markRead([thread.id], unread, true)}
                  />
                  <SnoozeMenu ids={[thread.id]} trigger={<IconButton icon="schedule" label="Snooze" size="s" shortcut="b" />} />
                </>
              )}
            </div>
          )}
          <Ripple />
        </div>
      </div>
      {viewing !== null && (
        <AttachmentViewer
          files={chipFiles.map((a) => ({ ...a, size: a.size ?? 0 }))}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </RowContextMenu>
  );
});

function rowMeta(thread: ThreadSummary, view: View): string | null {
  if (view.kind === 'folder' && view.folder === 'snoozed' && thread.snoozedUntil) return `Until ${listDate(thread.snoozedUntil)}`;
  if (view.kind === 'folder' && view.folder === 'scheduled' && thread.scheduledFor) return listDate(thread.scheduledFor);
  return null;
}
