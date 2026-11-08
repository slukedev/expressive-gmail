import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Attachment } from '../../data/types';
import { fileSize } from '../../lib/format';
import { IconButton } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { attachmentBlob, downloadAttachment } from '../thread/Attachments';
import { googleCalendarUrl, parseIcs, type CalendarEvent } from '../../smart/extract';
import { openUrl } from '../../lib/host';
import { Button } from '../../ui/Button';
import { fileIcon } from './fileIcon';
import { PdfPages } from './PdfPages';
import { previewKind, thumbs } from './thumbs';
import { imageSize, useImageReady } from '../../ui/imageReady';

const isCalendar = (f: Pick<Attachment, 'mimeType' | 'filename'>) => f.mimeType === 'text/calendar' || /\.ics$/i.test(f.filename);
/** Bigger videos download rather than load into memory. */
const VIDEO_CAP = 50 * 1024 * 1024;
const TEXT_CAP = 1024 * 1024;
/** Then its thumbnail stands in for it. */
const STANDIN_DELAY_MS = 150;

/** Full-screen preview with previous/next, like Gmail's. */
export function AttachmentViewer({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: (Attachment & { messageId: string })[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const file = files[index];
  const [url, setUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [failed, setFailed] = useState(false);
  const calendar = isCalendar(file);
  const kind = calendar ? null : previewKind(file);
  const previewable = calendar || kind === 'image' || kind === 'pdf' || kind === 'text' || (kind === 'video' && file.size > 0 && file.size <= VIDEO_CAP);
  const stand = kind === 'image' ? thumbs.peek(file) : undefined;

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setUrl(null);
    setPdf(null);
    setText(null);
    setEvent(null);
    setFailed(false);
    if (!previewable) return;
    attachmentBlob(file.messageId, file)
      .then(async (blob) => {
        if (cancelled) return;
        if (calendar) {
          const parsed = parseIcs(await blob.text());
          if (parsed) setEvent(parsed);
          else setFailed(true);
        } else if (kind === 'text') setText(await blob.slice(0, TEXT_CAP).text());
        else if (kind === 'pdf') setPdf(blob);
        else {
          revoked = URL.createObjectURL(blob);
          setUrl(revoked);
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file, previewable, calendar, kind]);
  const download = () => void downloadAttachment(file.messageId, file);

  return (
    <BaseDialog.Root open onOpenChange={(o) => !o && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="viewer-scrim" />
        <BaseDialog.Popup
          className="viewer"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
            if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
          }}
        >
          <header className="viewer__bar">
            <IconButton icon="arrow_back" label="Close" onClick={onClose} className="viewer__btn" />
            <Icon name={fileIcon(file.mimeType, file.filename) as IconName} size={20} />
            <BaseDialog.Title className="viewer__title md-title-medium">{file.filename}</BaseDialog.Title>
            {file.size > 0 && <span className="viewer__size md-body-medium">{fileSize(file.size)}</span>}
            <IconButton icon="download" label="Download" onClick={download} className="viewer__btn" />
          </header>
          {/* The dark area around a file works like a scrim: a click there closes the preview. */}
          <div
            className="viewer__stage"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target === e.currentTarget || target.classList.contains('viewer__pdf')) onClose();
            }}
          >
            {!previewable || failed ? (
              <div className="viewer__none">
                <Icon name={fileIcon(file.mimeType, file.filename) as IconName} size={48} />
                <p className="md-title-medium">{failed ? 'Preview isn’t available right now' : 'No preview available'}</p>
                <Button variant="filled" icon="download" onClick={download}>
                  Download
                </Button>
              </div>
            ) : event ? (
              <EventSummary event={event} onDownload={download} />
            ) : text !== null ? (
              <pre className="viewer__text">{text}</pre>
            ) : pdf ? (
              <PdfPages blob={pdf} title={file.filename} onError={() => setFailed(true)} />
            ) : kind === 'image' ? (
              <ImageFrame key={`${file.messageId}/${file.id}`} full={url ?? undefined} standin={stand?.kind === 'image' ? stand.url : undefined} alt={file.filename} onError={() => setFailed(true)} />
            ) : !url ? (
              <LoadingIndicator contained label="Loading preview" />
            ) : (
              <video src={url} controls className="viewer__video" aria-label={file.filename} />
            )}
          </div>
          {files.length > 1 && (
            <>
              <IconButton icon="chevron_left" label="Previous" variant="tonal" size="m" className="viewer__nav viewer__nav--prev" disabled={index === 0} onClick={() => onIndex(index - 1)} />
              <IconButton icon="chevron_right" label="Next" variant="tonal" size="m" className="viewer__nav viewer__nav--next" disabled={index === files.length - 1} onClick={() => onIndex(index + 1)} />
            </>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** At its final size from the first frame: the thumbnail fills it under a loading indicator and the original fades in once decoded, so nothing grows or flashes. */
function ImageFrame({ full, standin, alt, onError }: { full?: string; standin?: string; alt: string; onError: () => void }) {
  const original = useImageReady(full);
  const preview = useImageReady(standin);
  useEffect(() => {
    if (original.failed) onError();
  }, [original.failed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only a slow original gets the stand-in, so a small one rarely has to shrink the frame the thumbnail sized.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), STANDIN_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);
  // The thumbnail has the original's shape; the original's own size caps the frame once known.
  const shape = (original.ready && imageSize(full)) || (slow && preview.ready && imageSize(standin));
  if (!shape) return slow ? <LoadingIndicator contained label="Loading preview" /> : null;
  const natural = original.ready ? imageSize(full) : undefined;
  const style = {
    '--ratio': shape.width / shape.height,
    '--natural-width': natural ? `${natural.width}px` : undefined,
  } as CSSProperties;
  return (
    <div className="viewer__frame" style={style} data-loaded={original.ready || undefined} data-instant={original.instant || undefined}>
      {standin && preview.ready && <img src={standin} alt="" className="viewer__standin" decoding="sync" />}
      {full && original.ready && <img src={full} alt={alt} className="viewer__img" decoding="sync" />}
      {!original.ready && <LoadingIndicator contained label="Loading preview" className="viewer__loader" />}
    </div>
  );
}

/** An invite reads better as the event than as iCalendar source. */
function EventSummary({ event, onDownload }: { event: CalendarEvent; onDownload: () => void }) {
  const fmt: Intl.DateTimeFormatOptions = event.allDay
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const when = new Date(event.start).toLocaleString(undefined, fmt);
  const until = event.end && !event.allDay ? new Date(event.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : undefined;
  const organizer = event.organizer ? (event.organizer.name ?? event.organizer.email) : undefined;
  const guests = event.attendees.length;
  const rows: [IconName, string, string | undefined][] = [
    ['schedule', 'When', until ? `${when} to ${until}` : when],
    ['location_on', 'Where', event.location],
    ['person', 'Organizer', organizer],
    ['group', 'Guests', guests ? `${guests} ${guests === 1 ? 'guest' : 'guests'}` : undefined],
  ];
  return (
    <article className="viewer__event" aria-label={event.title}>
      <Icon name="event" size={32} className="viewer__event-icon" />
      <h3 className="md-headline-small viewer__event-title">{event.title || 'Untitled event'}</h3>
      <ul className="viewer__event-rows" role="list">
        {rows
          .filter(([, , value]) => value)
          .map(([icon, label, value]) => (
            <li key={label} className="viewer__event-row md-body-large">
              <Icon name={icon} size={20} />
              <span>
                <span className="viewer__event-label">{label}: </span>
                {value}
              </span>
            </li>
          ))}
      </ul>
      <footer className="viewer__event-actions">
        <Button variant="text" icon="download" onClick={onDownload}>
          Download
        </Button>
        <Button variant="filled" icon="calendar_add_on" onClick={() => openUrl(googleCalendarUrl(event))}>
          Add to Google Calendar
        </Button>
      </footer>
    </article>
  );
}
