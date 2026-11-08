import { rawId } from '../../data/accounts/ids';
import { ContextMenu } from '@base-ui/react/context-menu';
import type { ReactNode } from 'react';
import { mail } from '../../data/actions';
import type { ThreadSummary } from '../../data/types';
import { describeTime, presetTime, snoozePresets } from '../../lib/presets';
import { navigate } from '../../router/useRoute';
import { local, useLocal } from '../../state/local';
import { MenuItem, MenuSections, MenuSeparator, Submenu } from '../../ui/Menu';
import { replyToThread } from '../compose/open';
import { aside, isAside, useAside } from '../replylater/store';
import { TrackOrderMenuItem } from '../../smart/TrackOrderMenu';

export function RowContextMenu({ thread, children }: { thread: ThreadSummary; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={<div className="row-context" />}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="m3-menu-positioner" collisionPadding={8}>
          <ContextMenu.Popup className="m3-menu">
            <RowMenuItems thread={thread} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Built when the menu opens, so a closed menu costs every row nothing. */
function RowMenuItems({ thread }: { thread: ThreadSummary }) {
  const pinned = useLocal((s) => s.pinned.includes(rawId(thread.id)));
  const setAside = useAside((s) => isAside(s.items, thread.id));
  const ids = [thread.id];
  const unread = thread.labelIds.includes('UNREAD');
  const sender = thread.participants[thread.participants.length - 1];
  return (
    <MenuSections>
      <MenuItem icon="reply" onClick={() => void replyToThread(thread.id, 'reply')}>Reply</MenuItem>
      <MenuItem icon="reply_all" onClick={() => void replyToThread(thread.id, 'reply-all')}>Reply all</MenuItem>
      <MenuItem icon="forward" onClick={() => void replyToThread(thread.id, 'forward')}>Forward</MenuItem>
      <MenuSeparator />
      {thread.labelIds.includes('INBOX') ? (
        <MenuItem icon="archive" onClick={() => void mail.archive(ids)}>Archive</MenuItem>
      ) : (
        <MenuItem icon="move_to_inbox" onClick={() => void mail.moveToInbox(ids)}>Move to Inbox</MenuItem>
      )}
      <MenuItem icon="delete" onClick={() => void mail.trash(ids)}>Delete</MenuItem>
      <MenuItem icon={unread ? 'mark_email_read' : 'mark_email_unread'} onClick={() => void mail.markRead(ids, unread)}>
        {unread ? 'Mark as read' : 'Mark as unread'}
      </MenuItem>
      <Submenu icon="schedule" label="Snooze">
        {snoozePresets().map((p) => (
          <MenuItem key={p.id} onClick={() => void mail.snooze(ids, p.at, describeTime(p.at))} trailing={<span className="menu-time">{presetTime(p.at)}</span>}>
            {p.label}
          </MenuItem>
        ))}
      </Submenu>
      <MenuItem icon="keep" onClick={() => local.togglePin(thread.id)}>{pinned ? 'Unpin' : 'Pin to top'}</MenuItem>
      <MenuItem icon="pending_actions" onClick={() => aside.toggle(thread)}>{setAside ? 'Remove from Reply later' : 'Reply later'}</MenuItem>
      <TrackOrderMenuItem threadId={thread.id} />
      <MenuSeparator />
      <MenuItem icon="notifications_off" onClick={() => void mail.mute(ids)}>Mute</MenuItem>
      {sender && (
        <MenuItem icon="person_search" onClick={() => navigate({ view: { kind: 'search', query: `from:${sender.email}` } })}>
          Find emails from {sender.name?.split(' ')[0] ?? sender.email}
        </MenuItem>
      )}
    </MenuSections>
  );
}
