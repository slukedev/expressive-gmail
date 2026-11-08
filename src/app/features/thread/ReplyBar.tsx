import { useEffect, useRef } from 'react';
import type { Thread } from '../../data/types';
import { useMe } from '../../data/hooks';
import { Button } from '../../ui/Button';
import { replyToMessage } from '../compose/open';
import { SmartReplies } from './SmartReplies';

/** So the bar's fade shows only while content is behind it. */
function useOverContent() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current;
    let scroller = bar?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!bar || !scroller) return;
    const box = scroller;
    const check = () => bar.toggleAttribute('data-over', box.scrollHeight - box.scrollTop - box.clientHeight > 1);
    check();
    box.addEventListener('scroll', check, { passive: true });
    // Messages expanding, collapsing or loading images change what's behind it too.
    const sizes = new ResizeObserver(check);
    sizes.observe(box);
    for (let el = bar.parentElement; el && el !== box; el = el.parentElement) sizes.observe(el);
    return () => {
      box.removeEventListener('scroll', check);
      sizes.disconnect();
    };
  }, []);
  return ref;
}

export function ReplyBar({ thread }: { thread: Thread }) {
  const me = useMe();
  const ref = useOverContent();
  const real = thread.messages.filter((m) => !m.isDraft);
  const last = real[real.length - 1];
  if (!last) return null;
  const recipients = new Set([...last.to, ...last.cc, last.from].map((a) => a.email.toLowerCase()));
  me.forEach((e) => recipients.delete(e));
  const canReplyAll = recipients.size > 1;
  return (
    <>
      {/* In the conversation, not the pinned bar: they sit under the message they answer. */}
      <SmartReplies thread={thread} />
      <div className="reply-bar" ref={ref}>
        <div className="reply-bar__buttons">
          <Button variant="tonal" icon="reply" onClick={() => replyToMessage(thread.id, last, 'reply')}>
            Reply
          </Button>
          {canReplyAll && (
            <Button variant="tonal" icon="reply_all" onClick={() => replyToMessage(thread.id, last, 'reply-all')}>
              Reply all
            </Button>
          )}
          <Button variant="tonal" icon="forward" onClick={() => replyToMessage(thread.id, last, 'forward')}>
            Forward
          </Button>
        </div>
      </div>
    </>
  );
}
