import { useQueries } from '@tanstack/react-query';
import { PageMark } from '../list/PageMark';
import { NudgeRows, useSentNudges } from '../../smart/SentNudges';
import { backend, keys } from '../../data/client';
import { describeTime } from '../../lib/presets';
import { listDate } from '../../lib/format';
import { navigate, useRoute } from '../../router/useRoute';
import { local, useLocal } from '../../state/local';
import { Button, IconButton } from '../../ui/Button';
import { EmptyArt } from '../../ui/EmptyArt';
import { Icon } from '../../ui/Icon';
import { ThreadPane } from '../thread/ThreadPane';
import { inCurrentScope, scopedThreadId } from '../../data/accounts/threads';

/** Threads you're waiting on, past due first. */
export function FollowupsView({ split }: { split: boolean }) {
  const route = useRoute();
  const reminders = useLocal((s) => s.reminders)
    .filter((r) => inCurrentScope(r.account))
    .map((r) => ({ ...r, threadId: scopedThreadId(r.threadId, r.account) }))
    .sort((a, b) => a.due - b.due);
  const threads = useQueries({
    queries: reminders.map((r) => ({ queryKey: keys.thread(r.threadId), queryFn: () => backend().getThread(r.threadId), staleTime: 60_000 })),
  });
  const now = Date.now();
  // Sent mail nobody answered, the same nudges the inbox shows.
  const suggested = useSentNudges(10);
  const empty = reminders.length === 0 && suggested.length === 0;

  const list = (
    <section className="page" aria-labelledby="followups-title">
      <header className="page__head">
        {!empty && <PageMark kind="reminders" />}
        <h1 id="followups-title" className="md-headline-medium md-emphasized">Follow-ups</h1>
        <p className="md-body-large page__lede">Conversations you're waiting on. If someone replies, the reminder clears itself.</p>
      </header>
      {empty ? (
        <div className="empty">
          <EmptyArt icon="alarm" />
          <h2 className="md-title-large empty__title">No follow-ups</h2>
          <p className="md-body-medium empty__text">Open a conversation and choose “Remind me if no reply”, or use “Send with reminder” when you send.</p>
        </div>
      ) : reminders.length > 0 && (
        <div className="seg-list">
          {reminders.map((r, i) => {
            const t = threads[i]?.data;
            const overdue = r.due <= now;
            return (
              <div key={r.threadId} className="row-wrap">
                <div className="row followup" data-overdue={overdue || undefined} onClick={() => navigate({ view: { kind: 'reminders' }, threadId: r.threadId })}>
                  <span className="followup__icon">
                    <Icon name={overdue ? 'notifications_active' : 'alarm'} size={20} filled={overdue} />
                  </span>
                  <span className="followup__text">
                    <span className="md-title-small">{r.subject || '(no subject)'}</span>
                    <span className="md-body-medium followup__meta">
                      {overdue ? `No reply since ${listDate(r.createdAt)}` : `Reminding ${describeTime(r.due)}`}
                      {t ? ` · ${t.messages.length} ${t.messages.length === 1 ? 'message' : 'messages'}` : ''}
                    </span>
                  </span>
                  <IconButton icon="check" label="Done, remove reminder" onClick={(e) => (e.stopPropagation(), local.setReminder(null, r.threadId))} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {suggested.length > 0 && (
        <>
          <h2 className="list-section md-label-large">Suggested</h2>
          <NudgeRows nudges={suggested} open={(id) => navigate({ view: { kind: 'reminders' }, threadId: id })} />
        </>
      )}
      {reminders.length > 0 && (
        <Button variant="text" icon="clear_all" onClick={() => reminders.forEach((r) => local.setReminder(null, r.threadId))}>
          Clear all
        </Button>
      )}
    </section>
  );

  if (route.threadId && split) {
    return (
      <div className="page-split">
        {list}
        <ThreadPane threadId={route.threadId} />
      </div>
    );
  }
  return route.threadId ? <ThreadPane threadId={route.threadId} single /> : list;
}
