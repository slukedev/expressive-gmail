import { rawId } from '../data/accounts/ids';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { backend } from '../data/client';
import { useMe } from '../data/hooks';
import { isMe, participantsLine } from '../lib/format';
import { openThread } from '../router/useRoute';
import { local, useLocal } from '../state/local';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/Button';

export const sentNudgesQuery = queryOptions({
  queryKey: ['sent-nudges'],
  queryFn: () => backend().listThreads({ q: 'in:sent older_than:3d newer_than:14d', pageSize: 30 }),
  staleTime: 5 * 60_000,
});

/** Sent mail from the last two weeks nobody answered. Shared with the glance board. */
export function useSentNudges(limit = 2) {
  const me = useMe();
  const dismissed = useLocal((s) => s.dismissedNudges);
  const reminders = useLocal((s) => s.reminders);
  const { data } = useQuery(sentNudgesQuery);
  return (data?.threads ?? [])
    .filter((t) => {
      // The newest message is yours when it isn't addressed to you.
      const newestFromMe = !!t.recipients?.length && !t.recipients.some((r) => isMe(r.email, me));
      return (
        me.length > 0 &&
        newestFromMe &&
        !dismissed.includes(rawId(t.id)) &&
        !reminders.some((r) => r.threadId === rawId(t.id)) &&
        !t.labelIds.includes('TRASH') &&
        // A lone message, or one asking something, wants an answer.
        (t.messageCount === 1 || /\?/.test(t.snippet))
      );
    })
    .slice(0, limit);
}

/** Gmail's "Sent 5 days ago. Follow up?" nudges. */
export function SentNudges() {
  const nudges = useSentNudges();
  if (!nudges.length) return null;
  return (
    <>
      <h2 className="list-section md-label-large">Follow-ups</h2>
      <NudgeRows nudges={nudges} open={(id) => openThread(id, { kind: 'folder', folder: 'sent' })} />
    </>
  );
}

/** The Follow-ups page lists them as suggestions. */
export function NudgeRows({ nudges, open }: { nudges: ReturnType<typeof useSentNudges>; open: (threadId: string) => void }) {
  const me = useMe();
  const now = Date.now();
  return (
    <div className="seg-list nudges">
      {nudges.map((t) => {
        const days = Math.floor((now - t.lastDate) / 86_400_000);
        const to = t.recipients![0];
        return (
          <div key={t.id} className="row-wrap">
            <div
              className="row nudge-row"
              role="button"
              tabIndex={0}
              onClick={() => open(t.id)}
              onKeyDown={(e) => e.key === 'Enter' && open(t.id)}
            >
              <Avatar name={to.name} email={to.email} size={40} />
              <span className="nudge-row__text">
                <span className="md-title-small">To: {participantsLine(t.recipients!, me)}</span>
                <span className="md-body-medium nudge-row__subject">{t.subject || '(no subject)'}</span>
                <span className="md-body-medium row__nudge">Sent {days} days ago. Follow up?</span>
              </span>
              <IconButton
                icon="close"
                label="Dismiss this nudge"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  local.dismissNudge(t.id);
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
