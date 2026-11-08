import { useMe, useThreadList } from '../data/hooks';
import type { View } from '../router/routes';
import { describeTime } from '../lib/presets';
import { participantsLine } from '../lib/format';
import { navigate, openThread } from '../router/useRoute';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

export const SCHEDULED: View = { kind: 'folder', folder: 'scheduled' };
const SHOWN = 3;

/** Soonest first, at the top of the inbox. */
export function ScheduledSoon() {
  const me = useMe();
  // The Scheduled folder's own list, so sending, cancelling and editing keep it current.
  const list = useThreadList(SCHEDULED, 'in:scheduled');
  const now = Date.now();
  const upcoming = (list.data?.pages.flatMap((p) => p.threads) ?? [])
    .filter((t) => t.scheduledFor && t.scheduledFor > now && !t.labelIds.includes('TRASH'))
    .sort((a, b) => a.scheduledFor! - b.scheduledFor!);
  if (!upcoming.length) return null;
  const more = upcoming.length - SHOWN;
  return (
    <>
      <h2 className="list-section md-label-large">Scheduled</h2>
      <div className="seg-list nudges scheduled-soon">
        {upcoming.slice(0, SHOWN).map((t) => {
          const to = t.recipients?.[0];
          const when = describeTime(t.scheduledFor!);
          return (
            <div key={t.id} className="row-wrap">
              <div className="row nudge-row" role="button" tabIndex={0} onClick={() => openThread(t.id, SCHEDULED)} onKeyDown={(e) => e.key === 'Enter' && openThread(t.id, SCHEDULED)}>
                <Avatar name={to?.name} email={to?.email ?? ''} size={40} />
                <span className="nudge-row__text">
                  <span className="md-title-small">To: {t.recipients?.length ? participantsLine(t.recipients, me) : '(no recipients)'}</span>
                  <span className="md-body-medium nudge-row__subject">{t.subject || '(no subject)'}</span>
                  <span className="md-body-medium scheduled-soon__when">
                    <Icon name="schedule_send" size={16} />
                    Sends {when}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
        {more > 0 && (
          <div className="row-wrap">
            <button type="button" className="row nudge-row scheduled-soon__more md-label-large" onClick={() => navigate({ view: SCHEDULED })}>
              {more} more scheduled
            </button>
          </div>
        )}
      </div>
    </>
  );
}
