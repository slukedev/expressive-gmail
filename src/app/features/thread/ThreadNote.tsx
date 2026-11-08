import { rawId } from '../../data/accounts/ids';
import { useEffect, useRef, useState } from 'react';
import { local, useLocal } from '../../state/local';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { relative } from '../../lib/format';

/** Stays in this browser only. */
export function ThreadNote({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const note = useLocal((s) => s.notes[rawId(threadId)]);
  const [text, setText] = useState(note?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(note?.text ?? '');
    if (!note) ref.current?.focus();
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <aside className="thread-note" aria-label="Private note">
      <Icon name="sticky_note_2" size={20} className="thread-note__icon" />
      <div className="thread-note__body">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder="Add a private note. Only you can see it."
          aria-label="Private note"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => local.setNote(threadId, text)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
        />
        {note && <span className="thread-note__meta md-body-small">Edited {relative(note.updatedAt)}</span>}
      </div>
      <IconButton
        icon="close"
        size="xs"
        label={note ? 'Delete note' : 'Close note'}
        onClick={() => {
          local.setNote(threadId, '');
          onClose();
        }}
      />
    </aside>
  );
}
