import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { TextField } from '../../ui/TextField';
import { normalizeUrl } from './paste';

/** Opened with the selection's text (and the address when the caret is in a link). */
export function LinkDialog({
  open,
  onClose,
  initial,
  onApply,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  initial: { text: string; href: string; editing: boolean };
  onApply: (href: string, text: string) => void;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setUrl(initial.href.replace(/^mailto:/i, ''));
    setText(initial.text);
    setTried(false);
  }, [open, initial]);
  const href = normalizeUrl(url);
  const apply = () => {
    setTried(true);
    if (!href) return;
    onApply(href, text.trim());
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={initial.editing ? 'Edit link' : 'Insert link'}
      actions={
        <>
          {initial.editing && (
            <Button
              variant="text"
              className="link-dialog__remove"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Remove link
            </Button>
          )}
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="text" disabled={!url.trim()} onClick={apply}>
            {initial.editing ? 'Save' : 'Insert'}
          </Button>
        </>
      }
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          apply();
        }}
      >
        <TextField label="Text to display" value={text} onChange={(e) => setText(e.target.value)} />
        <TextField
          label="Web address or email"
          value={url}
          autoFocus
          inputMode="url"
          spellCheck={false}
          error={tried && !href ? "That doesn't look like a web address or an email address." : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
        {/* Enter in either field applies the link. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
