import { useState } from 'react';
import { mail } from '../../data/actions';
import type { Thread } from '../../data/types';
import { fullTime } from '../../lib/presets';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { snack } from '../../ui/Snackbar';
import { editDraft } from '../compose/open';

/** Gmail's "Send scheduled for ..." bar, with Cancel send. */
export function ScheduledBanner({ thread }: { thread: Thread }) {
  const [busy, setBusy] = useState(false);
  const pending = thread.messages.filter((m) => m.labelIds.includes('SCHEDULED') && !m.labelIds.includes('TRASH'));
  if (!pending.length) return null;
  const when = thread.scheduledFor ?? Math.min(...pending.map((m) => m.date));

  const cancel = async (edit: boolean) => {
    setBusy(true);
    const after = await mail.cancelScheduled(thread.id, { quiet: edit });
    setBusy(false);
    if (!edit || !after) return;
    const draft = [...after.messages].reverse().find((m) => m.isDraft && pending.some((p) => p.id === m.id)) ?? [...after.messages].reverse().find((m) => m.isDraft);
    if (draft) editDraft(draft);
    else snack('Send canceled. Your message is in Drafts.');
  };

  return (
    <div className="banner banner--quiet banner--thread" role="note">
      <Icon name="schedule_send" size={20} className="banner__icon" />
      <p className="banner__text md-body-medium">Send scheduled for {fullTime(when)}</p>
      <span className="banner__actions">
        <Button variant="text" size="xs" disabled={busy} onClick={() => void cancel(true)}>
          Edit
        </Button>
        <Button variant="outlined" size="xs" disabled={busy} onClick={() => void cancel(false)}>
          Cancel send
        </Button>
      </span>
    </div>
  );
}
