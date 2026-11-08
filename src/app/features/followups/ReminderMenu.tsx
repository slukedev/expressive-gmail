import { rawId } from '../../data/accounts/ids';
import { useState } from 'react';
import type { Thread } from '../../data/types';
import { describeTime, presetTime, reminderPresets } from '../../lib/presets';
import { local, useLocal } from '../../state/local';
import { IconButton } from '../../ui/Button';
import { Menu, MenuGroupLabel, MenuItem, MenuSeparator } from '../../ui/Menu';
import { snack } from '../../ui/Snackbar';
import { DateTimeDialog } from '../snooze/DateTimeDialog';

/** "Remind me if nobody replies". */
export function ReminderMenu({ thread }: { thread: Thread }) {
  const reminder = useLocal((s) => s.reminders.find((r) => r.threadId === rawId(thread.id)));
  const [picking, setPicking] = useState(false);
  const set = (due: number) => {
    local.setReminder(
      { threadId: thread.id, subject: thread.subject, due, messageCount: thread.messages.length ? thread.messages.filter((m) => !m.isDraft).length : thread.messageCount - thread.draftCount, createdAt: Date.now() },
      thread.id,
    );
    snack(`We'll remind you ${describeTime(due)} if nobody replies`);
  };
  return (
    <>
      <Menu
        align="end"
        trigger={<IconButton icon={reminder ? 'notifications_active' : 'alarm_add'} label={reminder ? `Follow-up ${describeTime(reminder.due)}` : 'Remind me if no reply'} selected={!!reminder} />}
      >
        <MenuGroupLabel>Remind me if nobody replies</MenuGroupLabel>
        {reminderPresets().map((p) => (
          <MenuItem key={p.id} onClick={() => set(p.at)} trailing={<span className="menu-time">{presetTime(p.at)}</span>}>
            {p.label}
          </MenuItem>
        ))}
        <MenuItem icon="calendar_month" onClick={() => setPicking(true)}>
          Pick date and time
        </MenuItem>
        {reminder && (
          <>
            <MenuSeparator />
            <MenuItem icon="close" onClick={() => (local.setReminder(null, thread.id), snack('Follow-up reminder removed'))}>
              Remove reminder
            </MenuItem>
          </>
        )}
      </Menu>
      <DateTimeDialog
        open={picking}
        title="Remind me on"
        confirmLabel="Set reminder"
        onClose={() => setPicking(false)}
        onConfirm={(t) => {
          setPicking(false);
          set(t);
        }}
      />
    </>
  );
}
