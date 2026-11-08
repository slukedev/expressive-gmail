import { rawId } from '../../data/accounts/ids';
import type { ThreadSummary } from '../../data/types';
import { Button, IconButton } from '../../ui/Button';
import { aside, isAside, useAside, visibleItems } from './store';
import './replylater.css';

/** Set this conversation aside, or take it back. */
export function ReplyLaterButton({ thread }: { thread: ThreadSummary }) {
  const on = useAside((s) => isAside(s.items, thread.id));
  return (
    <IconButton
      icon="pending_actions"
      label={on ? 'Remove from Reply later' : 'Reply later'}
      shortcut="Shift L"
      selected={on}
      onClick={() => aside.toggle(thread)}
    />
  );
}

/** Where you are in the stack, with Skip and Done. Sending the reply moves on by itself. */
export function ReplyLaterSession({ threadId }: { threadId: string }) {
  const session = useAside((s) => s.session);
  const items = useAside((s) => s.items);
  if (!session) return null;
  const visible = visibleItems(items);
  const raw = rawId(threadId);
  const at = visible.findIndex((i) => i.threadId === raw);
  if (at < 0) return null;
  const left = visible.length - 1;
  return (
    <div className="aside-session" role="region" aria-label="Reply later">
      <div className="aside-session__text">
        <span className="md-title-small">Reply later</span>
        <span className="md-body-medium">
          {left === 0 ? 'Last one. Send your reply to finish.' : `${left} more after this one. Send your reply to go to the next.`}
        </span>
        <span className="aside-session__progress" aria-hidden="true">
          {visible.map((i, n) => (
            <span key={i.threadId} className="aside-session__dot" data-current={n === at || undefined} />
          ))}
        </span>
      </div>
      {left > 0 && (
        <Button variant="text" size="s" onClick={() => aside.skip(threadId)}>
          Skip
        </Button>
      )}
      <Button variant="text" size="s" icon="check" onClick={() => aside.doneAndNext(threadId)}>
        Done
      </Button>
      <IconButton icon="close" label="Stop working through Reply later" size="xs" onClick={aside.stop} />
    </div>
  );
}
