import { useRef } from 'react';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';

/** Gmail's forgotten-attachment check. Attaching is the likelier intent, so it takes focus; Send anyway is one Tab away. */
export function AttachmentReminder({
  phrase,
  onAttach,
  onSendAnyway,
  onCancel,
}: {
  phrase: string | null;
  onAttach: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}) {
  const attach = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={phrase !== null}
      onOpenChange={(o) => !o && onCancel()}
      icon="attach_file_add"
      title="Did you mean to attach files?"
      description={phrase ? `You wrote “${phrase}” in your message, but nothing is attached.` : ''}
      initialFocus={attach}
      actions={
        <>
          <Button variant="text" onClick={onSendAnyway}>
            Send anyway
          </Button>
          <Button variant="text" ref={attach} onClick={onAttach}>
            Attach files
          </Button>
        </>
      }
    />
  );
}
