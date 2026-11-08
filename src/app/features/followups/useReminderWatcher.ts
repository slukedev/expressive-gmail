import { useEffect } from 'react';
import { backend } from '../../data/client';
import { local, useLocal } from '../../state/local';
import { snack } from '../../ui/Snackbar';
import { navigate } from '../../router/useRoute';
import { inCurrentScope, scopedThreadId } from '../../data/accounts/threads';

/** A reply since the reminder was set clears it quietly; otherwise it surfaces once. */
export function useReminderWatcher() {
  useEffect(() => {
    const announced = new Set<string>();
    const check = async () => {
      // Reminders for accounts outside this view wait until one of their views is open.
      const due = useLocal.getState().reminders.filter((r) => r.due <= Date.now() && inCurrentScope(r.account));
      for (const r of due) {
        try {
          const thread = await backend().getThread(scopedThreadId(r.threadId, r.account));
          const count = thread.messages.filter((m) => !m.isDraft).length;
          if (r.messageCount && count > r.messageCount) {
            local.setReminder(null, r.threadId);
            continue;
          }
          if (!r.messageCount) {
            // Set at send time, before the count was known.
            local.setReminder({ ...r, messageCount: count }, r.threadId);
          }
        } catch {
          continue;
        }
        if (!announced.has(r.threadId)) {
          announced.add(r.threadId);
          snack(`No reply yet: "${r.subject || '(no subject)'}"`, {
            action: { label: 'Follow up', onClick: () => navigate({ view: { kind: 'reminders' }, threadId: scopedThreadId(r.threadId, r.account) }) },
            timeout: 10_000,
          });
        }
      }
    };
    void check();
    const t = window.setInterval(check, 60_000);
    return () => window.clearInterval(t);
  }, []);
}
