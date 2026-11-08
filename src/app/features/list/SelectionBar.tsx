import { mail } from '../../data/actions';
import type { ThreadSummary } from '../../data/types';
import type { View } from '../../router/routes';
import { useUi } from '../../state/ui';
import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { useState } from 'react';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { describeTime } from '../../lib/presets';
import { LabelMenu, LabelSubmenu } from '../labels/LabelMenu';
import { SnoozeDialog, SnoozeMenu, SnoozeSubmenu } from '../snooze/SnoozeMenu';
import { aside } from '../replylater/store';

export function SelectionBar({ view, threads }: { view: View; threads: ThreadSummary[] }) {
  const selected = useUi((s) => s.selected);
  const ids = [...selected];
  const chosen = threads.filter((t) => selected.has(t.id));
  const anyUnread = chosen.some((t) => t.labelIds.includes('UNREAD'));
  const anyUnstarred = chosen.some((t) => !t.labelIds.includes('STARRED'));
  const anyUnimportant = chosen.some((t) => !t.labelIds.includes('IMPORTANT'));
  const inTrash = view.kind === 'folder' && view.folder === 'trash';
  const inSpam = view.kind === 'folder' && view.folder === 'spam';
  const inInbox = chosen.some((t) => t.labelIds.includes('INBOX'));
  const done = () => useUi.getState().clearSelection();
  // Phones keep Gmail Android's four (archive, delete, read, overflow).
  const compact = useMediaQuery('(max-width: 599px)');
  const [pickingSnooze, setPickingSnooze] = useState(false);

  return (
    <div className="selection-bar" role="toolbar" aria-label={`${ids.length} selected`}>
      <IconButton icon="close" label="Clear selection" onClick={done} />
      <span className="selection-bar__count md-title-medium" aria-live="polite">
        {ids.length.toLocaleString()} selected
      </span>
      <div className="selection-bar__actions">
        {inTrash ? (
          <>
            <IconButton width="narrow" icon="restore_from_trash" label="Restore" onClick={() => (void mail.untrash(ids), done())} />
            <IconButton width="narrow" icon="delete_forever" label="Delete forever" onClick={() => (void mail.deleteForever(ids), done())} />
          </>
        ) : inSpam ? (
          <>
            <IconButton width="narrow" icon="report" label="Not spam" onClick={() => (void mail.notSpam(ids), done())} />
            <IconButton width="narrow" icon="delete_forever" label="Delete forever" onClick={() => (void mail.deleteForever(ids), done())} />
          </>
        ) : (
          <>
            {inInbox ? (
              <IconButton width="narrow" icon="archive" label="Archive" shortcut="e" onClick={() => (void mail.archive(ids), done())} />
            ) : (
              <IconButton width="narrow" icon="move_to_inbox" label="Move to Inbox" onClick={() => (void mail.moveToInbox(ids), done())} />
            )}
            {!compact && <IconButton width="narrow" icon="report" label="Report spam" shortcut="!" onClick={() => (void mail.spam(ids), done())} />}
            <IconButton width="narrow" icon="delete" label="Delete" shortcut="#" onClick={() => (void mail.trash(ids), done())} />
          </>
        )}
        <span className="toolbar-divider" />
        <IconButton
          icon={anyUnread ? 'mark_email_read' : 'mark_email_unread'}
          label={anyUnread ? 'Mark as read' : 'Mark as unread'}
          shortcut={anyUnread ? 'Shift I' : 'Shift U'}
          onClick={() => void mail.markRead(ids, anyUnread)}
        />
        {!compact && (
          <>
            <SnoozeMenu ids={ids} onDone={done} trigger={<IconButton width="narrow" icon="schedule" label="Snooze" shortcut="b" />} />
            <span className="toolbar-divider" />
            <LabelMenu ids={ids} mode="move" trigger={<IconButton width="narrow" icon="drive_file_move" label="Move to" shortcut="v" />} />
            <LabelMenu ids={ids} mode="label" trigger={<IconButton width="narrow" icon="label" label="Labels" shortcut="l" />} />
          </>
        )}
        <Menu trigger={<IconButton width="narrow" icon="more_vert" label="More" />} align="end">
          {compact && !inTrash && !inSpam && (
            <>
              <SnoozeSubmenu ids={ids} onCustom={() => setPickingSnooze(true)} />
              <LabelSubmenu ids={ids} mode="move" onDone={done} />
              <LabelSubmenu ids={ids} mode="label" />
              <MenuItem icon="report" onClick={() => (void mail.spam(ids), done())}>
                Report spam
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem icon="star" onClick={() => void mail.star(ids, anyUnstarred)}>
            {anyUnstarred ? 'Add star' : 'Remove star'}
          </MenuItem>
          <MenuItem icon="label_important" onClick={() => void mail.important(ids, anyUnimportant)}>
            {anyUnimportant ? 'Mark as important' : 'Mark as not important'}
          </MenuItem>
          {inInbox && !inTrash && !inSpam && (
            <MenuItem icon="pending_actions" onClick={() => (aside.addMany(chosen), done())}>
              Reply later
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon="notifications_off" onClick={() => (void mail.mute(ids), done())}>
            Mute
          </MenuItem>
        </Menu>
      </div>
      <SnoozeDialog
        open={pickingSnooze}
        onClose={() => setPickingSnooze(false)}
        onPick={(t) => {
          void mail.snooze(ids, t, describeTime(t));
          done();
        }}
      />
    </div>
  );
}
