import { useState } from 'react';
import { backend } from '../../data/client';
import type { Attachment, Message } from '../../data/types';
import { fileSize } from '../../lib/format';
import { snack } from '../../ui/Snackbar';
import { Icon, type IconName } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { fileIcon, fileKind } from '../attachments/fileIcon';
import { AttachmentViewer } from '../attachments/AttachmentViewer';
import { AttachmentThumb } from '../attachments/AttachmentThumb';

export async function attachmentBlob(messageId: string, a: Pick<Attachment, 'id' | 'mimeType' | 'previewUrl'>): Promise<Blob> {
  if (a.previewUrl?.startsWith('data:') || a.previewUrl?.startsWith('blob:')) return (await fetch(a.previewUrl)).blob();
  const { data, mimeType } = await backend().getAttachment(messageId, a.id);
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType || a.mimeType });
}

export async function downloadAttachment(messageId: string, a: Attachment) {
  try {
    const blob = await attachmentBlob(messageId, a);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch {
    snack(`Couldn't download ${a.filename}. Try again.`);
  }
}

export function Attachments({ message }: { message: Message }) {
  const files = message.attachments.filter((a) => !a.inline);
  const [viewing, setViewing] = useState<number | null>(null);
  const total = files.reduce((n, a) => n + a.size, 0);
  return (
    <section className="attachments" aria-label={`${files.length} attachments`}>
      <p className="attachments__head md-label-large">
        {files.length === 1 ? 'One attachment' : `${files.length} attachments`}
        <span className="attachments__size"> · {fileSize(total)}</span>
      </p>
      <ul className="attachments__grid" role="list">
        {files.map((a, i) => (
          <li key={a.id} className="att-card" data-kind={fileKind(a.mimeType, a.filename)}>
            <button type="button" className="att-card__open" onClick={() => setViewing(i)} aria-label={`Preview ${a.filename}`}>
              <AttachmentThumb file={a} iconSize={32} />
              <span className="att-card__meta">
                <Icon name={fileIcon(a.mimeType, a.filename) as IconName} size={20} className="att-card__type" />
                <span className="att-card__name">{a.filename}</span>
              </span>
              <span className="att-card__size md-body-small">{fileSize(a.size)}</span>
            </button>
            <IconButton icon="download" label={`Download ${a.filename}`} size="xs" variant="tonal" className="att-card__dl" onClick={() => void downloadAttachment(message.id, a)} />
          </li>
        ))}
      </ul>
      {viewing !== null && (
        <AttachmentViewer files={files.map((f) => ({ ...f, messageId: message.id }))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}
